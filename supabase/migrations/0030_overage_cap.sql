-- 0030_overage_cap.sql
-- Plafond des frais de depassement mensuels (voir OVERAGE_CAP_MARGIN,
-- plans-config.ts) : protege un pro en gros depassement contre un montant
-- punitif. Plie increment + calcul du plafond + insertion de la charge dans
-- une seule fonction atomique, sous le meme verrou de ligne que l'increment
-- (business_settings), pour eviter toute race condition sur le cumul du
-- cycle en cours (deux webhooks simultanes ne doivent jamais pouvoir
-- depasser le plafond a eux deux).

-- Garde-fou idempotence par reservation : rend toute la fonction ci-dessous
-- idempotente independamment du statut 'completed' du booking (protection
-- deja existante, webhook route.ts, mais qui ne couvre que le cas de rejeu
-- sequentiel — celle-ci ferme aussi le cas d'un vrai appel concurrent).
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS overage_processed_at TIMESTAMPTZ;

-- Nouveau statut 'capped' : ligne tracee a 0€ quand le plafond du cycle est
-- atteint (ou que le reste tombe sous le minimum de charge Stripe, 0,50€) —
-- permet de compter les reservations "offertes" pour le bandeau de
-- transparence et la proposition d'upgrade, sans tenter une charge Stripe
-- vouee a l'echec.
ALTER TABLE overage_charges DROP CONSTRAINT chk_overage_charge_status;
ALTER TABLE overage_charges ADD CONSTRAINT chk_overage_charge_status
  CHECK (status IN ('pending', 'paid', 'retry_scheduled', 'failed', 'invoiced', 'capped'));

-- Derive de schema confirmee (SQL Editor, session du 11/07/2026) : cette
-- contrainte existe deja en prod (overage_charges_booking_id_unique) mais
-- n'avait jamais ete posee via une migration versionnee dans le repo —
-- probablement ajoutee a la main lors du chantier anti-double-debit du
-- 09/07. Versionnee ici a titre documentaire, idempotent (ne fait rien si
-- deja presente, ne casse pas le run sur la prod existante ni sur un
-- environnement vierge qui ne l'aurait pas encore).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'overage_charges_booking_id_unique'
  ) THEN
    ALTER TABLE overage_charges
      ADD CONSTRAINT overage_charges_booking_id_unique UNIQUE (booking_id);
  END IF;
END $$;

-- Accelere le SUM(amount_ht) du cycle en cours (etape 3 de la fonction),
-- filtre sur biz_id + fenetre temporelle.
CREATE INDEX IF NOT EXISTS idx_overage_charges_biz_created
  ON overage_charges (biz_id, created_at);

-- Remplace increment_booking_count — un seul appelant dans tout le repo
-- (src/lib/stripe/overageCharge.ts:59, reecrit dans le meme chantier),
-- verifie par grep avant de dropper.
DROP FUNCTION IF EXISTS increment_booking_count(UUID);

-- p_cap_tiers : JSONB, liste ordonnee croissante des paliers AU-DESSUS du
-- plan actuel, ex. Starter -> [{"quota":300,"price":139},{"quota":null,"price":299}],
-- Business -> [{"quota":null,"price":299}]. Construite cote TS depuis
-- BNP_PLANS (source de verite unique des prix/quotas) et passee en parametre
-- a chaque appel — aucune duplication des prix en dur ici, donc aucune
-- migration necessaire si les prix changent un jour.
CREATE OR REPLACE FUNCTION increment_booking_count_and_charge(
  p_biz_id UUID,
  p_booking_id UUID,
  p_fee_ht NUMERIC,
  p_stripe_min_ht NUMERIC,
  p_quota INT,
  p_current_price NUMERIC,
  p_cap_tiers JSONB,
  p_cap_margin NUMERIC
)
RETURNS TABLE(new_count INT, charge_amount NUMERIC, charge_id UUID, overage_status TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_processed UUID;
  v_new_count INT;
  v_cycle_start TIMESTAMPTZ;
  v_tier JSONB;
  v_tier_quota INT;
  v_tier_price NUMERIC;
  v_cap_ht NUMERIC;
  v_already_charged NUMERIC;
  v_remaining NUMERIC;
  v_charge_amount NUMERIC;
  v_charge_id UUID;
BEGIN
  -- 0) Idempotence par reservation, avant tout le reste. Verrou de ligne sur
  -- bookings.id : un appel concurrent pour le meme booking_id bloque ici
  -- jusqu'au commit du premier, puis ne voit plus overage_processed_at a
  -- NULL — donc un seul appel peut jamais atteindre les INSERT plus bas
  -- pour un meme booking_id (la contrainte UNIQUE ci-dessous est un
  -- filet de securite, pas une protection normalement sollicitee).
  UPDATE bookings SET overage_processed_at = NOW()
    WHERE id = p_booking_id AND overage_processed_at IS NULL
    RETURNING id INTO v_processed;

  IF v_processed IS NULL THEN
    RETURN QUERY SELECT NULL::INT, 0::NUMERIC, NULL::UUID, 'already_processed'::TEXT;
    RETURN;
  END IF;

  -- 1) Increment + verrou de ligne (comme l'ancien increment_booking_count),
  -- recupere reset_at au passage, zero round-trip supplementaire.
  UPDATE business_settings
    SET monthly_bookings_count = monthly_bookings_count + 1
    WHERE biz_id = p_biz_id
    RETURNING monthly_bookings_count, bookings_count_reset_at
    INTO v_new_count, v_cycle_start;

  IF p_quota IS NULL OR v_new_count <= p_quota THEN
    RETURN QUERY SELECT v_new_count, 0::NUMERIC, NULL::UUID, 'included'::TEXT;
    RETURN;
  END IF;

  -- 2) Palier de reference : le premier tier (ordre croissant) dont le
  -- quota couvre le volume reel, quota NULL = toujours couvrant (Scale).
  -- Invariant suppose : p_cap_tiers n'est jamais vide quand p_quota n'est
  -- pas NULL (garanti cote TS pour starter/business).
  FOR v_tier IN SELECT * FROM jsonb_array_elements(p_cap_tiers)
  LOOP
    v_tier_quota := (v_tier->>'quota')::INT;
    v_tier_price := (v_tier->>'price')::NUMERIC;
    IF v_tier_quota IS NULL OR v_tier_quota >= v_new_count THEN
      EXIT;
    END IF;
  END LOOP;

  v_cap_ht := v_tier_price + p_cap_margin - p_current_price;

  -- 3) Cumul deja facture ce cycle — protege par le verrou de ligne pris
  -- en 1 : un 2e appel concurrent pour le meme biz_id est bloque a
  -- l'UPDATE tant que celui-ci n'a pas committe, donc voit forcement ce
  -- SUM a jour avant de decider.
  SELECT COALESCE(SUM(amount_ht), 0) INTO v_already_charged
    FROM overage_charges
    WHERE biz_id = p_biz_id AND created_at >= v_cycle_start;

  v_remaining := v_cap_ht - v_already_charged;

  -- 4) Plafond atteint OU reste sous le minimum de charge Stripe (0,50€) —
  -- trace a 0€ plutot que de tenter une charge vouee a l'echec. Arrondi
  -- toujours en faveur du pro (jamais au-dessus du plafond promis).
  -- ON CONFLICT DO NOTHING : filet de securite si la contrainte UNIQUE
  -- (booking_id) etait quand meme sollicitee (cas juge impossible par le
  -- garde-fou de l'etape 0, voir commentaire) — no-op propre plutot que
  -- de faire planter la transaction sur une exception non geree.
  IF v_remaining < p_stripe_min_ht THEN
    INSERT INTO overage_charges (biz_id, booking_id, amount_ht, status)
      VALUES (p_biz_id, p_booking_id, 0, 'capped')
      ON CONFLICT (booking_id) DO NOTHING
      RETURNING id INTO v_charge_id;

    IF v_charge_id IS NULL THEN
      RETURN QUERY SELECT v_new_count, 0::NUMERIC, NULL::UUID, 'already_processed'::TEXT;
      RETURN;
    END IF;

    RETURN QUERY SELECT v_new_count, 0::NUMERIC, v_charge_id, 'capped'::TEXT;
    RETURN;
  END IF;

  -- 5) Charge pleine ou degressive. Meme filet ON CONFLICT qu'en 4.
  v_charge_amount := LEAST(p_fee_ht, v_remaining);
  INSERT INTO overage_charges (biz_id, booking_id, amount_ht, status)
    VALUES (p_biz_id, p_booking_id, v_charge_amount, 'pending')
    ON CONFLICT (booking_id) DO NOTHING
    RETURNING id INTO v_charge_id;

  IF v_charge_id IS NULL THEN
    RETURN QUERY SELECT v_new_count, 0::NUMERIC, NULL::UUID, 'already_processed'::TEXT;
    RETURN;
  END IF;

  RETURN QUERY SELECT v_new_count, v_charge_amount, v_charge_id, 'overage'::TEXT;
END;
$$;

-- Durcissement identique aux RPC precedentes (0026/0028) : REVOKE FROM
-- PUBLIC seul ne suffit pas, anon/authenticated ont des GRANT EXECUTE
-- explicites par defaut sur Supabase.
REVOKE EXECUTE ON FUNCTION increment_booking_count_and_charge(
  UUID, UUID, NUMERIC, NUMERIC, INT, NUMERIC, JSONB, NUMERIC
) FROM anon, authenticated, PUBLIC;

GRANT EXECUTE ON FUNCTION increment_booking_count_and_charge(
  UUID, UUID, NUMERIC, NUMERIC, INT, NUMERIC, JSONB, NUMERIC
) TO service_role;
