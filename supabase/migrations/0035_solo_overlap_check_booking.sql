-- 0035_solo_overlap_check_booking.sql
-- Anti-chevauchement par durée pour les pros SOLO (business sans staff actif).
--
-- ⚠️ Comme les migrations précédentes, à exécuter manuellement dans le
-- Supabase SQL Editor.
--
-- Trouvé en audit le 19/07/2026 (chantier dashboard pro, question "créneaux
-- libres" reformulée) : pour un service individuel (allow_group=false) d'un
-- business SANS staff configuré, ni l'affichage (availability/route.ts) ni
-- l'écriture (create_booking_with_capacity_check, 0026) ne tenaient jamais
-- compte de services.duration_minutes — seulement un comptage par tête à
-- l'heure EXACTE. Un service de 90 min réservé à 10:00 laissait 10:30/11:00
-- affichés libres, et rien n'empêchait un deuxième client d'y réserver une
-- prestation différente : double-RDV réel pour le pro. Seuls les business
-- avec staff actif étaient protégés (assign_staff_and_create_booking, 0024,
-- qui utilise bien la durée).
--
-- Fonction dédiée plutôt que modifier create_booking_with_capacity_check
-- (0026) : celle-ci reste correcte et intacte pour les services COLLECTIFS
-- (allow_group=true, capacité par tête à l'heure exacte — pas un
-- chevauchement à bloquer, plusieurs personnes sur un même cours est le
-- comportement voulu). Même principe de séparation déjà suivi par ce repo
-- (0026 avait délibérément évité de retoucher 0024 pour la même raison).
--
-- Décisions actées en revue (19/07) avant d'écrire ce fichier :
--
-- 1. CLÉ DE VERROU (biz_id, date), pas (service_id, date, time) comme 0026.
--    Un pro solo n'a qu'une seule ressource : lui-même. Un verrou par
--    service laisserait passer exactement le bug corrigé ici — deux
--    services DIFFÉRENTS chez le même solo ne partageraient alors aucun
--    verrou commun. Effet de bord accepté : toute tentative de réservation
--    individuelle sur ce business ce jour-là est sérialisée, quel que soit
--    le service — même compromis déjà accepté par
--    assign_staff_and_create_booking (0024, verrou par praticien/jour),
--    transposé à un solo qui n'a qu'un seul "praticien" (lui-même). Volume
--    réel d'un seul pro sur une seule journée : contention non significative.
--
-- 2. BORNES STRICTES pour le chevauchement (< / >, pas <= / >=) — pas une
--    nouvelle règle inventée ici, réutilise exactement la convention déjà
--    en prod : overlaps() côté JS (staff-availability.ts) et le calcul
--    équivalent dans assign_staff_and_create_booking (0024) côté SQL. Un
--    RDV qui finit exactement quand un autre commence (10:00-11:00 puis
--    11:00-12:00) est COMPATIBLE, pas un chevauchement.
--
-- 3. PÉRIMÈTRE — uniquement les réservations individuelles (services.
--    allow_group=false) du MÊME business, tous services confondus (voir
--    point 1), QUEL QUE SOIT staff_id de la ligne existante — pas de filtre
--    staff_id IS NULL. Corrigé en revue (19/07, second passage) : cette
--    fonction n'est appelée que pour un business SANS AUCUN staff actif
--    aujourd'hui (voir routing côté route.ts), mais d'anciennes réservations
--    peuvent porter un staff_id hérité d'une période où ce business avait du
--    staff, depuis désactivé. Filtrer sur staff_id IS NULL les aurait
--    rendues invisibles au chevauchement — un client aurait pu réserver
--    par-dessus un RDV bien réel : la cohérence lecture/écriture (même
--    filtre des deux côtés, voir computeSoloAvailabilityForDay) aurait évité
--    l'incohérence d'affichage mais pas la collision, les deux chemins
--    ignorant alors le même RDV. Un service collectif du même business
--    n'est en revanche jamais confronté ici (JOIN services + filtre
--    allow_group=false) — si un solo donne aussi des cours collectifs en
--    parallèle de ses prestations individuelles, ce croisement-là n'est pas
--    couvert : hors périmètre assumé (revue du 19/07), pas oublié.
--
-- 4. DONNÉES EXISTANTES — vérifié en lecture seule le 19/07 : 0 chevauchement
--    parmi les réservations individuelles solo actives en prod à cette date
--    (volume faible, produit jeune). Sans objet de toute façon : ceci n'est
--    pas une contrainte de table (pas de CHECK/EXCLUDE), seulement une
--    vérification applicative au moment de l'INSERT — aucune ligne
--    existante n'est jamais revalidée rétroactivement.
--
-- 5. MESSAGE D'ERREUR — 'slot_overlap', distinct de 'capacity_full' (0026),
--    pour que l'appelant JS (booking-solo-overlap.ts) puisse renvoyer un
--    message qui ne parle jamais de "praticien" (concept inexistant pour un
--    solo) : "Ce créneau chevauche une autre prestation déjà réservée."
--
-- 6. HORS PÉRIMÈTRE ASSUMÉ, explicitement, pas oublié : un service qui
--    déborderait sur le jour suivant (ex. 23h30 + 60 min) n'est PAS détecté
--    — même limitation déjà en prod sur assign_staff_and_create_booking
--    (0024), qui calcule aussi ses bornes en minutes-depuis-minuit sur une
--    seule journée (p_date). Aucune fixture/business réel n'a d'horaires
--    proches de minuit aujourd'hui, et le modèle open_time/close_time ne
--    supporte de toute façon pas un établissement ouvert au-delà de minuit
--    (limitation structurelle préexistante, indépendante de cette fonction).
--
-- 7. GARDE-FOU SERVICE — ajouté en revue (19/07, troisième passage) : le
--    routing empêche aujourd'hui d'appeler cette fonction pour un service
--    collectif ou d'un autre business, mais rien dans la fonction elle-même
--    ne le vérifiait — un appel erroné aurait inséré sans AUCUN contrôle de
--    capacité, en contournant create_booking_with_capacity_check (0026).
--    Même principe que la durée (ci-dessous) : ne pas faire confiance à
--    l'appelant. v_allow_group IS NOT FALSE (voir corps de fonction) ferme
--    d'un coup service introuvable, service d'un autre business et service
--    collectif — message 'invalid_service', distinct de 'slot_overlap',
--    remonté tel quel côté JS (pas de cas 409 attendu ici, juste un
--    garde-fou qui ne devrait jamais se déclencher en usage normal).
--
-- 8. STATUS IS DISTINCT FROM 'cancelled', pas != — ajouté en revue (19/07,
--    troisième passage). != 'cancelled' vaut NULL (donc exclut la ligne) si
--    status est NULL ; nullabilité de la colonne non confirmée faute
--    d'accès direct au schéma depuis cet environnement (pas de CLI Supabase
--    lié, pas de DATABASE_URL en local — information_schema n'est pas
--    exposé par l'API REST). Vérifié empiriquement en lecture seule le
--    19/07 : 0 ligne à NULL sur 18 bookings en prod à cette date — cohérent
--    avec une colonne NOT NULL mais pas une preuve. Coût nul si la colonne
--    est NOT NULL, donc IS DISTINCT FROM partout où ce filtre apparaît
--    (SELECT ci-dessous ET index) plutôt que de laisser un angle mort
--    silencieux si elle ne l'est pas.
--
-- durée TOUJOURS relue depuis `services` (jamais reçue en argument) — même
-- principe que max_persons dans create_booking_with_capacity_check : un
-- appelant ne doit pas pouvoir influencer la fenêtre de chevauchement
-- vérifiée.
CREATE OR REPLACE FUNCTION create_solo_booking_with_overlap_check(
  p_biz_id uuid,
  p_biz_name text,
  p_service_id uuid,
  p_service_name text,
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
  v_duration_minutes int;
  v_allow_group boolean;
  v_slot_start int;
  v_slot_end int;
  v_busy boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_biz_id::text || ':' || p_date::text, 0)
  );

  -- Le routing (create/route.ts, create-group/route.ts) n'appelle cette
  -- fonction que pour un service individuel du bon business — mais, même
  -- principe que la durée relue en base plutôt que reçue en argument :
  -- l'appelant n'est pas la garantie. v_allow_group reste NULL si aucune
  -- ligne ne correspond (service introuvable OU service d'un autre
  -- business, biz_id filtré ici) — IS NOT FALSE couvre alors ce cas et le
  -- cas allow_group=true (collectif) dans le même test. Sans ce garde-fou,
  -- un appel erroné sur un service collectif insérerait sans aucun contrôle
  -- de capacité, en contournant create_booking_with_capacity_check (0026).
  SELECT duration_minutes, allow_group INTO v_duration_minutes, v_allow_group
  FROM services WHERE id = p_service_id AND biz_id = p_biz_id;

  IF v_allow_group IS NOT FALSE THEN
    RAISE EXCEPTION 'invalid_service' USING ERRCODE = 'P0001';
  END IF;

  v_slot_start := extract(hour from p_time)::int * 60 + extract(minute from p_time)::int;
  v_slot_end := v_slot_start + coalesce(v_duration_minutes, 30);

  SELECT EXISTS (
    SELECT 1
    FROM bookings b
    JOIN services s ON s.id = b.service_id
    WHERE b.biz_id = p_biz_id
      AND b.date = p_date
      AND b.status IS DISTINCT FROM 'cancelled'
      AND s.allow_group = false
      AND (extract(hour from b.time)::int * 60 + extract(minute from b.time)::int)
          < v_slot_end
      AND (extract(hour from b.time)::int * 60 + extract(minute from b.time)::int
           + coalesce(s.duration_minutes, 30))
          > v_slot_start
  ) INTO v_busy;

  IF v_busy THEN
    RAISE EXCEPTION 'slot_overlap' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  INSERT INTO bookings (
    biz_id, biz_name, service_id, service_name, staff_id, staff_name,
    date, time, status, group_ref, payment_deadline,
    client_id, client_phone, client_name, client_email
  )
  VALUES (
    p_biz_id, p_biz_name, p_service_id, p_service_name, NULL, NULL,
    p_date, p_time, 'active', p_group_ref, p_payment_deadline,
    p_client_id, p_client_phone, p_client_name, p_client_email
  )
  RETURNING *;
