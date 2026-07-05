-- 0025_cgu_acceptance.sql
-- Preuve d'acceptation des CGU/CGV, sur les deux points d'entrée où un
-- utilisateur s'engage avant d'avoir un compte actif :
--   app_users.cgu_accepted_at         : coché à l'inscription client (RegisterForm)
--   partner_applications.cgu_accepted_at : coché à la candidature pro (PartnerApplicationForm)
-- cgu_version trace QUELLE version du texte /cgu a été acceptée, pour rester
-- opposable si le texte est modifié plus tard sans que l'utilisateur ait eu
-- à re-accepter la nouvelle version.
-- Toutes les colonnes sont nullable : aucune valeur rétroactive n'est
-- inventée pour les comptes/candidatures déjà existants (on ne peut pas
-- prouver une acceptation qui n'a pas eu lieu).
--
-- ⚠️ Comme les migrations précédentes, à exécuter manuellement dans le
-- Supabase SQL Editor (pas de DATABASE_URL disponible dans cet environnement).

ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS cgu_accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cgu_version TEXT;

ALTER TABLE partner_applications
  ADD COLUMN IF NOT EXISTS cgu_accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cgu_version TEXT;
