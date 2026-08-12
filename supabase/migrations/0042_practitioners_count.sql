-- 0042_practitioners_count.sql
-- Ajoute practitioners_count à partner_applications : nombre de praticiens
-- déclaré par le pro à la candidature. Devient LE signal qui suggère un plan
-- à l'admin (AdminDashboard.tsx) — monthly_bookings_estimate ne le fait plus
-- (réservations illimitées sur tous les plans depuis la refonte tarifaire,
-- le volume n'a donc plus aucun rapport avec le plan). Les deux champs
-- cohabitent, ce n'est pas un remplacement : monthly_bookings_estimate reste
-- affiché à l'admin comme indicateur de revenu réel (frais de gestion).
--
-- NULLABLE, sans DEFAULT — contrairement à monthly_bookings_estimate (0016,
-- DEFAULT '0-80' défendable comme hypothèse basse), aucune valeur par
-- défaut n'est sûre pour un effectif : inventer un chiffre pour les
-- candidatures déjà soumises fausserait la donnée. Quand cette colonne est
-- NULL, l'admin ne reçoit AUCUNE suggestion de plan (voir
-- getSuggestedPlanFromPractitionersCount, lib/partner-plan-suggestion.ts) —
-- on ne retombe pas sur le volume.
--
-- Valeurs alignées sur BNP_PLANS.maxStaff au 12/08/2026 (Starter=1 praticien
-- total, Business=3, Scale=illimité, voir plans-config.ts et
-- lib/partner-plan-suggestion.ts). Cette contrainte CHECK est statique par
-- construction : si les seuils BNP_PLANS changent au point de modifier la
-- forme des buckets, une migration dédiée sera nécessaire (le code TS suit
-- BNP_PLANS automatiquement pour les libellés/la logique de suggestion,
-- pas cette contrainte SQL).

ALTER TABLE partner_applications
  ADD COLUMN IF NOT EXISTS practitioners_count TEXT
    CONSTRAINT chk_pa_practitioners_count CHECK (practitioners_count IN ('1', '2-3', '4+'));
