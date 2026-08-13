-- supabase/migrations/0050_pro_charges_invoicing.sql
-- Facturation effective des pro_charges (jusqu'ici créées mais jamais
-- facturées, cf. commentaire ProDashboard.tsx du 11/08). Voir
-- src/lib/stripe/pro-charge-billing.ts pour la logique.
--
-- stripe_invoice_item_id : posé dès que l'invoice item Stripe est créé (en
-- attente de la prochaine facture d'abonnement du pro) — sert à faire
-- correspondre une charge à la ligne de facture qui l'a réellement payée
-- (invoice.lines.data[].invoice_item) lors de invoice.payment_succeeded.
--
-- stripe_invoice_id : posé une fois la charge effectivement rapprochée
-- d'une facture payée (subscription normale OU facture autonome créée à
-- la résiliation, collection_method='send_invoice').
--
-- waived_by SANS FK vers app_users(id) — contrairement à
-- business_deletion_log.requested_by, PAS pour la même raison : les
-- comptes admin ne sont jamais supprimés (seuls les comptes pro le sont,
-- voir migration 0048), une FK ici serait donc sûre. Choix quand même
-- délibéré : NULL doit pouvoir signifier "waived automatique (système,
-- montant sous le seuil de facturation)", distinct de "waived décidé par
-- un admin identifié" — une FK NOT NULL empêcherait ce cas, une FK
-- nullable serait indiscernable d'un oubli. waived_reason porte donc
-- TOUJOURS la distinction explicite en clair.
ALTER TABLE pro_charges
  ADD COLUMN IF NOT EXISTS stripe_invoice_item_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_invoice_id TEXT,
  ADD COLUMN IF NOT EXISTS waived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS waived_by UUID,
  ADD COLUMN IF NOT EXISTS waived_reason TEXT;

-- Rapprochement webhook (invoice.payment_succeeded) : ne scanner que les
-- charges pending qui ont réellement un invoice item en attente.
CREATE INDEX IF NOT EXISTS idx_pro_charges_pending_invoice_item
  ON pro_charges (biz_id, stripe_invoice_item_id)
  WHERE status = 'pending' AND stripe_invoice_item_id IS NOT NULL;
