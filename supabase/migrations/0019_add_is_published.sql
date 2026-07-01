-- 0019_add_is_published.sql
-- businesses.is_published n'existe pas en base alors que 8 fichiers du code
-- l'utilisent déjà (admin/applications/route.ts, pro/onboarding, pro/publish,
-- cron/relance-onboarding-pro, catalog.ts getBusinessBySlug...). Ce n'est pas
-- un renommage a faire cote code — la colonne manque reellement.
-- Sans elle : l'approbation d'une candidature (admin/applications/route.ts)
-- echoue avec 42703 des la creation du business.
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS is_published BOOLEAN NOT NULL DEFAULT false;