END;
$$;

-- Sert la clause WHERE ci-dessus (biz_id, date, status IS DISTINCT FROM
-- 'cancelled') — même logique que l'index dédié ajouté par 0026 pour sa
-- propre clause de vérification. Pas de prédicat staff_id IS NULL ici (voir
-- point 3 plus haut sur le périmètre) : le SELECT porte sur toutes les
-- réservations individuelles du business ce jour-là, staff_id ou non — d'où
-- le nom (pas de "solo" dans le prédicat, il induirait en erreur). Prédicat
-- IS DISTINCT FROM plutôt que != : si status est un jour NULL sur une ligne
-- (nullabilité de la colonne non confirmée faute d'accès direct au schéma,
-- voir revue du 19/07), != l'exclurait silencieusement du chevauchement —
-- IS DISTINCT FROM la couvre sans coût si la colonne est NOT NULL.
CREATE INDEX IF NOT EXISTS idx_bookings_biz_date_active
  ON bookings (biz_id, date)
  WHERE status IS DISTINCT FROM 'cancelled';

-- Durcissement : comme 0024/0026, REVOKE FROM PUBLIC seul ne suffit pas —
-- anon et authenticated ont des GRANT EXECUTE explicites par défaut sur
-- Supabase, indépendants de PUBLIC — donc ils sont ciblés nommément ici
-- aussi. Fonction SECURITY DEFINER appelée uniquement depuis create/route.ts
-- et create-group/route.ts via le client service_role.
REVOKE EXECUTE ON FUNCTION create_solo_booking_with_overlap_check(
  uuid, text, uuid, text, date, time, uuid, text, text, text, text, timestamptz
) FROM anon, authenticated, PUBLIC;

GRANT EXECUTE ON FUNCTION create_solo_booking_with_overlap_check(
  uuid, text, uuid, text, date, time, uuid, text, text, text, text, timestamptz
) TO service_role;

-- ⚠️ VÉRIFICATION APRÈS EXÉCUTION (même réflexe que 0027, pitfall #29 —
-- un fichier local peut diverger de ce qui est réellement en base) :
--   SELECT p.oid::regprocedure AS signature,
--          pg_get_function_identity_arguments(p.oid) AS args
--   FROM pg_proc p
--   WHERE p.proname = 'create_solo_booking_with_overlap_check';
-- Doit renvoyer EXACTEMENT UNE ligne, 12 arguments.
