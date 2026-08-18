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

# Parcours navigateur obligatoire — argent, statuts, autorisations

Trouvé le 15/08/2026 en testant le report de RDV en conditions réelles :
le webhook Stripe marquait `bookings.status='completed'` dès que tous les
membres avaient payé — donc dès le paiement réussi, avant même que le RDV
ait lieu. Un booking payé pour un créneau 5 jours plus tard se retrouvait
déjà "completed". Introduit intentionnellement le 26/06/2026 ("auto-complete
booking"), jamais requestionné depuis — 7 semaines sans être vu, alors que
474 tests unitaires passaient tout du long et que plusieurs audits (LOTS 1
à 7) avaient couvert ce repo. Aucun n'a pu le voir : un audit lit le code et
vérifie sa cohérence interne, il ne peut pas voir qu'une condition est
sémantiquement fausse quand elle est correctement écrite — `paid` au lieu
de `arrived`, c'est du code parfaitement écrit qui fait la mauvaise chose.
Trouvé par un parcours manuel de bout en bout, pas par une relecture.

Ce n'est pas un cas isolé sur ce projet : les 3 bugs sérieux les plus
récents (`reverse_transfer`, `phonesMatch()`, ce `completed` prématuré)
viennent tous d'un parcours réel — annuler vraiment, s'inscrire vraiment,
reporter vraiment — jamais d'un audit ou d'une relecture de code.

**Règle** : toute fonctionnalité qui touche à l'argent, aux statuts de
réservation ou aux autorisations doit être parcourue de bout en bout dans
le navigateur avant d'être considérée comme livrée. Les tests unitaires
prouvent que le code fait ce qu'on lui a demandé, pas qu'on lui a demandé
la bonne chose.

**Pour les audits futurs** : ajouter systématiquement une question de
sémantique, pas seulement de cohérence. Pour chaque condition qui déclenche
un changement d'état, se demander si la condition correspond vraiment à
l'événement métier qu'elle prétend représenter — pas seulement si elle est
cohérente avec le reste du code.

# Tester un parcours connecté sans mot de passe

Posé le 18/08/2026 : le parcours navigateur obligatoire ci-dessus impose de
se connecter pour tester les écrans authentifiés, mais Claude n'a et ne
saisira jamais de mot de passe dans un champ — règle dure permanente, y
compris pour un compte de test entièrement sous contrôle service_role
(confirmée par Pierre le 14/08, ré-confirmée le 18/08 face à une demande
explicite de contournement). Un bypass conditionné à une variable d'env
(`NODE_ENV==='development'` ou équivalent) a été écarté : ça ajoute une
porte dérobée permanente dans le code livré, dépendante d'une variable qui
peut être mal positionnée (ex. preview Vercel, publiquement accessible).

**Solution retenue : lien `recovery` généré par script, jamais de champ
mot de passe touché.**
- `scripts/audit/passwordless-login-link.mjs <email> [baseUrl]` appelle
  `supabase.auth.admin.generateLink({ type: 'recovery', email })` avec la
  clé `service_role` lue depuis l'environnement (jamais en dur, jamais
  loggée). Réutilise `src/app/auth/verify/route.ts`, qui autorise déjà
  `recovery` dans `ALLOWED_TYPES` — c'est le code qui gère en prod les
  vrais emails "mot de passe oublié". **Zéro ligne de code nouvelle côté
  app.** La clé service_role peut déjà tout faire en base (y compris
  changer un mot de passe) : ceci n'ouvre aucune porte qui ne soit déjà
  ouverte par cette clé.
- Coller l'URL affichée dans l'onglet du dev local : une vraie session est
  posée (cookies), redirection vers `/mon-compte?reset=1` — ignorer cet
  écran et naviguer directement vers la page à tester, la session reste
  valide. Lien à usage unique, expiration Supabase par défaut.
- `scripts/audit/create-fixture-client.mjs` crée le fixture client
  permanent `fixture-client-audit@book-n-pay.invalid` (phone
  `0699999999`, `role='client'` via le trigger `handle_new_user`) —
  aucun fixture client n'existait avant le 18/08, les 13 fixtures
  précédentes sont toutes des comptes pro. **Ne jamais supprimer.**
  Mot de passe généré aléatoirement à la création, jamais affiché ni
  loggué — inutile, la connexion passe uniquement par le script ci-dessus.
- Ces deux scripts vivent dans `scripts/`, jamais dans `src/` — rien de ce
  mécanisme ne se retrouve dans le bundle applicatif livré.
