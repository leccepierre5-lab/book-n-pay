-- 0018_more_categories.sql
-- Ajoute 8 nouveaux secteurs d'activité (en plus de beaute/bien-etre/sport/autre) :
-- sante, soins-corps, coiffure-barber, tatouage-piercing, coaching, animaux,
-- beaute-domicile, photographie. Aucun métier avec ordonnance ou remboursement
-- sécu (voir suggestions dans PartnerApplicationForm.tsx).

-- Seule partner_applications.category a un CHECK existant (migration 0016) —
-- c'est lui qui gate ce qu'un admin peut approuver, donc c'est lui qu'on étend.
-- businesses.category n'a jamais eu de contrainte (vérifié en prod) et contient
-- déjà des valeurs héritées (creatif, education, enfants, food, services) —
-- on n'y touche pas ici.
ALTER TABLE partner_applications
  DROP CONSTRAINT IF EXISTS chk_pa_category,
  ADD CONSTRAINT chk_pa_category CHECK (category IN (
    'beaute', 'bien-etre', 'sport', 'autre',
    'sante', 'soins-corps', 'coiffure-barber', 'tatouage-piercing',
    'coaching', 'animaux', 'beaute-domicile', 'photographie'
  ));
