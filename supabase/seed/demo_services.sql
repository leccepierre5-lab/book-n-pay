-- supabase/seed/demo_services.sql
-- Bug 3 (SECURITY_TODO / diagnostic session 02/07/2026) : les 2695 établissements
-- de démo (slug LIKE 'demo-%') ont été seedés sans aucune prestation, donc sans
-- prix — la page établissement affiche "Aucune prestation dans cette catégorie."
-- Ce script ajoute 3 prestations réalistes par établissement, choisies selon le
-- couple (category, type) exact du business. Les 45 établissements "vitrine"
-- non-demo (slugs type bia-c1, ang-y1, etc.) ont déjà leurs propres services
-- et ne sont PAS concernés par ce script (WHERE slug LIKE 'demo-%').
--
-- Idempotent : le WHERE NOT EXISTS empêche une double insertion si le script
-- est relancé par erreur.

INSERT INTO services (biz_id, name, price, deposit, duration_minutes, allow_group)
SELECT b.id, m.name, m.price, m.deposit, m.duration_minutes, true
FROM businesses b
JOIN (
  VALUES
    -- ── animaux ──────────────────────────────────────────────────────────
    ('animaux', 'toiletteur', 'Toilettage complet chien', 45.00, 20.00, 60),
    ('animaux', 'toiletteur', 'Toilettage chat', 35.00, 15.00, 45),
    ('animaux', 'toiletteur', 'Forfait tonte + soins', 55.00, 20.00, 75),
    ('animaux', 'pet-sitter', 'Visite à domicile', 20.00, 10.00, 30),
    ('animaux', 'pet-sitter', 'Garde demi-journée', 35.00, 15.00, 240),
    ('animaux', 'pet-sitter', 'Promenade', 15.00, 5.00, 30),
    ('animaux', 'educateur canin', 'Séance éducation individuelle', 50.00, 20.00, 60),
    ('animaux', 'educateur canin', 'Bilan comportemental', 65.00, 25.00, 90),
    ('animaux', 'educateur canin', 'Cours collectif', 30.00, 10.00, 60),
    ('animaux', 'veterinaire', 'Consultation générale', 45.00, 20.00, 30),
    ('animaux', 'veterinaire', 'Vaccination', 35.00, 15.00, 20),
    ('animaux', 'veterinaire', 'Bilan de santé complet', 70.00, 30.00, 45),

    -- ── beaute ───────────────────────────────────────────────────────────
    ('beaute', 'coiffeur', 'Coupe Femme', 45.00, 15.00, 45),
    ('beaute', 'coiffeur', 'Coupe + Brushing', 55.00, 20.00, 60),
    ('beaute', 'coiffeur', 'Couleur + Coupe', 95.00, 30.00, 120),
    ('beaute', 'onglerie', 'Pose vernis semi-permanent', 30.00, 10.00, 45),
    ('beaute', 'onglerie', 'Pose gel complète', 45.00, 15.00, 60),
    ('beaute', 'onglerie', 'Nail art', 55.00, 20.00, 75),
    ('beaute', 'esthetique', 'Soin visage éclat', 55.00, 20.00, 60),
    ('beaute', 'esthetique', 'Épilation jambes complètes', 35.00, 10.00, 45),
    ('beaute', 'esthetique', 'Soin anti-âge', 75.00, 25.00, 75),
    ('beaute', 'maquillage', 'Maquillage jour', 40.00, 15.00, 45),
    ('beaute', 'maquillage', 'Maquillage mariée (essai)', 65.00, 25.00, 60),
    ('beaute', 'maquillage', 'Maquillage soirée', 50.00, 20.00, 45),
    ('beaute', 'institut de beaute', 'Soin du visage', 60.00, 20.00, 60),
    ('beaute', 'institut de beaute', 'Manucure + Pédicure', 55.00, 20.00, 75),
    ('beaute', 'institut de beaute', 'Massage relaxant 30min', 40.00, 15.00, 30),

    -- ── beaute-domicile ──────────────────────────────────────────────────
    ('beaute-domicile', 'coiffeuse a domicile', 'Coupe à domicile', 50.00, 20.00, 45),
    ('beaute-domicile', 'coiffeuse a domicile', 'Brushing à domicile', 40.00, 15.00, 40),
    ('beaute-domicile', 'coiffeuse a domicile', 'Couleur à domicile', 100.00, 35.00, 120),
    ('beaute-domicile', 'estheticienne a domicile', 'Soin visage à domicile', 65.00, 25.00, 60),
    ('beaute-domicile', 'estheticienne a domicile', 'Épilation à domicile', 40.00, 15.00, 45),
    ('beaute-domicile', 'estheticienne a domicile', 'Massage relaxant à domicile', 60.00, 20.00, 60),
    ('beaute-domicile', 'maquilleuse a domicile', 'Maquillage événement à domicile', 70.00, 25.00, 60),
    ('beaute-domicile', 'maquilleuse a domicile', 'Maquillage mariée à domicile', 90.00, 30.00, 75),
    ('beaute-domicile', 'maquilleuse a domicile', 'Cours auto-maquillage', 55.00, 20.00, 60),
    ('beaute-domicile', 'manucure a domicile', 'Manucure à domicile', 35.00, 10.00, 45),
    ('beaute-domicile', 'manucure a domicile', 'Pose gel à domicile', 50.00, 15.00, 60),
    ('beaute-domicile', 'manucure a domicile', 'Pédicure à domicile', 40.00, 15.00, 45),

    -- ── bien-etre ────────────────────────────────────────────────────────
    ('bien-etre', 'massage', 'Massage relaxant 1h', 65.00, 25.00, 60),
    ('bien-etre', 'massage', 'Massage sportif', 70.00, 25.00, 60),
    ('bien-etre', 'massage', 'Massage duo', 130.00, 40.00, 60),
    ('bien-etre', 'yoga', 'Cours particulier yoga', 45.00, 15.00, 60),
    ('bien-etre', 'yoga', 'Cours collectif yoga', 20.00, 5.00, 60),
    ('bien-etre', 'yoga', 'Séance yin yoga', 35.00, 10.00, 75),
    ('bien-etre', 'pilates', 'Cours particulier pilates', 45.00, 15.00, 50),
    ('bien-etre', 'pilates', 'Cours collectif pilates', 22.00, 5.00, 50),
    ('bien-etre', 'pilates', 'Pilates reformer', 55.00, 20.00, 50),
    ('bien-etre', 'meditation', 'Séance individuelle méditation', 40.00, 15.00, 45),
    ('bien-etre', 'meditation', 'Atelier collectif pleine conscience', 25.00, 10.00, 60),
    ('bien-etre', 'meditation', 'Séance sonore (bols tibétains)', 50.00, 15.00, 60),
    ('bien-etre', 'thalasso', 'Accès parcours thalasso demi-journée', 65.00, 25.00, 180),
    ('bien-etre', 'thalasso', 'Soin enveloppement algues', 55.00, 20.00, 45),
    ('bien-etre', 'thalasso', 'Journée thalasso complète', 140.00, 50.00, 360),

    -- ── sport ────────────────────────────────────────────────────────────
    ('sport', 'coaching sportif', 'Séance coaching individuel', 55.00, 20.00, 60),
    ('sport', 'coaching sportif', 'Bilan forme + programme', 70.00, 25.00, 90),
    ('sport', 'coaching sportif', 'Coaching duo', 80.00, 30.00, 60),
    ('sport', 'fitness', 'Cours collectif fitness', 18.00, 5.00, 45),
    ('sport', 'fitness', 'Séance cross-training', 22.00, 8.00, 50),
    ('sport', 'fitness', 'Carte 5 séances fitness', 80.00, 25.00, 45),
    ('sport', 'natation', 'Cours particulier natation', 40.00, 15.00, 45),
    ('sport', 'natation', 'Cours collectif enfants', 25.00, 10.00, 45),
    ('sport', 'natation', 'Aquagym', 20.00, 5.00, 45),
    ('sport', 'surf', 'Cours de surf individuel', 55.00, 20.00, 90),
    ('sport', 'surf', 'Cours de surf collectif', 35.00, 10.00, 90),
    ('sport', 'surf', 'Stage surf 3 jours', 150.00, 50.00, 540),
    ('sport', 'arts martiaux', 'Cours d''essai arts martiaux', 15.00, 5.00, 60),
    ('sport', 'arts martiaux', 'Cours particulier', 50.00, 20.00, 60),
    ('sport', 'arts martiaux', 'Abonnement mensuel (4 cours)', 70.00, 25.00, 60),

    -- ── sante ────────────────────────────────────────────────────────────
    ('sante', 'dieteticien', 'Première consultation', 60.00, 25.00, 60),
    ('sante', 'dieteticien', 'Consultation de suivi', 40.00, 15.00, 30),
    ('sante', 'dieteticien', 'Bilan nutritionnel complet', 90.00, 30.00, 75),
    ('sante', 'podologue', 'Consultation podologique', 45.00, 15.00, 30),
    ('sante', 'podologue', 'Semelles orthopédiques (bilan)', 60.00, 20.00, 45),
    ('sante', 'podologue', 'Soin des pieds', 35.00, 10.00, 30),
    ('sante', 'reflexologue', 'Séance réflexologie plantaire', 55.00, 20.00, 45),
    ('sante', 'reflexologue', 'Réflexologie palmaire', 45.00, 15.00, 30),
    ('sante', 'reflexologue', 'Séance découverte', 35.00, 10.00, 30),
    ('sante', 'osteopathe', 'Consultation ostéopathie adulte', 60.00, 25.00, 45),
    ('sante', 'osteopathe', 'Consultation ostéopathie enfant', 50.00, 20.00, 30),
    ('sante', 'osteopathe', 'Suivi sportif', 55.00, 20.00, 45),
    ('sante', 'naturopathe', 'Bilan naturopathique complet', 75.00, 25.00, 75),
    ('sante', 'naturopathe', 'Consultation de suivi', 45.00, 15.00, 45),
    ('sante', 'naturopathe', 'Atelier phytothérapie', 30.00, 10.00, 60),

    -- ── soins-corps ──────────────────────────────────────────────────────
    ('soins-corps', 'spa', 'Accès spa 2h', 45.00, 15.00, 120),
    ('soins-corps', 'spa', 'Soin gommage corps', 55.00, 20.00, 45),
    ('soins-corps', 'spa', 'Forfait duo spa', 90.00, 30.00, 120),
    ('soins-corps', 'hammam', 'Accès hammam', 25.00, 10.00, 60),
    ('soins-corps', 'hammam', 'Gommage au savon noir', 40.00, 15.00, 45),
    ('soins-corps', 'hammam', 'Forfait hammam + massage', 65.00, 25.00, 90),
    ('soins-corps', 'epilation', 'Épilation jambes complètes', 35.00, 10.00, 45),
    ('soins-corps', 'epilation', 'Épilation maillot', 20.00, 5.00, 20),
    ('soins-corps', 'epilation', 'Épilation intégrale', 55.00, 20.00, 60),
    ('soins-corps', 'uv bronzage', 'Séance UV 15min', 15.00, 5.00, 15),
    ('soins-corps', 'uv bronzage', 'Forfait 5 séances UV', 60.00, 20.00, 15),
    ('soins-corps', 'uv bronzage', 'Bronzage progressif (spray)', 30.00, 10.00, 20),
    ('soins-corps', 'drainage lymphatique', 'Drainage lymphatique jambes', 45.00, 15.00, 45),
    ('soins-corps', 'drainage lymphatique', 'Drainage lymphatique corps entier', 70.00, 25.00, 75),
    ('soins-corps', 'drainage lymphatique', 'Séance découverte', 35.00, 10.00, 30),

    -- ── coiffure-barber ──────────────────────────────────────────────────
    ('coiffure-barber', 'coiffeur', 'Coupe Homme', 28.00, 12.00, 30),
    ('coiffure-barber', 'coiffeur', 'Coupe + Barbe', 40.00, 15.00, 45),
    ('coiffure-barber', 'coiffeur', 'Coupe + Brushing', 50.00, 18.00, 50),
    ('coiffure-barber', 'barbier', 'Taille de barbe', 22.00, 10.00, 25),
    ('coiffure-barber', 'barbier', 'Rasage traditionnel', 30.00, 12.00, 30),
    ('coiffure-barber', 'barbier', 'Coupe + Barbe + Rasage', 55.00, 20.00, 60),
    ('coiffure-barber', 'coiffeur afro', 'Coupe afro', 35.00, 15.00, 45),
    ('coiffure-barber', 'coiffeur afro', 'Tresses / Box braids', 90.00, 30.00, 150),
    ('coiffure-barber', 'coiffeur afro', 'Défrisage', 60.00, 20.00, 90),
    ('coiffure-barber', 'extensions', 'Pose extensions (pack court)', 120.00, 40.00, 120),
    ('coiffure-barber', 'extensions', 'Pose extensions (pack long)', 180.00, 60.00, 180),
    ('coiffure-barber', 'extensions', 'Retrait extensions', 40.00, 15.00, 45),

    -- ── tatouage-piercing ────────────────────────────────────────────────
    ('tatouage-piercing', 'tatoueur', 'Petit tatouage (flash)', 60.00, 30.00, 45),
    ('tatouage-piercing', 'tatoueur', 'Tatouage moyen format', 150.00, 50.00, 120),
    ('tatouage-piercing', 'tatoueur', 'Séance retouche', 40.00, 20.00, 30),
    ('tatouage-piercing', 'perceur', 'Piercing lobe', 25.00, 10.00, 15),
    ('tatouage-piercing', 'perceur', 'Piercing cartilage', 40.00, 15.00, 20),
    ('tatouage-piercing', 'perceur', 'Piercing corps', 50.00, 20.00, 25),
    ('tatouage-piercing', 'maquillage permanent', 'Sourcils poudrés', 250.00, 80.00, 120),
    ('tatouage-piercing', 'maquillage permanent', 'Eye-liner permanent', 200.00, 70.00, 90),
    ('tatouage-piercing', 'maquillage permanent', 'Retouche annuelle', 90.00, 30.00, 45),

    -- ── coaching ─────────────────────────────────────────────────────────
    ('coaching', 'coach de vie', 'Séance de coaching individuel', 70.00, 25.00, 60),
    ('coaching', 'coach de vie', 'Bilan de vie', 100.00, 35.00, 90),
    ('coaching', 'coach de vie', 'Forfait 4 séances', 240.00, 80.00, 60),
    ('coaching', 'hypnotherapeute', 'Séance d''hypnothérapie', 80.00, 30.00, 60),
    ('coaching', 'hypnotherapeute', 'Séance découverte', 50.00, 20.00, 45),
    ('coaching', 'hypnotherapeute', 'Suivi arrêt du tabac', 120.00, 40.00, 90),
    ('coaching', 'sophrologue', 'Séance individuelle sophrologie', 55.00, 20.00, 45),
    ('coaching', 'sophrologue', 'Séance collective', 25.00, 10.00, 60),
    ('coaching', 'sophrologue', 'Forfait 3 séances', 150.00, 50.00, 45),
    ('coaching', 'psychologue', 'Consultation psychologue', 65.00, 25.00, 45),
    ('coaching', 'psychologue', 'Consultation de suivi', 60.00, 20.00, 45),
    ('coaching', 'psychologue', 'Thérapie de couple', 90.00, 30.00, 60),
    ('coaching', 'meditation pleine conscience', 'Séance individuelle', 50.00, 20.00, 45),
    ('coaching', 'meditation pleine conscience', 'Atelier collectif MBSR', 30.00, 10.00, 90),
    ('coaching', 'meditation pleine conscience', 'Cycle 8 semaines (séance)', 40.00, 15.00, 90),

    -- ── photographie ─────────────────────────────────────────────────────
    ('photographie', 'photographe portrait', 'Séance portrait studio', 90.00, 30.00, 60),
    ('photographie', 'photographe portrait', 'Séance portrait extérieur', 110.00, 35.00, 90),
    ('photographie', 'photographe portrait', 'Book photo (galerie complète)', 180.00, 60.00, 120),
    ('photographie', 'photographe mariage', 'Reportage demi-journée', 450.00, 150.00, 240),
    ('photographie', 'photographe mariage', 'Reportage journée complète', 900.00, 300.00, 480),
    ('photographie', 'photographe mariage', 'Séance couple (engagement)', 150.00, 50.00, 90),
    ('photographie', 'photographe nouveau-ne', 'Séance nouveau-né studio', 160.00, 50.00, 90),
    ('photographie', 'photographe nouveau-ne', 'Séance grossesse', 130.00, 40.00, 60),
    ('photographie', 'photographe nouveau-ne', 'Séance famille + nouveau-né', 190.00, 60.00, 90),
    ('photographie', 'photographe famille', 'Séance famille extérieur', 120.00, 40.00, 60),
    ('photographie', 'photographe famille', 'Séance famille studio', 100.00, 35.00, 60),
    ('photographie', 'photographe famille', 'Album photo personnalisé', 60.00, 20.00, 30),
    ('photographie', 'photographe entreprise', 'Shooting corporate (portraits équipe)', 250.00, 80.00, 120),
    ('photographie', 'photographe entreprise', 'Reportage événement d''entreprise', 400.00, 130.00, 240),
    ('photographie', 'photographe entreprise', 'Photos produits', 180.00, 60.00, 90)
) AS m(category, type, name, price, deposit, duration_minutes)
  ON m.category = b.category AND m.type = b.type
WHERE b.slug LIKE 'demo-%'
  AND NOT EXISTS (SELECT 1 FROM services s WHERE s.biz_id = b.id);

-- Vérification attendue : 2695 établissements × 3 = 8085 lignes insérées.
SELECT count(*) AS services_inseres FROM services s
JOIN businesses b ON b.id = s.biz_id
WHERE b.slug LIKE 'demo-%';
