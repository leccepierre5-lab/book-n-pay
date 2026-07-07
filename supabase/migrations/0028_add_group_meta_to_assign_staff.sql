-- 0028_staff_assign_group_meta.sql
-- Ajoute group_ref/payment_deadline à assign_staff_and_create_booking (0024),
-- posés directement dans l'INSERT — pas via un UPDATE de suivi séparé après
-- coup (stampGroupMetaForStaffBranch dans create-group/route.ts).
--
-- ⚠️ Comme les migrations précédentes, à exécuter manuellement dans le
-- Supabase SQL Editor.
--
-- Le corps ci-dessous est recopié tel quel depuis le pg_get_functiondef()
-- collé par l'utilisateur le 07/07/2026 (corps réel en base, confirmé
-- identique au fichier local 0024). SEULES modifications apportées :
--   1. Signature : p_group_ref text DEFAULT NULL, p_payment_deadline
--      timestamptz DEFAULT NULL ajoutés en positions 13-14.
--   2. INSERT : colonnes group_ref, payment_deadline ajoutées (juste après
--      status, avant client_id — même position que 0027 sur
--      create_booking_with_capacity_check, pour rester cohérent).
--   3. SELECT correspondant : p_group_ref, p_payment_deadline ajoutés à la
--      même position que les colonnes ci-dessus.
-- Aucune autre ligne touchée : verrou trié anti-deadlock, calcul
-- v_slot_start/v_slot_end, les deux RETURN; vides (pas de RAISE EXCEPTION),
-- la jointure staff pour staff_name — tout est inchangé.
--
-- ⚠️ CREATE OR REPLACE FUNCTION ne peut PAS changer le nombre/types
-- d'arguments d'une fonction existante — Postgres identifie une fonction par
-- (schéma, nom, types de paramètres). D'où le DROP FUNCTION explicite de
-- l'ancienne signature 12-arg AVANT le CREATE de la nouvelle, ci-dessous
-- (déjà vu avec 0026/0027).
--
-- ⚠️ VÉRIFICATION OBLIGATOIRE APRÈS EXÉCUTION :
--   SELECT p.oid::regprocedure AS signature,
--          pg_get_function_identity_arguments(p.oid) AS args
--   FROM pg_proc p
--   WHERE p.proname = 'assign_staff_and_create_booking';
-- Doit renvoyer EXACTEMENT UNE ligne, avec les 14 arguments listés plus bas.
-- Si plus d'une ligne apparaît, une fonction fantôme existe (12-arg non
-- droppée, ou une surcharge accidentelle) — ne pas considérer la migration
-- terminée tant que ce n'est pas une seule ligne.

DROP FUNCTION IF EXISTS assign_staff_and_create_booking(
  uuid, text, uuid, text, date, time, integer, uuid[], uuid, text, text, text
);

CREATE OR REPLACE FUNCTION public.assign_staff_and_create_booking(p_biz_id uuid, p_biz_name text, p_service_id uuid, p_service_name text, p_date date, p_time time without time zone, p_duration_minutes integer, p_candidate_staff_ids uuid[], p_client_id uuid, p_client_phone text, p_client_name text, p_client_email text, p_group_ref text DEFAULT NULL, p_payment_deadline timestamp with time zone DEFAULT NULL)
 RETURNS SETOF bookings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    RETURN;
  END IF;

  RETURN QUERY
  INSERT INTO bookings (
    biz_id, biz_name, service_id, service_name, staff_id, staff_name,
    date, time, status, group_ref, payment_deadline, client_id, client_phone, client_name, client_email
  )
  SELECT
    p_biz_id, p_biz_name, p_service_id, p_service_name, v_assigned, st.name,
    p_date, p_time, 'active', p_group_ref, p_payment_deadline, p_client_id, p_client_phone, p_client_name, p_client_email
  FROM staff st WHERE st.id = v_assigned
  RETURNING *;
END;
$function$;

REVOKE EXECUTE ON FUNCTION assign_staff_and_create_booking(
  uuid, text, uuid, text, date, time, integer, uuid[], uuid, text, text, text, text, timestamptz
) FROM anon, authenticated, PUBLIC;

GRANT EXECUTE ON FUNCTION assign_staff_and_create_booking(
  uuid, text, uuid, text, date, time, integer, uuid[], uuid, text, text, text, text, timestamptz
) TO service_role;
