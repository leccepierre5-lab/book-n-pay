-- 0026_capacity_check_booking.sql
-- Anti-surbooking réel — vérification atomique de services.max_persons.
--
-- ⚠️ Comme les migrations précédentes, à exécuter manuellement dans le
-- Supabase SQL Editor.
--
-- Problème corrigé : la branche "service collectif" de
-- src/app/api/bookings/create/route.ts (et la boucle d'insertion de
-- src/app/api/bookings/create-group/route.ts) insère directement dans
-- bookings sans jamais vérifier services.max_persons. Deux clients qui
-- réservent la même prestation/date/heure/praticien en même temps peuvent
-- tous les deux passer, même si ça dépasse la capacité annoncée — aucune
-- fenêtre de course n'était même fermée, il n'y avait simplement aucun
-- contrôle. Même famille de bug que 0024 (staff), mais côté capacité.
--
-- Même principe que assign_staff_and_create_booking (0024) : verrou
-- consultatif de transaction + re-vérification + insertion dans UNE seule
-- fonction Postgres, parce que le client Supabase JS (PostgREST) ne peut
-- pas tenir un verrou de ligne entre deux appels HTTP séparés.
--
-- Clé de verrou : (service_id, date, time, staff_id) — cohérente avec la
-- granularité du correctif A (l'isolation de dispo par service/praticien
-- dans availability/route.ts). staff_id peut être NULL (service collectif
-- sans praticien dédié) : coalesce()'d dans la clé pour ne pas produire un
-- hash NULL (qui ferait échouer pg_advisory_xact_lock).
--
-- max_persons est TOUJOURS relu depuis la table dans cette fonction, jamais
-- reçu en argument — un appelant ne doit pas pouvoir influencer la limite
-- appliquée. Si max_persons IS NULL, la prestation est réputée illimitée :
-- court-circuit avant même de compter quoi que ce soit (pas de comparaison
-- "count >= NULL", qui serait toujours NULL donc toujours fausse en SQL —
-- ça aurait laissé passer une capacité NULL par accident, mais autant le
-- rendre explicite plutôt que de compter sur ce comportement implicite).
--
-- Compte les lignes de `bookings` (pas `booking_members` — ce compteur-là
-- sert à un mécanisme différent, rejoindre une réservation existante via
-- group/route.ts, sans rapport avec cette fonction).
CREATE OR REPLACE FUNCTION create_booking_with_capacity_check(
  p_biz_id uuid,
  p_biz_name text,
  p_service_id uuid,
  p_service_name text,
  p_staff_id uuid,
  p_staff_name text,
  p_date date,
  p_time time,
  p_client_id uuid,
  p_client_phone text,
  p_client_name text,
  p_client_email text,
  p_group_ref text DEFAULT NULL,
  p_payment_deadline timestamptz DEFAULT NULL
)
RETURNS SETOF bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max_persons int;
  v_current_count int;
BEGIN
  -- Sérialise toutes les tentatives concurrentes sur ce créneau précis
  -- avant de lire quoi que ce soit — sinon deux transactions peuvent
  -- toutes les deux lire "count = max_persons - 1" et insérer chacune,
  -- dépassant la capacité (classique check-then-act non protégé).
  --
  -- coalesce(p_staff_id::text, 'null') : staff_id NULL (service collectif
  -- sans praticien dédié) doit produire la MÊME clé de verrou pour toutes
  -- les réservations sur ce (service_id, date, time) — sinon deux clients
  -- avec staff_id NULL prendraient des verrous distincts (concaténation
  -- avec un NULL brut donne une chaîne NULL, donc un hash NULL, et
  -- pg_advisory_xact_lock(NULL) échoue / ne sérialise rien). Le coalesce
  -- transforme NULL en une valeur concrète commune ('null' littéral) AVANT
  -- le hash, donc toutes les réservations collectives sans praticien sur ce
  -- créneau se retrouvent bien sur le même verrou.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      p_service_id::text || ':' || p_date::text || ':' || p_time::text
        || ':' || coalesce(p_staff_id::text, 'null'),
      0
    )
  );

  SELECT max_persons INTO v_max_persons
  FROM services
  WHERE id = p_service_id;

  IF v_max_persons IS NOT NULL THEN
    -- IS NOT DISTINCT FROM (pas =) : même raison que le coalesce ci-dessus,
    -- version "comparaison" plutôt que "hash". b.staff_id = NULL et
    -- p_staff_id = NULL doivent compter comme égaux ici ; un simple = les
    -- exclurait tous les deux (NULL = NULL vaut NULL, jamais TRUE en SQL).
    SELECT count(*) INTO v_current_count
    FROM bookings b
    WHERE b.service_id = p_service_id
      AND b.date = p_date
      AND b.time = p_time
      AND b.staff_id IS NOT DISTINCT FROM p_staff_id
      AND b.status != 'cancelled';

    IF v_current_count >= v_max_persons THEN
      RETURN; -- 0 ligne = capacité atteinte, l'appelant traite ça comme un 409
    END IF;
  END IF;

  RETURN QUERY
  INSERT INTO bookings (
    biz_id, biz_name, service_id, service_name, staff_id, staff_name,
    date, time, status, group_ref, payment_deadline,
    client_id, client_phone, client_name, client_email
  )
  VALUES (
    p_biz_id, p_biz_name, p_service_id, p_service_name, p_staff_id, p_staff_name,
    p_date, p_time, 'active', p_group_ref, p_payment_deadline,
    p_client_id, p_client_phone, p_client_name, p_client_email
  )
  RETURNING *;
END;
$$;

-- Perf : la lecture de comptage ci-dessus (service_id, date, time, staff_id
-- IS NOT DISTINCT FROM ...) n'est pas couverte par idx_bookings_staff_date
-- (0023), qui est filtré WHERE staff_id IS NOT NULL — or les services
-- collectifs sans praticien dédié ont justement staff_id NULL. Index séparé,
-- sans ce filtre, pour couvrir aussi ce cas.
CREATE INDEX IF NOT EXISTS idx_bookings_service_date_time
  ON bookings (service_id, date, time)
  WHERE status != 'cancelled';

-- Durcissement : comme 0024, retire l'accès PUBLIC par défaut. Fonction
-- SECURITY DEFINER appelée uniquement depuis create/route.ts et
-- create-group/route.ts via le client service_role.
REVOKE EXECUTE ON FUNCTION create_booking_with_capacity_check(
  uuid, text, uuid, text, uuid, text, date, time, uuid, text, text, text, text, timestamptz
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION create_booking_with_capacity_check(
  uuid, text, uuid, text, uuid, text, date, time, uuid, text, text, text, text, timestamptz
) TO service_role;
