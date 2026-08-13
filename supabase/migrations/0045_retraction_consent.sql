-- 0045_retraction_consent.sql
-- Preuve de consentement au renoncement du droit de rétractation (14 jours,
-- art. L221-28 1° C. conso — exécution pleine et entière avant la fin du
-- délai, avec accord exprès du consommateur). Mécanisme technique, texte
-- affiché provisoire (voir RETRACTION_CONSENT_TEXT dans lib/legal.ts,
-- version "draft-1" — à remplacer après validation CCI/juriste).
--
-- Sur booking_members (pas bookings) : c'est l'entité qui porte l'acte de
-- paiement individuel (status invite→paid), donc l'acte de consentement,
-- même raisonnement que cgu_accepted_at sur app_users/partner_applications.
--
-- Nullable, sans DEFAULT : les réservations existantes n'ont pas consenti,
-- rien ne doit se substituer à une non-réponse (leçon monthly_bookings_estimate).
--
-- ⚠️ user_agent / ip_address volontairement PAS ajoutés ici — implication
-- RGPD (durée de conservation, mention CGU) à trancher par Pierre avant tout
-- ajout, voir échange du 13/08.
--
-- ⚠️ Comme les migrations précédentes, à exécuter manuellement dans le
-- Supabase SQL Editor (pas de DATABASE_URL disponible dans cet environnement).

ALTER TABLE booking_members
  ADD COLUMN IF NOT EXISTS retraction_consent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS retraction_consent_version TEXT;
