-- 0053_stripe_requirements.sql
-- Bloc C — surveillance des exigences KYC Stripe 2026 sur les comptes
-- Express des pros. Stripe contacte directement chaque compte concerné,
-- rien à collecter côté plateforme — mais chaque pro a une échéance
-- individuelle avant le 31/10/2026, au-delà de laquelle ses payouts sont
-- suspendus. Ces colonnes permettent de le voir venir (bandeau dashboard
-- pro, cf. étape 4) plutôt que de le découvrir au moment où un pro ne
-- reçoit plus ses virements.
--
-- ⚠️ Vérifié avant d'écrire cette migration : `stripe_account_id` (compte
-- Connect du pro) vit sur `business_settings` (biz_id en clé), PAS sur
-- `businesses` — voir stripe/connect-onboarding/route.ts et
-- stripe/connect-status/route.ts, qui lisent/écrivent déjà cette table.
-- Ces colonnes rejoignent donc business_settings, pas businesses.
ALTER TABLE business_settings
  ADD COLUMN IF NOT EXISTS stripe_charges_enabled BOOLEAN,

  ADD COLUMN IF NOT EXISTS stripe_payouts_enabled BOOLEAN,

  ADD COLUMN IF NOT EXISTS stripe_disabled_reason TEXT,

  ADD COLUMN IF NOT EXISTS stripe_currently_due TEXT[],

  ADD COLUMN IF NOT EXISTS stripe_past_due TEXT[],

  ADD COLUMN IF NOT EXISTS stripe_current_deadline TIMESTAMPTZ,

  ADD COLUMN IF NOT EXISTS stripe_future_due TEXT[],

  ADD COLUMN IF NOT EXISTS stripe_future_deadline TIMESTAMPTZ,

  ADD COLUMN IF NOT EXISTS stripe_requirements_synced_at TIMESTAMPTZ;

-- Cron/dashboard admin à venir : "comptes dont l'échéance approche" —
-- index partiel, la grande majorité des lignes ont cette colonne NULL
-- (aucune exigence en cours) et ne doivent jamais être scannées.
CREATE INDEX IF NOT EXISTS idx_biz_settings_stripe_current_deadline
  ON business_settings (stripe_current_deadline)
  WHERE stripe_current_deadline IS NOT NULL;
