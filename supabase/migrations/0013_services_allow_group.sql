-- Permet au pro de désactiver le mode groupe sur une prestation spécifique.
-- Défaut true : toutes les prestations existantes et nouvelles acceptent le groupe.
ALTER TABLE services ADD COLUMN IF NOT EXISTS allow_group boolean NOT NULL DEFAULT true;
