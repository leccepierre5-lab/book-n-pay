-- 0033_balance_payment_tracking.sql
-- Suivi du paiement du solde de prestation via Stripe Connect (mode "App" de
-- CaisseEncaissement) : une Checkout Session dédiée, distincte de celle des
-- frais de réservation, dont l'état sert à piloter l'écran de caisse (QR
-- affiché en attente vs. solde confirmé) et l'idempotence (pas de double
-- session Stripe sur double-clic).
--
-- Pas de colonne d'expiration dédiée : la session Stripe elle-même (champ
-- `status`, interrogé en direct via l'API au moment du clic) fait foi pour
-- savoir si une session `pending` est encore valide ou expirée — évite une
-- source de vérité dupliquée et désynchronisable.
ALTER TABLE booking_members
  ADD COLUMN solde_checkout_session_id text NULL,
  ADD COLUMN balance_payment_status text NOT NULL DEFAULT 'none';

ALTER TABLE booking_members
  ADD CONSTRAINT balance_payment_status_check
  CHECK (balance_payment_status IN ('none', 'pending', 'paid', 'expired'));

COMMENT ON COLUMN booking_members.solde_checkout_session_id IS
  'ID de la Checkout Session Stripe Connect créée pour le paiement du solde (mode App). NULL si aucune tentative en cours.';
COMMENT ON COLUMN booking_members.balance_payment_status IS
  'none = pas de paiement du solde en ligne tenté ; pending = session créée, en attente du client ; paid = confirmé par le webhook (status membre passe alors à arrived) ; expired = session précédente expirée, avant régénération.';
