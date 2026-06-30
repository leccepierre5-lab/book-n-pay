-- 0016_partner_approval.sql
-- Ajoute 5 colonnes à partner_applications :
--   category              : secteur principal (beaute / bien-etre / sport / autre)
--   category_label        : libellé libre quand category = 'autre' (ex: "Photographie")
--   type                  : type d'établissement libre (ex: "Studio photo", "Indépendant")
--   monthly_bookings_estimate : volume estimé pour suggérer un plan d'abonnement
--   approved_at           : horodatage de l'approbation admin
-- Les DEFAULT sur category et monthly_bookings_estimate permettent à la migration
-- de passer sans erreur sur les rows existantes (NULL impossible après ALTER).

ALTER TABLE partner_applications
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'beaute'
    CONSTRAINT chk_pa_category CHECK (category IN ('beaute', 'bien-etre', 'sport', 'autre')),
  ADD COLUMN IF NOT EXISTS category_label TEXT,
  ADD COLUMN IF NOT EXISTS type TEXT,
  ADD COLUMN IF NOT EXISTS monthly_bookings_estimate TEXT NOT NULL DEFAULT '0-80'
    CONSTRAINT chk_pa_bookings_estimate CHECK (monthly_bookings_estimate IN ('0-80', '81-300', '300+')),
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
