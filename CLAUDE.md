\# Règles Book'nPay



\- Claude peut committer son travail en local, au fil de l'eau.

\- Claude ne pousse jamais et n'ouvre jamais de PR : Pierre exécute lui-même

&#x20; tout push / PR, après relecture des commits.

\- Ces règles sont appliquées techniquement par .claude/settings.local.json

&#x20; (deny sur git push et gh pr) + un hook PreToolUse

&#x20; (.claude/hooks/block-git-write.ps1) qui inspecte les commandes composées.



# Conventions dashboard pro — widgets

Actées le 19/07/2026, issues de la matrice widgets (audit lecture seule, cf.
mémoire projet) et de la relecture de Pierre. Toute nouvelle carte/widget du
dashboard pro doit s'y conformer avant d'être codée — pas après.

- Un widget doit être adossé à une **donnée vérifiée**. Si la donnée
  n'existe pas dans le schéma actuel, le widget est NO GO tant qu'aucune
  migration n'est faite — jamais de contournement côté affichage.
- Un widget doit apporter une **valeur métier OU permettre une action**,
  sinon il descend ou disparaît. Les 4 questions auxquelles le dashboard
  pro répond, dans cet ordre : **activité** (comment va le business) /
  **à faire** (qu'est-ce qui demande une décision maintenant) / **clients**
  (qui sont-ils : fidèles, nouveaux, inactifs) / **valeur** (ce que
  Book'nPay apporte concrètement, factuel — pas une hypothèse affichée
  comme une mesure).
- **Pourcentage affiché seulement au-delà de 10 événements.** En dessous,
  afficher la différence brute ("2 no-shows de moins"), jamais un
  pourcentage — un delta sur un petit volume trompe (1→2 no-shows = "+100%").
- **Sans historique comparable, afficher "données insuffisantes"** — jamais
  une variation calculée sur une base quasi nulle. S'applique aussi aux
  comparaisons de période (ex. "vs mois dernier").
- **Définition métier figée avant le code**, pas inventée au moment de
  coder (client fidèle, nouveau, inactif, no-show...). Si la définition
  n'est pas encore tranchée par Pierre, le widget reste en statut AUDIT.

**Repère temporel** : repo en prod depuis le 21/06/2026 (premier commit
`f8b3eca`). Tout indicateur qui suppose une fenêtre d'historique (ex.
"inactif depuis 90 jours", comparaison N-1 annuelle) est mathématiquement
impossible avant que cette fenêtre soit dépassée — le retrancher
explicitement du backlog jusque-là, ne pas le coder "en dormant".

# Invariants moteur — réservations

Trouvé le 19/07/2026 : un double-booking solo (deux services différents
chevauchant chez un même pro sans staff actif) a existé en production
pendant 28 jours sans être détecté — ce n'est pas un test qui l'a repéré,
mais une question posée en audit sur les créneaux libres du dashboard pro.
Les invariants ci-dessous sont ce qui a été VÉRIFIÉ suite à cet incident,
pas seulement écrit dans une migration — la nuance compte : voir
`supabase/migrations/0035_solo_overlap_check_booking.sql` pour le détail
des 8 décisions actées en revue, mais l'exécution réelle est ce qui suit.

