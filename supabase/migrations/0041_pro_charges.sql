-- supabase/migrations/0041_pro_charges.sql
-- Frais de gestion à la charge du pro en cas d'annulation PRO (C15,
-- pro/cancel-booking/route.ts) : jusqu'ici Book'nPay conservait les frais de
-- gestion même quand c'est le PRO qui annule — le client paie sans faute et
-- sans prestation, ce qui expose à un risque de clause abusive. Correction :
-- le client est intégralement remboursé (frais de réservation + frais de
-- gestion), et les frais de gestion sont refacturés au pro via cette table.
--
-- Une row = un montant dû par le pro à Book'nPay, en attente de facturation.
-- La facturation effective (rapprochement avec l'abonnement mensuel) n'est
-- PAS traitée ici — les lignes restent en 'pending' jusqu'à ce qu'un lot
-- ultérieur les rapproche de la facture Stripe mensuelle. Acceptable au
-- lancement, volume nul (seul le chemin annulation pro alimente la table
-- pour l'instant).
--
-- Colonne biz_id, PAS pro_id : toutes les tables de facturation existantes
-- (overage_charges, business_settings) sont ancrées sur le business, jamais
-- sur l'app_users qui a déclenché l'action — un admin peut annuler un RDV
-- pour le compte d'un pro (voir l'autorisation `role==='admin'` dans
-- pro/cancel-booking/route.ts), la charge doit dans ce cas rester rattachée
-- au business concerné, pas à l'admin. Même convention que overage_charges
-- (migration 0020), le précédent le plus proche de cette table.
CREATE TABLE IF NOT EXISTS pro_charges (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  biz_id       UUID         NOT NULL REFERENCES businesses(id),
  booking_id   UUID         NOT NULL REFERENCES bookings(id),
  type         TEXT         NOT NULL
    CONSTRAINT chk_pro_charge_type
    CHECK (type IN ('management_fee_pro_cancellation')),
  amount_cents INT          NOT NULL,
  currency     TEXT         NOT NULL DEFAULT 'eur',
  status       TEXT         NOT NULL DEFAULT 'pending'
    CONSTRAINT chk_pro_charge_status
    CHECK (status IN ('pending', 'invoiced', 'waived')),
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  invoiced_at  TIMESTAMPTZ,
  notes        TEXT
);

-- Idempotence : un rejeu de la même annulation (double-clic, requête
-- rejouée) ne doit jamais créer une seconde charge pour le même booking.
-- En pratique, la route s'arrête déjà plus tôt sur member.status==='cancelled'
-- avant d'atteindre l'insertion — cette contrainte est le filet en cas de
-- requêtes concurrentes qui passeraient ce garde-fou en même temps.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pro_charges_booking_type
  ON pro_charges (booking_id, type);

-- Dashboard pro (getProStats) : somme des charges 'pending' d'un business.
CREATE INDEX IF NOT EXISTS idx_pro_charges_biz_pending
  ON pro_charges (biz_id)
  WHERE status = 'pending';

-- RLS : même pattern que business_settings/services (0022_rls_snapshot) —
-- le pro lit ses propres charges via owns_biz(biz_id) (dashboard, requête
-- passée par la session utilisateur, pas le service role). Écriture
-- réservée au service role (route C15) : aucune policy INSERT/UPDATE/DELETE,
-- comme overage_charges (le pro ne doit jamais pouvoir créer/modifier une
-- charge lui-même).
ALTER TABLE pro_charges ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'pro_charges' AND policyname = 'pro_charges_select') THEN
    CREATE POLICY pro_charges_select ON pro_charges FOR SELECT TO public USING (is_admin() OR owns_biz(biz_id));
  END IF;
END $$;
