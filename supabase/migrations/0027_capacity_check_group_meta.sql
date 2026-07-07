-- 0027_capacity_check_group_meta.sql
-- Ajoute group_ref/payment_deadline à create_booking_with_capacity_check
-- (0026), posés directement dans l'INSERT — pas via un UPDATE de suivi
-- séparé après coup.
--
-- ⚠️ Comme les migrations précédentes, à exécuter manuellement dans le
-- Supabase SQL Editor.
--
-- Pourquoi cette migration plutôt qu'un UPDATE applicatif après l'insert
-- (approche essayée puis abandonnée le 06/07/2026) : group_ref est lu
-- immédiatement par le flux de paiement de groupe (group/pending-status,
-- côté organisateur) — poser ces deux colonnes en un deuxième temps crée une
-- fenêtre non-atomique où la ligne existe sans son group_ref, et l'orchestration
-- du rollack applicatif autour de cette étape supplémentaire a déjà produit un
-- bug réel (ordre push/UPDATE incorrect au premier jet). La version atomique
-- élimine les deux : tout est posé dans la même transaction que l'insert,
-- rien à orchestrer séparément.
--
-- ⚠️ CREATE OR REPLACE FUNCTION ne peut PAS changer le nombre/types
-- d'arguments d'une fonction existante — Postgres identifie une fonction par
-- (schéma, nom, types de paramètres). Passer de 12 à 14 arguments avec un
-- simple CREATE OR REPLACE créerait une DEUXIÈME fonction surchargée à côté
-- de l'ancienne, pas un remplacement (déjà documenté dans 0026 après
-- l'incident du même type). D'où le DROP FUNCTION explicite de l'ancienne
-- signature 12-arg AVANT le CREATE de la nouvelle, ci-dessous.
--
-- ⚠️ VÉRIFICATION OBLIGATOIRE APRÈS EXÉCUTION (ne pas sauter cette fois) :
--   SELECT p.oid::regprocedure AS signature,
--          pg_get_function_identity_arguments(p.oid) AS args
--   FROM pg_proc p
--   WHERE p.proname = 'create_booking_with_capacity_check';
-- Doit renvoyer EXACTEMENT UNE ligne, avec les 14 arguments listés plus bas.
-- Si plus d'une ligne apparaît, une fonction fantôme existe (12-arg non
-- droppée, ou une surcharge accidentelle) — ne pas considérer la migration
-- terminée tant que ce n'est pas une seule ligne.
--
-- ⚠️ CORRIGÉ le 08/07/2026 : ce fichier avait un délimiteur de corps de
-- fonction cassé (ouverture $func$ / fermeture $$, jamais exécutable tel
-- quel — voir [[project_bnp_pitfalls]] point 29, un fichier local peut
-- diverger de la prod même après un "Success" apparent). Corps ci-dessous
-- réécrit pour correspondre EXACTEMENT à la sortie de
-- `pg_get_functiondef('create_booking_with_capacity_check(...)'::regprocedure)`
-- collée par l'utilisateur le 08/07/2026 — délimiteur $function$ partout,
-- aucun commentaire à l'intérieur du corps (la prod n'en a pas).

DROP FUNCTION IF EXISTS create_booking_with_capacity_check(
  uuid, text, uuid, text, uuid, text, date, time, uuid, text, text, text
);

-- Problème corrigé par la fonction elle-même (inchangé depuis 0026) : la
-- branche "service collectif" de src/app/api/bookings/create/route.ts (et la
-- boucle d'insertion de src/app/api/bookings/create-group/route.ts) insère
-- directement dans bookings sans jamais vérifier services.max_persons. Deux
-- clients qui réservent la même prestation/date/heure/praticien en même
-- temps peuvent tous les deux passer, même si ça dépasse la capacité
-- annoncée. Même famille de bug que 0024 (staff), mais côté capacité.
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
-- court-circuit avant même de compter quoi que ce soit.
--
-- Compte les lignes de `bookings` (pas `booking_members` — ce compteur-là
-- sert à un mécanisme différent, rejoindre une réservation existante via
-- group/route.ts, sans rapport avec cette fonction).
--
-- p_group_ref/p_payment_deadline (nouveau) : NULL pour une réservation
-- individuelle (create/route.ts), valeurs réelles pour une réservation de
-- groupe (create-group/route.ts) — postés directement dans l'INSERT, jamais
-- recalculés ni validés ici (ce sont des métadonnées d'affichage/paiement,
-- pas des données qui affectent la vérification de capacité elle-même).
--
-- Corps ci-dessous : copie exacte de pg_get_functiondef (prod, 08/07/2026),
-- sans commentaire interne — ne pas en réintroduire sans re-render en base.
CREATE OR REPLACE FUNCTION public.create_booking_with_capacity_check(p_biz_id uuid, p_biz_name text, p_service_id uuid, p_service_name text, p_staff_id uuid, p_staff_name text, p_date date, p_time time without time zone, p_client_id uuid, p_client_phone text, p_client_name text, p_client_email text, p_group_ref text DEFAULT NULL::text, p_payment_deadline timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS SETOF bookings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_max_persons int;
  v_current_count int;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      p_service_id::text || ':' || p_date::text || ':' || p_time::text || ':' || coalesce(p_staff_id::text, 'null'),
      0
    )
  );
  SELECT max_persons INTO v_max_persons FROM services WHERE id = p_service_id;
  IF v_max_persons IS NOT NULL THEN
    SELECT count(*) INTO v_current_count
    FROM bookings b
    WHERE b.service_id = p_service_id
      AND b.date = p_date
      AND b.time = p_time
      AND b.staff_id IS NOT DISTINCT FROM p_staff_id
      AND b.status != 'cancelled';
    IF v_current_count >= v_max_persons THEN
      RAISE EXCEPTION 'capacity_full' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN QUERY
  INSERT INTO bookings (biz_id, biz_name, service_id, service_name, staff_id, staff_name, date, time, status, group_ref, payment_deadline, client_id, client_phone, client_name, client_email)
  VALUES (p_biz_id, p_biz_name, p_service_id, p_service_name, p_staff_id, p_staff_name, p_date, p_time, 'active', p_group_ref, p_payment_deadline, p_client_id, p_client_phone, p_client_name, p_client_email)
  RETURNING *;
END;
$function$
;

-- Index déjà créé par 0026 (IF NOT EXISTS, indépendant de la signature de
-- la fonction) — rien à refaire ici.

-- Durcissement : comme 0024/0026, REVOKE FROM PUBLIC seul ne suffit pas —
-- anon et authenticated ont des GRANT EXECUTE explicites par défaut sur
-- Supabase, indépendants de PUBLIC — donc ils sont ciblés nommément ici
-- aussi, avec la nouvelle signature 14-arg.
REVOKE EXECUTE ON FUNCTION create_booking_with_capacity_check(
  uuid, text, uuid, text, uuid, text, date, time, uuid, text, text, text, text, timestamptz
) FROM anon, authenticated, PUBLIC;

GRANT EXECUTE ON FUNCTION create_booking_with_capacity_check(
  uuid, text, uuid, text, uuid, text, date, time, uuid, text, text, text, text, timestamptz
) TO service_role;
