-- 0020_overage_charges.sql
-- Hors-forfait pro : suivi des charges de 3,99 euros HT au-dela du quota et de
-- la marge de grace (OVERAGE_GRACE=5, voir src/lib/plans-config.ts).
--
-- Une row = une tentative de facturation d un depassement (1 reservation payee
-- au-dela du quota plus grace = 1 row). Cycle de vie du statut :
--   pending          -> row creee, tentative de PaymentIntent immediate (webhook checkout.session.completed)
--   paid             -> PaymentIntent reussi, termine
--   retry_scheduled  -> echec de la tentative immediate, retry planifie a plus 24h
--   failed           -> echec du retry (cron retry-overage-charges) -> bandeau urgent pro
--   invoiced         -> regroupee avec les autres impayes dans une Facture Stripe
--                       separee au renouvellement mensuel (invoice.payment_succeeded)
--
-- Table plutot qu une colonne agregee sur business_settings : permet de tracer
-- individuellement quelle charge doit etre retentee et quand (next_retry_at),
-- sans race condition sur un simple UPDATE SET amount = amount + 3.99
-- si deux reservations basculent en overage au meme moment.

CREATE TABLE IF NOT EXISTS overage_charges (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  biz_id                    UUID        NOT NULL REFERENCES businesses(id),
  booking_id                UUID        REFERENCES bookings(id),
  amount_ht                 NUMERIC(6,2) NOT NULL DEFAULT 3.99,
  status                    TEXT        NOT NULL DEFAULT 'pending'
    CONSTRAINT chk_overage_charge_status
    CHECK (status IN ('pending', 'paid', 'retry_scheduled', 'failed', 'invoiced')),
  stripe_payment_intent_id  TEXT,
  attempt_count             INT         NOT NULL DEFAULT 0,
  next_retry_at             TIMESTAMPTZ,
  stripe_invoice_id         TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  charged_at                TIMESTAMPTZ,
  invoiced_at                TIMESTAMPTZ
);

-- Cron retry-overage-charges : selectionne les charges dues, filtre partiel
-- pour ne scanner que les rows reellement en attente.
CREATE INDEX IF NOT EXISTS idx_overage_charges_retry
  ON overage_charges (next_retry_at)
  WHERE status = 'retry_scheduled';

-- Endpoint /api/pro/overage-status + facturation de fin de mois : somme des
-- impayes d'un pro donne.
CREATE INDEX IF NOT EXISTS idx_overage_charges_biz_unpaid
  ON overage_charges (biz_id)
  WHERE status IN ('retry_scheduled', 'failed');

-- Increment atomique du compteur mensuel de reservations d'un pro.
-- Appele depuis le webhook checkout.session.completed (paiement confirme),
-- retourne le nouveau total + le plan en cours pour evaluer getOverageStatus()
-- juste apres, sans requete supplementaire.
CREATE OR REPLACE FUNCTION increment_booking_count(p_biz_id UUID)
RETURNS TABLE(new_count INT, plan_key TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE business_settings
  SET monthly_bookings_count = monthly_bookings_count + 1
  WHERE biz_id = p_biz_id
  RETURNING monthly_bookings_count, business_settings.plan_key;
$$;
