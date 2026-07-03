-- 0024_assign_staff_booking.sql
-- Planning par praticien — étape 3/4 (assignation atomique au checkout).
--
-- ⚠️ Comme les migrations précédentes, à exécuter manuellement dans le
-- Supabase SQL Editor.
--
-- Remplace la vérification "lire la dispo en JS puis insérer" utilisée en
-- première version de src/app/api/bookings/create/route.ts, qui laissait une
-- fenêtre de race condition entre le calcul de dispo et l'insertion (deux
-- clients pouvaient recevoir le même praticien libre si leurs requêtes se
-- chevauchaient). Ici, verrouillage + re-vérification + insertion se font
-- dans UNE seule fonction Postgres (une seule transaction) — nécessaire car
-- le client Supabase JS (PostgREST) ne peut pas tenir un verrou de ligne
-- entre deux appels HTTP séparés.
--
-- Problème du "gap lock" : un SELECT ... FOR UPDATE ne verrouille que les
-- lignes déjà existantes, pas l'insertion future d'une ligne concurrente sur
-- le même praticien/créneau. On utilise donc un verrou consultatif de
-- transaction (pg_advisory_xact_lock), une clé par (biz, praticien, date),
-- acquis pour TOUS les candidats avant de re-vérifier quoi que ce soit —
-- ça sérialise les tentatives d'assignation concurrentes sur un même
-- praticien/jour, et se libère automatiquement à la fin de la transaction
-- (commit ou rollback), donc aucun risque de verrou orphelin en cas
-- d'erreur applicative.
--
-- Ordre des verrous : les candidats sont triés avant d'être verrouillés
-- (indépendamment de l'ordre de préférence utilisé ensuite pour choisir le
-- praticien) — sinon deux appels concurrents avec des listes de candidats
-- partiellement communes mais dans un ordre différent pourraient se
-- verrouiller mutuellement (deadlock).
CREATE OR REPLACE FUNCTION assign_staff_and_create_booking(
  p_biz_id uuid,
  p_biz_name text,
  p_service_id uuid,
  p_service_name text,
  p_date date,
  p_time time,
  p_duration_minutes int,
  p_candidate_staff_ids uuid[],
  p_client_id uuid,
  p_client_phone text,
  p_client_name text,
  p_client_email text
)
RETURNS SETOF bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sorted_ids uuid[];
  v_candidate uuid;
  v_slot_start int;
  v_slot_end int;
  v_busy boolean;
  v_assigned uuid := NULL;
BEGIN
  IF p_candidate_staff_ids IS NULL OR array_length(p_candidate_staff_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  SELECT array_agg(x ORDER BY x) INTO v_sorted_ids
  FROM unnest(p_candidate_staff_ids) AS x;

  FOREACH v_candidate IN ARRAY v_sorted_ids LOOP
    PERFORM pg_advisory_xact_lock(
      hashtextextended(p_biz_id::text || ':' || v_candidate::text || ':' || p_date::text, 0)
    );
  END LOOP;

  v_slot_start := extract(hour from p_time)::int * 60 + extract(minute from p_time)::int;
  v_slot_end := v_slot_start + p_duration_minutes;

  -- Essaie chaque candidat dans l'ordre de PRÉFÉRENCE d'origine (pas l'ordre
  -- trié ci-dessus, qui ne sert qu'au verrouillage) — reproduit la même
  -- politique que l'ancien calcul JS (praticien choisi par le client en
  -- premier, sinon le premier praticien libre trouvé).
  FOREACH v_candidate IN ARRAY p_candidate_staff_ids LOOP
    SELECT EXISTS (
      SELECT 1
      FROM bookings b
      JOIN services s ON s.id = b.service_id
      WHERE b.staff_id = v_candidate
        AND b.date = p_date
        AND b.status != 'cancelled'
        AND (extract(hour from b.time)::int * 60 + extract(minute from b.time)::int)
            < v_slot_end
        AND (extract(hour from b.time)::int * 60 + extract(minute from b.time)::int
             + coalesce(s.duration_minutes, 30))
            > v_slot_start
    ) INTO v_busy;

    IF NOT v_busy THEN
      v_assigned := v_candidate;
      EXIT;
    END IF;
  END LOOP;

  IF v_assigned IS NULL THEN
    RETURN; -- aucun praticien libre — 0 ligne, l'appelant traite ça comme un 409
  END IF;

  RETURN QUERY
  INSERT INTO bookings (
    biz_id, biz_name, service_id, service_name, staff_id, staff_name,
    date, time, status, client_id, client_phone, client_name, client_email
  )
  SELECT
    p_biz_id, p_biz_name, p_service_id, p_service_name, v_assigned, st.name,
    p_date, p_time, 'active', p_client_id, p_client_phone, p_client_name, p_client_email
  FROM staff st WHERE st.id = v_assigned
  RETURNING *;
END;
$$;

-- Durcissement : par défaut Postgres accorde EXECUTE à PUBLIC sur une nouvelle
-- fonction. Cette fonction est SECURITY DEFINER et n'est appelée que depuis
-- create/route.ts via le client service_role (jamais une clé anon/authenticated
-- exposée côté client) — on retire l'accès public par prudence, même si le
-- risque réel est faible tant que la clé service_role reste côté serveur.
REVOKE EXECUTE ON FUNCTION assign_staff_and_create_booking(
  uuid, text, uuid, text, date, time, int, uuid[], uuid, text, text, text
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION assign_staff_and_create_booking(
  uuid, text, uuid, text, date, time, int, uuid[], uuid, text, text, text
) TO service_role;
