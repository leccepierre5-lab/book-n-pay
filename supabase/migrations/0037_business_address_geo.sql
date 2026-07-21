-- 0037_business_address_geo.sql
-- Adresse complète + coordonnées géo, pour le JSON-LD LocalBusiness/Service
-- (chantier SEO c). Saisie/validée via l'API adresse.data.gouv.fr côté
-- application (pas de contrainte DB dessus).
--
-- ⚠️ À exécuter manuellement dans le Supabase SQL Editor (même workflow que
-- les migrations précédentes, voir 0032).
--
-- Pourquoi une table séparée plutôt que des colonnes sur `businesses` :
-- `businesses_select_public` (0022) est `FOR SELECT TO public USING (true)` —
-- lecture intégrale de la ligne, RLS ne filtre que des LIGNES, pas des
-- colonnes. Ajouter address/lat/lng directement sur `businesses` les
-- exposerait publiquement quel que soit le choix du pro. Même pattern que
-- `business_settings` (0022, SELECT restreint à owns_biz) : la sensibilité
-- devient un problème de ligne, que RLS sait filtrer nativement.
--
-- service_area_radius_km reste sur `businesses` : non sensible (c'est
-- l'info qui remplace l'adresse pour les métiers à domicile sur la fiche
-- publique et le JSON-LD areaServed), il doit rester lisible même quand
-- address_public = false — le mettre dans business_locations le ferait
-- disparaître avec le reste de la ligne.
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS service_area_radius_km INTEGER NULL;

ALTER TABLE businesses
  ADD CONSTRAINT service_area_radius_km_check
  CHECK (service_area_radius_km IS NULL OR service_area_radius_km > 0);

CREATE TABLE IF NOT EXISTS business_locations (
  biz_id          UUID PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  address         TEXT NOT NULL,
  postal_code     TEXT NOT NULL,
  lat             DOUBLE PRECISION NOT NULL,
  lng             DOUBLE PRECISION NOT NULL,
  -- Défaut applicatif (pas ici) : false à la 1ère saisie pour le type
  -- beaute-domicile, true sinon — mais toujours modifiable par le pro (cas
  -- du tatoueur qui reçoit chez lui hors catégorie "à domicile" dédiée).
  address_public  BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (lat BETWEEN -90 AND 90),
  CHECK (lng BETWEEN -180 AND 180)
);

-- RLS — même pattern que business_settings (0022) : écriture réservée au
-- propriétaire. Lecture élargie par rapport à business_settings : le
-- propriétaire ET l'admin voient toujours la ligne, le public seulement si
-- address_public = true. Absence de ligne retournée = comportement voulu
-- pour un visiteur non autorisé (pas de fuite de plus qu'un booléen déjà
-- observable ailleurs sur la fiche — décision actée, pas un oubli).
ALTER TABLE business_locations ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'business_locations' AND policyname = 'business_locations_select'
  ) THEN
    CREATE POLICY business_locations_select ON business_locations
      FOR SELECT TO public USING (address_public = true OR owns_biz(biz_id) OR is_admin());
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'business_locations' AND policyname = 'business_locations_insert'
  ) THEN
    CREATE POLICY business_locations_insert ON business_locations
      FOR INSERT TO public WITH CHECK (owns_biz(biz_id));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'business_locations' AND policyname = 'business_locations_update'
  ) THEN
    CREATE POLICY business_locations_update ON business_locations
      FOR UPDATE TO public USING (owns_biz(biz_id));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'business_locations' AND policyname = 'business_locations_delete'
  ) THEN
    CREATE POLICY business_locations_delete ON business_locations
      FOR DELETE TO public USING (owns_biz(biz_id) OR is_admin());
  END IF;
END $$;

COMMENT ON TABLE business_locations IS
  'Adresse géocodée du pro (API adresse.data.gouv.fr). Table séparée de businesses pour que address_public=false masque réellement address/lat/lng au public via RLS (voir commentaire en tête de fichier) — jamais ajouter ces colonnes directement sur businesses.';
COMMENT ON COLUMN business_locations.address_public IS
  'Contrôlé par le pro (réglages), pas dérivé automatiquement de la catégorie/type — un tatoueur "sur RDV à domicile" hors catégorie beaute-domicile a le même besoin de masquage.';
COMMENT ON COLUMN businesses.service_area_radius_km IS
  'Rayon d''intervention en km, affiché sur la fiche + JSON-LD areaServed quand business_locations.address_public = false (ou absent). Volontairement sur businesses (public), pas business_locations (privée).';

-- ⚠️ VÉRIFICATION APRÈS EXÉCUTION :
--   SELECT policyname, cmd, qual FROM pg_policies WHERE tablename = 'business_locations';
--   Doit montrer 4 policies (select/insert/update/delete) telles que ci-dessus.
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conrelid = 'business_locations'::regclass;
--   Doit montrer : PK biz_id, FK businesses(id) ON DELETE CASCADE,
--   2 CHECK (lat, lng).
