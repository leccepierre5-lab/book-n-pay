-- ============================================================================
-- Book'nPay — nettoyage des fiches de démo en prod
-- Objectif : passer de 5 à 2 fiches par couple (catégorie, ville) parmi les
-- fiches slug LIKE 'demo-%' (2695 fiches), puis leur donner des horaires
-- fictifs cohérents (09:00-19:00, lundi-samedi).
--
-- Résultat attendu : 1078 fiches demo restantes (539 couples x 2) + 46 vraies
-- fiches inchangées = 1124 businesses au total (contre 2741 avant).
--
-- Garde-fou : CHAQUE requête ci-dessous refiltre explicitement
-- `slug LIKE 'demo-%'`, même si la logique de ranking la couvre déjà en
-- théorie. Aucune fiche réelle (dont "Surf & Scissors", slug bia-c1) ne peut
-- donc être touchée, quelle que soit une erreur dans le calcul du rang.
--
-- À exécuter dans le SQL Editor Supabase, statement par statement, dans
-- l'ORDRE ci-dessous. Vérifier le nombre de lignes affectées annoncé par
-- l'éditeur après chaque étape avant de passer à la suivante.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- ÉTAPE 1/4 — DELETE des services rattachés aux 1617 fiches à supprimer
-- (avant les businesses, quel que soit le comportement réel de la FK —
-- non versionné dans le repo, donc pas garanti en CASCADE)
-- Lignes attendues : 4851
-- ----------------------------------------------------------------------------
DELETE FROM services
WHERE biz_id IN (
  SELECT id FROM (
    SELECT id, slug,
           ROW_NUMBER() OVER (PARTITION BY category, city ORDER BY name) AS rn
    FROM businesses
    WHERE slug LIKE 'demo-%'          -- garde-fou : périmètre strictement demo
  ) ranked
  WHERE rn > 2
    AND slug LIKE 'demo-%'            -- garde-fou redondant, volontaire
);


-- ----------------------------------------------------------------------------
-- ÉTAPE 2/4 — DELETE des 1617 fiches (3 par couple, les moins prioritaires
-- alphabétiquement)
-- Lignes attendues : 1617
-- ----------------------------------------------------------------------------
DELETE FROM businesses
WHERE id IN (
  SELECT id FROM (
    SELECT id, slug,
           ROW_NUMBER() OVER (PARTITION BY category, city ORDER BY name) AS rn
    FROM businesses
    WHERE slug LIKE 'demo-%'          -- garde-fou : périmètre strictement demo
  ) ranked
  WHERE rn > 2
    AND slug LIKE 'demo-%'            -- garde-fou redondant, volontaire
)
AND slug LIKE 'demo-%';               -- garde-fou explicite sur la table cible elle-même


-- ----------------------------------------------------------------------------
-- ÉTAPE 3/4 — UPDATE des horaires fictifs sur les fiches demo restantes
-- Après l'étape 2, il ne reste plus que les 1078 fiches (rn<=2) parmi les
-- demo-*, donc `slug LIKE 'demo-%'` seul suffit à les cibler sans ambiguïté.
-- open_days : 1=lundi ... 6=samedi, 0=dimanche exclu (convention JS getDay(),
-- cf. src/lib/booking-utils.ts / database.types.ts).
-- Lignes attendues : 1078
-- ----------------------------------------------------------------------------
UPDATE businesses
SET open_time  = '09:00:00',
    close_time = '19:00:00',
    open_days  = ARRAY[1,2,3,4,5,6]
WHERE slug LIKE 'demo-%';             -- garde-fou : ne touche jamais les 46 vraies fiches


-- ----------------------------------------------------------------------------
-- ÉTAPE 4/4 — VÉRIFICATIONS POST-EXÉCUTION (lecture seule)
-- ----------------------------------------------------------------------------

-- (a) Total businesses : attendu 1124 (1078 demo restantes + 46 vraies)
SELECT count(*) AS total_businesses FROM businesses;

-- (b) Fiches demo sans horaires : attendu 0
SELECT count(*) AS demo_sans_horaires
FROM businesses
WHERE slug LIKE 'demo-%'
  AND (open_time IS NULL OR close_time IS NULL);

-- (c) Vraies fiches intactes : attendu 46
SELECT count(*) AS vraies_fiches
FROM businesses
WHERE slug NOT LIKE 'demo-%';
