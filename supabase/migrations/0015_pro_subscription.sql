-- 0015_pro_subscription.sql
-- Facturation des abonnements pro Book'nPay.
--
-- Deux objets Stripe distincts par pro :
--   stripe_account_id  (existant) = compte Connect — le pro RECOIT ses clients
--   stripe_customer_id (nouveau)  = Customer Billing — le pro PAIE son abonnement BnP
--
-- Etat des rows existantes apres migration :
--   plan_key               = 'starter'   (defaut)
--   subscription_status    = 'pending'   (defaut — pas encore dans le nouveau flux billing)
--   monthly_bookings_count = 0           (le quota repart a zero a l'activation du billing,
--                                         sans calcul retroactif — seul le prix est prorate
--                                         par Stripe pour la periode partielle)
--   bookings_count_reset_at = date du jour de la migration

ALTER TABLE business_settings
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT,

  ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT,

  ADD COLUMN IF NOT EXISTS plan_key TEXT NOT NULL DEFAULT 'starter'
    CONSTRAINT chk_plan_key
    CHECK (plan_key IN ('starter', 'business', 'scale')),

  ADD COLUMN IF NOT EXISTS payment_method_type TEXT
    CONSTRAINT chk_payment_method_type
    CHECK (payment_method_type IN ('card', 'sepa_debit')),

  ADD COLUMN IF NOT EXISTS stripe_payment_method_id TEXT,

  ADD COLUMN IF NOT EXISTS subscription_status TEXT NOT NULL DEFAULT 'pending'
    CONSTRAINT chk_subscription_status
    CHECK (subscription_status IN ('pending', 'active', 'past_due', 'cancelled')),

  ADD COLUMN IF NOT EXISTS subscription_start_date DATE,

  ADD COLUMN IF NOT EXISTS engagement_end_date DATE,

  ADD COLUMN IF NOT EXISTS next_billing_date DATE,

  ADD COLUMN IF NOT EXISTS monthly_bookings_count INT NOT NULL DEFAULT 0,

  ADD COLUMN IF NOT EXISTS bookings_count_reset_at DATE NOT NULL DEFAULT CURRENT_DATE;

-- Lookup Stripe Customer -> biz lors des webhooks de facturation
CREATE UNIQUE INDEX IF NOT EXISTS idx_biz_settings_stripe_customer
  ON business_settings (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

-- Lookup Stripe Subscription -> biz lors des webhooks de facturation
CREATE UNIQUE INDEX IF NOT EXISTS idx_biz_settings_stripe_subscription
  ON business_settings (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

-- Cron renouvellement : "abonnements actifs a J-30 de leur fin d'engagement"
-- Avertissement : delai legal loi Chatel a valider avec un juriste avant mise en prod.
CREATE INDEX IF NOT EXISTS idx_biz_settings_engagement_end
  ON business_settings (engagement_end_date)
  WHERE subscription_status = 'active';