- **Anti-chevauchement solo** (`create_solo_booking_with_overlap_check`,
  migration 0035) — verrou `pg_advisory_xact_lock` par (biz_id, date),
  bornes strictes, valable pour toute réservation individuelle du business
  ce jour-là (staff_id ou non — un business a pu avoir du staff avant de le
  désactiver). Test de concurrence réel en prod le 19/07/2026 (`2c3e7e3`,
  déployé, wiring actif dans les 3 routes bookings) :
  - 2 requêtes parallèles sur 2 services individuels qui se chevauchent
    (90 min à 10:00 + 30 min à 10:30) → 1×200 + 1×409 `slot_overlap`,
    1 seule ligne en base.
  - 2 requêtes parallèles sur un enchaînement compatible (10:00-11:00 puis
    11:00-12:00) → 2×200 : le verrou sérialise mais ne sur-bloque pas.
  - 2 requêtes parallèles sur un service collectif (max_persons=3) →
    2×200, aucun `invalid_service` : le routing n'a pas cassé le chemin
    collectif (`create_booking_with_capacity_check`, 0026/0027, non
    modifiée).
  - **Nuance apportée le 21/07/2026** : ce test du 19/07 tournait sur une
    fixture qui a du staff actif (probablement `fixture-pro-audit`, seule
    à avoir un service individuel à l'époque) — il validait donc le
    routing anti-chevauchement en général, mais pas spécifiquement le
    chemin 100% sans staff de la migration 0035 (celui-ci passe par 0024,
    pas par le verrou solo). Aucune des 4 fixtures réellement sans staff
    (tatouage, photographie, beaute-domicile, animaux) n'avait de service
    individuel avant le 21/07, donc le chemin 0035 était en réalité
    inatteignable sur ces fixtures jusque-là. Corrigé en ajoutant un
    service individuel sur `fixture-pro-animaux`, puis rejoué en
    conditions réelles contre la prod (2 requêtes parallèles chevauchantes
    sur ce service) : 1×200 + 1×409 `slot_overlap`, `staff_id:null`
    confirmé — c'est ce test-là, pas celui du 19/07, qui vérifie
    effectivement le chemin solo pur.
- **Zone aveugle connue, pas encore couverte par un test réel** (niveau 1
  restant avant de considérer le moteur réservations comme audité) :
  annulation/modification de réservation, no-show et remboursement,
  inscription client de bout en bout. Même traitement à leur appliquer
  qu'au double-booking solo — un scénario réel en conditions de
  concurrence, pas une relecture de code qui affirme que ça devrait marcher.

# Tests de reproduction — appel EXACT du code réel

Trouvé le 12/08/2026 : un script de diagnostic contre `partner_applications`
chaînait `.insert().select().single()`, alors que le vrai code
(`PartnerApplicationForm.tsx`) fait `.insert()` seul. `.select()` déclenche
`Prefer: return=representation` côté PostgREST, donc un `INSERT ...
RETURNING` qui exige une policy SELECT — absente pour `anon` sur cette
table. Résultat : le script échouait systématiquement (42501 RLS) alors que
le vrai formulaire fonctionnait. Ça a déclenché une fausse alerte P0
("le formulaire public est cassé en prod"), une migration exécutée en
urgence en base de prod (0043, inoffensive mais sans doute inutile), et
plusieurs heures de diagnostic (GRANTS, pg_policies, clés API, logs
Postgres) avant que le biais soit identifié.

**Règle** : tout script de reproduction/diagnostic contre une vraie base
(surtout en prod) doit utiliser EXACTEMENT le même appel que le code réel —
mêmes paramètres, même chaînage de méthodes. Ne jamais ajouter un champ de
retour, une option, un `.select()` "pour voir le résultat" — même
temporairement. Si un contrôle supplémentaire est nécessaire, le faire dans
un appel séparé (ex. une lecture via service role après coup), jamais en
modifiant le premier appel testé.

# Suite complète avant commit sur une route partagée

Trouvé le 13/08/2026 : l'ajout du garde-fou `retractionConsent` sur
`/api/stripe/checkout` (commit `a01a366`, matin) a rendu 25 tests aveugles
dans `checkout-payment-deadline.test.ts` et
`checkout-frais-gestion-price.test.ts` — ces tests envoyaient un body sans
le nouveau champ requis, donc rejetés en 400 avant même d'atteindre ce
qu'ils étaient censés vérifier (garde-fou deadline, calcul des frais de
gestion). Pas un bug de prod (le vrai front envoie bien le champ), mais un
vrai trou de couverture resté silencieux toute la journée faute d'avoir
relancé la suite complète après ce commit — découvert seulement le soir,
en clôturant un chantier sans rapport.

**Règle** : toute modification d'une route API partagée par plusieurs
parcours (`stripe/checkout`, `bookings/create*`, tout ce qui a plusieurs
appelants front distincts) impose de lancer `npm test` (suite complète, pas
un fichier ciblé) avant de committer — pas seulement les tests du fichier
qu'on vient de modifier. Un garde-fou ajouté à un seul endroit peut casser
silencieusement des tests écrits pour vérifier autre chose sur la même
route, s'ils ne fournissent pas le nouveau champ requis.
