# Book'nPay — Next.js + Supabase + Vercel

Migration depuis Base44.

## Garde-fou git : seul Pierre pousse sur ce repo

Un hook `pre-push` bloque tout `git push` sauf si la variable d'environnement
`ALLOW_PUSH=1` est posée sur la commande. Objectif : empêcher un push
automatisé (agent IA ou script) sans action explicite de Pierre.

Le hook lui-même vit dans `scripts/git-hooks/pre-push` (versionné — `.git/hooks/`
ne l'est jamais, donc un clone frais ne l'a pas tant qu'il n'est pas installé).
Pour l'activer sur un clone :

```sh
git config core.hooksPath scripts/git-hooks
```

ou, en copie manuelle :

```sh
cp scripts/git-hooks/pre-push .git/hooks/pre-push && chmod +x .git/hooks/pre-push
```

Pour pousser une fois le hook actif :

```sh
ALLOW_PUSH=1 git push
```

## ⚠️ Important — lis ça avant de déployer

Ce repo n'a **pas pu être installé (`npm install`) ni buildé** dans
l'environnement où il a été généré (pas d'accès réseau sandbox, vérifié à
nouveau lors de cette session — toujours bloqué). Tout le code a été relu
manuellement avec attention, ligne par ligne, et plusieurs bugs réels ont
été trouvés et corrigés par cette relecture (voir section dédiée
ci-dessous) — mais sans compilation réelle, **tu dois lancer
`npm install && npm run build` toi-même avant de déployer** et corriger ce
qui casse.

## ⚠️⚠️ Failles de sécurité trouvées et corrigées (audit dédié)

Dans cette session, j'ai fait une passe d'audit volontaire sur les routes
les plus sensibles plutôt que d'ajouter encore plus de code. Deux vraies
failles ont été trouvées et corrigées — pas des détails, des trous
exploitables :

1. **`/api/loyalty/use-joker`** acceptait `phone`, `bookingId`, `memberId`
   directement depuis le body **sans aucune authentification**. N'importe
   qui pouvait appeler cette route avec le numéro de téléphone de
   quelqu'un d'autre et déclencher un **vrai remboursement Stripe** sur sa
   réservation, en consommant son Joker. Corrigé : la route exige
   maintenant une session authentifiée, vérifie que le `phone` fourni
   correspond au profil connecté (ou à un admin), et vérifie que le
   `memberId` cible appartient bien à ce téléphone sur ce booking précis.

2. **`/api/loyalty/update-status`** (appelée serveur-à-serveur par
   `cloturerPrestation`, `checkin-by-qr`, `update-member`) n'avait aucune
   protection. N'importe qui connaissant l'URL pouvait l'appeler
   directement avec un `memberPhone` arbitraire pour créditer des RDV
   honorés et des Jokers sans avoir réellement honoré de rendez-vous —
   une fraude sur le système de fidélité. Corrigée avec un nouveau secret
   `INTERNAL_API_SECRET` (à définir dans `.env`, jamais exposé au
   navigateur), que les 3 routes appelantes envoient désormais en header
   `Authorization`.

3. **`/api/bookings/cancel`** vérifiait seulement qu'une session existait,
   jamais que l'utilisateur connecté était bien le créateur du booking ou
   le membre ciblé. N'importe quel utilisateur authentifié pouvait
   annuler/rembourser la réservation de quelqu'un d'autre en devinant un
   `bookingId`/`memberId`. Corrigé en vérifiant l'appartenance (créateur,
   membre via téléphone, ou admin) avant toute action.

**Action requise de ta part** : génère une valeur pour `INTERNAL_API_SECRET`
dans `.env.local` et sur Vercel (ex: `openssl rand -hex 32`) — sans elle,
les rappels de fidélité après check-in échoueront silencieusement (logués
en `console.warn`, pas une erreur bloquante, mais les clients n'accumuleront
plus de RDV honorés).

4. **`/api/bookings/checkin-by-qr`** et **`/api/bookings/update-member`**
   vérifiaient qu'une session existait, mais pas que l'appelant était un
   pro. RLS aurait laissé un client connaissant son propre QR code (ou
   l'API directement) s'auto-check-in lui-même, déclenchant la récompense
   fidélité sans s'être présenté. Corrigées en exigeant explicitement le
   rôle pro/admin pour `checkin-by-qr`, et pour `update-member` uniquement
   quand le changement cible `arrived`/`no_show` (un client reste libre
   d'annuler sa propre réservation via cette route). De plus,
   `update-member` passait l'objet `updates` reçu du body **directement**
   à `.update()` sans filtrage — un appelant aurait pu glisser des champs
   comme `deposit` ou `montant_rembourse` dans le même body, contournant
   la vérification de rôle qui ne portait que sur `status`. Corrigé avec
   une whitelist stricte des champs acceptés (`ALLOWED_FIELDS`).

Je ne peux pas garantir avoir trouvé toutes les failles similaires sans
exécution réelle ni audit de sécurité formel — cette passe a couvert les
routes manipulant de l'argent ou de la fidélité, pas l'intégralité du code.

## Trace bout-en-bout (nouvelle méthode de vérification, cette session)

Plutôt que de relire fichier par fichier, j'ai suivi des données à travers
plusieurs fichiers (du formulaire jusqu'à la base, puis jusqu'à l'email).
Ça trouve des trous structurels qu'une lecture isolée ne révèle pas :

1. **Le group booking était fonctionnellement mort** : le backend complet
   (`/api/bookings/group`) existait depuis plusieurs tours, mais **aucun
   composant front ne l'appelait jamais**. Corrigé en construisant
   `JoinGroupClient.tsx` (`/rejoindre/[bookingId]`) et `ShareGroupLink.tsx`
   — voir détail dans la section "Group booking" plus haut. Une vraie
   incohérence a été détectée en chemin : `getBooking` ne sélectionnait
   pas `services.deposit`/`price` dont le nouveau composant avait besoin.

2. **Backfill manquant pour `referral_code`** : la migration `0007`
   ajoutait la colonne mais ne la remplissait jamais pour les utilisateurs
   déjà existants — seul le trigger d'inscription (`0003`) génère un code,
   et seulement pour les comptes créés après son exécution. Sans backfill,
   un utilisateur inscrit avant la migration aurait `referral_code = NULL`
   indéfiniment et ne verrait jamais sa carte de parrainage. Corrigé avec
   un `UPDATE` dans `0007`.

3. **Établissement gelé visible jusqu'au paiement** : un établissement
   gelé par l'admin restait dans les résultats de recherche et sa fiche
   restait accessible — seul le moment du paiement le bloquait (erreur
   423). Corrigé en filtrant `frozen = false` dans `searchBusinesses()` et
   en affichant un état clair sur la fiche établissement si on y accède
   par lien direct.

4. **Duplication de logique d'envoi d'email** : `chat/send` et
   `stripe/webhook` réimplémentaient chacun leur propre appel direct à
   l'API Resend au lieu d'utiliser `lib/email/send.ts` (le helper créé
   plus tard dans la session). Pas un bug fonctionnel, mais si tu changes
   un jour de fournisseur d'email, tu aurais dû le faire à 3 endroits.
   Consolidé pour n'utiliser que le helper centralisé.

5. **`stripe_onboarding_complete` ne se mettait jamais à jour** :
   `/api/stripe/connect-status` est la SEULE route qui passe ce champ à
   `true` en base, mais rien ne l'appelait jamais côté front. Un pro qui
   terminait son onboarding Stripe Express revenait sur `?stripe_return=1`
   sans que rien ne se passe — son statut restait `false` indéfiniment,
   l'empêchant de recevoir des transferts directs (le checkout vérifie ce
   champ avant d'activer `application_fee_amount`/`transfer_data`).
   Corrigé en appelant `connect-status` automatiquement dans
   `ProDashboard.tsx` à la détection de `?stripe_return=1`, avec mise à
   jour de l'état local et nettoyage de l'URL ensuite. **Bug de
   compilation détecté au passage** : ce correctif introduit
   `useSearchParams` dans `ProDashboard.tsx`, qui nécessite une frontière
   `<Suspense>` côté Next.js App Router — absente jusque-là sur la page
   `/pro`. Sans cette frontière, le build aurait échoué. Ajoutée.

6. **`/api/stripe/connect-status` sans authentification ni autorisation** :
   n'importe qui connaissant un `bizId` pouvait interroger le statut
   Stripe Connect d'un pro (`stripeAccountId`, état KYC). Corrigée pour
   exiger une session authentifiée appartenant au pro propriétaire (ou
   admin) — même pattern que les autres routes Stripe sensibles.

7. **Bug de fuseau horaire isolé dans `chat/send`** : `new Date(booking.date)`
   sans heure explicite est interprété en UTC minuit par JavaScript, ce qui
   peut afficher la veille dans l'email selon le fuseau d'exécution.
   Corrigé en ajoutant `T12:00:00`, comme c'était déjà fait correctement
   partout ailleurs dans le code (webhook, confirmation...) — raté
   uniquement ici lors de la première écriture.

## ⚠️ Risque de fond non résolu : fuseau horaire serveur vs heure stockée

Tout le code (création de booking, cron no-show, vérification des 48h
d'annulation, etc.) construit des `Date` JavaScript à partir de
`${booking.date}T${booking.time}` (ex: `2026-06-25T14:30`), **sans
suffixe de fuseau**. JavaScript interprète ce format comme l'heure locale
**du runtime qui exécute le code** — pas une heure absolue.

En développement local (ta machine, fuseau Europe/Paris), ça fonctionne
intuitivement : "14:30" stocké en base = 14h30 à Paris. **Mais Vercel
exécute ses fonctions serverless en UTC par défaut**, sauf configuration
explicite. Si ce n'est pas configuré, "14:30" stocké en base sera
interprété par le serveur de production comme 14h30 UTC — soit 16h30 ou
15h30 heure de Paris selon l'heure d'été/hiver. Ça décalerait silencieusement
tous les calculs sensibles au temps : déclenchement des no-shows, éligibilité
au remboursement des 48h, alertes de RDV imminent, rappels J-1.

Je n'ai pas de certitude sur le comportement réel de Vercel sans pouvoir
l'exécuter — certains runtimes Node respectent la variable d'env `TZ`,
d'autres l'ignorent selon la version. **Avant la mise en prod, vérifie
ce point en conditions réelles** : crée une réservation à une heure connue,
attends le déclenchement d'un cron sensible au temps (no-show par exemple),
et vérifie qu'il se déclenche au bon moment. Si décalage constaté, fixe
`TZ=Europe/Paris` dans les variables d'environnement Vercel, ou mieux,
migre les comparaisons sensibles vers des timestamps UTC explicites stockés
tels quels (ce qui demanderait de revoir le format de stockage de `time`).

## Audit de robustesse des migrations SQL (cette session)

Relecture dédiée des 7 fichiers `.sql` eux-mêmes — équilibre des
parenthèses, cohérence des slugs entre `insert`/`delete`/`select`,
échappement des apostrophes dans le seed, et surtout **idempotence**
(est-ce qu'un fichier replanté par erreur après une première exécution
réussie échoue, ou ne fait simplement rien ?). Trois trouvailles :

1. **`0001_schema.sql`, contrainte `fk_app_users_biz`** : contrairement au
   reste du fichier (`create table if not exists` partout), cette
   contrainte FK ajoutée séparément après la création de `businesses`
   n'était protégée par aucun `if not exists` ni bloc d'exception. Si
   `0001` était relancé une seconde fois, cette ligne aurait fait échouer
   toute la migration avec "constraint already exists" — alors que tout
   le reste du fichier se serait rejoué sans erreur. Rendue idempotente
   avec le même pattern `do $$ ... exception when duplicate_object`
   utilisé ailleurs dans ce fichier.

2. **`0005_realtime.sql`** : `alter publication ... add table` n'a pas de
   variante native `if not exists` en PostgreSQL — relancer ce fichier
   après une première exécution réussie aurait fait échouer la migration.
   Rendu idempotent avec une vérification préalable sur
   `pg_publication_tables`.

3. **`0007_alter_added_columns.sql`, backfill `referral_code`** : le
   `UPDATE` appelait `generate_referral_code()`, une fonction définie dans
   `0003`. Si quelqu'un exécutait `0007` avant `0003` par erreur d'ordre,
   ça aurait échoué avec "function does not exist". Rendu résilient : la
   fonction est maintenant redéfinie inline dans `0007` si elle n'existe
   pas encore, donc ce fichier fonctionne peu importe l'ordre réel
   d'exécution (même si l'ordre documenté `0001→0007` reste recommandé).

Vérifications qui se sont révélées **saines** (pas de bug) : équilibre des
parenthèses sur les 7 fichiers, cohérence parfaite des 45 slugs entre
insertion et suppression dans le seed, échappement correct des apostrophes
(`Gentleman''s Club`, `L''Atelier...`), garantie d'unicité du backfill de
codes de parrainage (dérivée de l'UUID, jamais de collision possible),
idempotence déjà correcte de `0003` et `0006`.

## Normalisation des numéros de téléphone (trouvé cette session)

Aucune normalisation de format de téléphone n'existait nulle part dans le
code — ni dans l'original Base44, ni dans les tours précédents de cette
migration. Pourtant, **au moins 13 endroits** comparent des téléphones
avec une égalité stricte (`===` ou `.eq('phone', ...)`), dont plusieurs
correctifs de sécurité que j'ai écrits moi-même plus tôt dans cette
session (`use-joker`, `cancel`, `checkin-by-qr`).

Sans format unique, `"0612345678"`, `"+33612345678"` et
`"06 12 34 56 78"` sont trois chaînes différentes pour ces comparaisons,
même s'il s'agit du même numéro réel. Concrètement, ça aurait pu casser
silencieusement : le matching de membre dans un groupe (la vérification
anti-doublon `existingByPhone`), la fidélité (un client qui ne retrouve
jamais son historique selon comment il retape son numéro), et même les
vérifications d'autorisation que j'ai ajoutées en audit (un utilisateur
légitime bloqué parce que son téléphone de profil et celui du membre ne
matchent pas au caractère près).

Corrigé avec une fonction `normalizePhone()` (présomption France : `0X...`
→ `+33X...`), dupliquée en TypeScript (`src/lib/booking-utils.ts`, utilisée
dans `/api/bookings/group`) et en SQL (`normalize_phone()`, utilisée par
le trigger d'inscription `0003`). Migration `0007` mise à jour avec un
backfill qui normalise les téléphones déjà stockés (`app_users.phone`,
`booking_members.phone`, `bookings.client_phone`) pour les bases qui
auraient déjà des données avant cette correction.

⚠️ Limitation connue : cette normalisation présume des numéros français
(`0X` → `+33X`). Si Book'nPay s'étend à d'autres pays, il faudra une
vraie librairie de validation/normalisation internationale (ex.
`libphonenumber-js`) plutôt que cette heuristique simple.

## Audit de cohérence package.json / tsconfig / imports réels

Vérification que toutes les dépendances déclarées sont utilisées, que tous
les packages importés dans le code sont bien déclarés, et que la
configuration TypeScript (`strict: true`) ne cache pas de pattern fragile.

- **`zod` retiré** : déclaré dans `package.json` mais jamais importé nulle
  part dans le code — dépendance fantôme qui aurait pu laisser croire
  qu'une validation de schéma existe quelque part alors que non.
- Vérifié et confirmé sain : tous les autres imports externes
  (`@supabase/*`, `stripe`, `date-fns`, `html5-qrcode`, `next/*`) sont
  bien déclarés ; aucun import vers un package non installé ; le pattern
  `params: Promise<...>` (Next.js 15) est utilisé de façon cohérente sur
  les 3 pages qui en ont besoin, sans mélange avec l'ancien style
  synchrone ; tous les `catch` sont typés `(error: any)` de façon
  cohérente (en TypeScript strict, un `catch (error)` sans type aurait
  cassé tout accès à `error.message`) ; les `as any` restants (4
  occurrences) sont limités aux jointures Supabase imbriquées
  difficiles à typer sans génération de types réels depuis le schéma.

## Observation : `bookings.status = 'completed'` n'est jamais utilisé

En vérifiant la cohérence entre les enums PostgreSQL et leurs usages réels
dans le code, j'ai remarqué que `booking_status` définit trois valeurs
(`active`, `cancelled`, `completed`), mais **rien dans le code — ni dans
l'original Base44, ni dans cette migration — ne met jamais un booking à
`completed`**. Une réservation honorée reste `active` au niveau du
booking ; seul le statut du *membre* (`booking_members.status = 'arrived'`)
reflète qu'elle a eu lieu. Ce n'est pas une régression introduite par la
migration — c'est un comportement hérité de l'entité `Booking` Base44
d'origine, qui définissait déjà cette valeur sans jamais l'assigner.

Conséquence pratique : pour distinguer "réservation à venir" de
"réservation passée et honorée", il faut systématiquement croiser
`bookings.date` avec le statut des `booking_members`, jamais se fier à
`bookings.status` seul. J'ai vérifié les 6 endroits qui filtrent sur
`status = 'active'` dans ce repo — tous sont cohérents avec ce
fonctionnement (no-show, rappels, gel d'établissement, comptage RDV à
venir), aucun ne suppose à tort que `completed` pourrait apparaître. Pas
de correctif nécessaire, mais utile de savoir si tu construis une
nouvelle fonctionnalité qui filtre sur le statut du booking.

## Audit des retours d'erreur silencieux (cette session)

Vérification de chaque appel `fetch()` côté composants pour repérer les cas
où une erreur serveur était bien interceptée mais jamais montrée à
l'utilisateur — un échec silencieux qui laisse la personne croire que son
action a réussi alors que non. Trois cas trouvés et corrigés :

1. **`CaisseEncaissement.tsx`** : si la clôture de prestation échouait,
   l'erreur partait seulement en `console.error` — le pro voyait juste le
   bouton redevenir cliquable, sans explication. Ajout d'un message
   d'erreur visible.
2. **`ChatThread.tsx`** : un message qui échouait à s'envoyer laissait le
   texte dans le champ sans aucune indication d'échec. Ajout d'un message
   d'erreur discret.
3. **`MyBookingsList.tsx`** : une annulation échouée (remboursement
   refusé, etc.) n'était signalée qu'en console — le client pouvait croire
   que son annulation avait réussi, ou retenter sans savoir que ça avait
   déjà échoué pour une vraie raison. Ajout d'un message d'erreur visible
   sous le titre de page.

Vérifié et confirmé déjà correct (pas de bug) : `AdminDashboard.tsx` et
`ProDashboard.tsx` (check-in QR) vérifiaient déjà `res.ok` avant de
mettre à jour leur état local — mon premier grep les avait signalés par
erreur (motif de recherche trop strict), une relecture plus précise a
confirmé qu'ils étaient sains.

Nettoyage cosmétique au passage : dans `ProDashboard.tsx`, un `useEffect`
s'était retrouvé intercalé entre deux groupes de `useState` lors d'un tour
précédent — pas un bug (l'ordre des hooks reste stable à chaque rendu,
donc valide), mais regroupé pour la lisibilité.

## Bugs trouvés et corrigés pendant la relecture (sans exécution)

1. **`BookingFlow.tsx`** : utilisait `useState(() => {...})` au lieu de
   `useEffect(() => {...}, [])` pour vérifier la session au montage — corrigé.
2. **Webhook Stripe / mode groupe** : la logique multi-slot cherchait un
   participant par `id` (clé primaire unique par ligne) au lieu d'un
   identifiant stable à travers plusieurs bookings. Ajout de la colonne
   `member_ref` dans `booking_members` (migration `0001`) + correction du
   webhook pour s'appuyer sur cette colonne.
3. **Jointure `app_users → businesses`** : `pro/page.tsx` et `queries/pro.ts`
   référençaient un nom de contrainte FK auto-généré
   (`app_users_biz_id_fkey`) qui ne correspond pas au nom que j'ai donné
   explicitement à la contrainte dans le schéma (`fk_app_users_biz`) —
   corrigé dans les deux fichiers.

Ces trois bugs n'auraient été visibles qu'à l'exécution. Il peut en rester
d'autres que seul un vrai build révélera — pas de garantie à 100% sans
compilation réelle.

## Ce qui est fait (relu, pas exécuté)

**Fondations**
- Schéma Supabase complet (15 tables + `member_ref`, RLS, trigger auth,
  Realtime sur `chat_messages`/`bookings`/`booking_members`)
- Seed des 45 établissements de démo

**Auth & parcours client**
- Auth email + mot de passe (signup/login/pages dédiées `/connexion`, `/inscription`)
- Recherche (`/recherche`), fiche établissement, parcours de réservation
  simple (1 personne) avec paiement Stripe Connect
- **Group booking complet** : route multi-actions (`/api/bookings/group`)
  portant getBooking, getBookingsByGroupRef, ajout de membre avec
  anti-doublon (téléphone/nom), capacité max 23, expiration d'invite 30min,
  retrait de membre, annulation des invites expirés. **Front maintenant
  câblé** (`/rejoindre/[bookingId]` via `JoinGroupClient.tsx`) — ⚠️ trouvé
  par trace bout-en-bout dans cette session : la route backend existait
  depuis plusieurs tours, mais AUCUN composant ne l'appelait jamais. Le
  group booking était donc fonctionnellement invisible/inutilisable malgré
  un backend complet. Corrigé en ajoutant la page de partage
  (`ShareGroupLink.tsx`, affichée sur `/confirmation` si le service accepte
  plusieurs personnes) et la page de jonction. Limitation connue : le lien
  de partage n'est affiché qu'une fois, juste après le paiement de
  l'organisateur — pas encore ré-accessible depuis `/mes-reservations` si
  l'organisateur revient plus tard sur cette réservation. Autre
  limitation : l'action `getBookingsByGroupRef` (mode `multiSlotPlan` de
  l'original — un groupe réparti sur plusieurs créneaux/bookings distincts)
  reste backend-only, non câblée côté front ; `JoinGroupClient.tsx` ne gère
  qu'un groupe sur un seul créneau/booking.
- Page "Mes réservations" avec statuts, carte fidélité, annulation
  (Joker ou marquage simple), **toggle Liste/Calendrier** (`WeekCalendar.tsx`)
- Page de détail d'une réservation (`/mes-reservations/[id]`) avec chat
  intégré (réutilise `ChatThread.tsx`)
- Page de confirmation post-paiement

**Espace pro**
- Dashboard condensé : stats du mois, réservations du jour, check-in,
  marquage no-show manuel
- **Vue calendrier mensuelle** (`ProCalendar.tsx`) avec heatmap de
  fréquentation, détail jour, export `.ics` — toggle Aujourd'hui/Calendrier
  dans le dashboard
- **Console de caisse** (`CaisseEncaissement.tsx`) : calcule le solde
  restant à encaisser sur place et clôture la prestation avec le mode de
  paiement choisi (app/TPE/espèces), envoie un reçu par email
- **Fiche client intelligente** (`FicheClientIntelligente.tsx`) : aide à la
  décision pour un no-show (rembourser en geste commercial ou garder les
  frais), basée sur l'historique de fiabilité du client CHEZ ce business
- **Panneau d'alertes** (`AlertsPanel.tsx`) : RDV imminent (<15 min),
  no-show probable (retard 5-120 min), calculé en direct sur les
  réservations du jour
- **Réglages notifications** (`/pro/reglages`) : préférences persistées en
  base (`business_settings.notification_prefs`) plutôt qu'en localStorage —
  ⚠️ comme dans l'original, la plupart des toggles sont déclaratifs, les
  crons ne lisent pas encore cette config pour décider d'envoyer ou non
- Stripe Connect onboarding (Express) + vérification de statut
- Liste des transactions Stripe

**Espace admin**
- Configuration des barèmes (`app_config`)
- Validation/rejet des candidatures partenaires

**Transversal**
- Chat client/pro en temps réel (Supabase Realtime) avec notification email
- Formulaire public de candidature partenaire (`/devenir-partenaire`)
- Webhook Stripe (paiement confirmé + remboursement)
- Cron no-show (Vercel Cron, 15 min)
- **6 crons secondaires** (`vercel.json` mis à jour) : rappels RDV
  J-1 (9h), vérification inactivité/déclassement fidélité (8h), relance
  onboarding pro à 24-48h (10h), reset annuel des jokers (1er janvier),
  **nettoyage des invitations de groupe expirées** (11h — voir TODO
  ci-dessous, pourquoi ce cron a été ajouté).
  ⚠️ **Limite réelle Vercel (vérifiée, pas de mémoire) : sur le plan
  Hobby, un cron ne peut tourner qu'une fois par jour maximum** — toute
  expression plus fréquente (comme mon `*/15 * * * *` pour le no-show) fait
  **échouer le déploiement**, pas juste un avertissement. Avec 6 crons
  configurés, le nombre n'est plus un problème (la limite de nombre a été
  relevée), mais la fréquence du cron no-show l'est : il faudra soit
  passer au plan Pro (qui autorise une fréquence plus fine), soit
  déclencher `check-no-shows` via un service externe (cron-job.org,
  GitHub Actions, etc.) plutôt que `vercel.json`. **Même limitation pour
  `cleanup-expired-invites`** : les invitations de groupe expirent après
  30 minutes, mais sur Hobby ce cron ne peut tourner qu'1x/jour — un
  participant qui ne paie pas dans les 30 minutes bloquera sa place
  jusqu'à 24h plutôt que 30 min, sauf passage au plan Pro ou scheduler
  externe.
- Fidélité (statuts/jokers) en routes API
- **Annulation client avec remboursement conditionnel** (`/api/bookings/cancel`) :
  applique la règle des 48h (remboursement intégral si annulé à temps, frais
  conservés par le pro sinon), s'appuie sur `stripe_payment_intent_id` stocké
  en base plutôt que de re-chercher la session Stripe par pagination
- **Parrainage fonctionnel** : code généré automatiquement à l'inscription
  (`referral_code` via trigger SQL), capture du `?ref=` au signup
  (`referred_by`), et récompense réellement créditée (+5 RDV honorés, +1
  Joker pour le parrain ET le parrainé) au premier RDV honoré du parrainé.
  ⚠️ Dans l'original Base44, `ParrainageCard.jsx` affichait cette promesse
  mais **aucune fonction ne l'appliquait jamais** — recherché dans les 24
  fonctions Edge, rien ne traitait `?ref=` ni ne créditait de bonus. Ce
  n'est donc pas une simplification de ma part : la mécanique de récompense
  n'existait nulle part avant cette migration, je l'ai construite pour que
  la promesse affichée au client soit honorée.
- **QR check-in scanné** (`/api/bookings/checkin-by-qr` + composant
  `QRScanner.tsx`, utilisant `html5-qrcode` — ajoutée à `package.json` mais
  non testée par installation réelle dans cette session)

## Ce qui N'EST PAS fait (périmètre restant)

- ⚪ **Flash Slots UI** : la table et le cron de désactivation existent
  côté backend, mais `src/components/FlashSlots.jsx` dans l'original
  Base44 est déjà désactivé ("Ventes Flash supprimées" — `return null`).
  Décision produit déjà prise par toi avant la migration ; je n'ai donc
  pas reconstruit cette UI. Dis-moi si tu veux la réactiver.
- ❌ **Sync calendrier externe** (`CalendarSyncButton.jsx`).
- ✅ Pages CGU (`/cgu`), Pricing publique (`/tarifs`), gel de compte pro
  (`/admin`, onglet Établissements + `/api/admin/freeze-business`) — faits
  dans cette session. ⚠️ La page `/tarifs` décrit un modèle d'abonnement
  SaaS mensuel pour les pros (Starter/Business/Scale) qui n'a **aucune**
  logique de facturation récurrente Stripe associée dans ce repo — c'est
  une page marketing déconnectée de toute facturation réelle pour
  l'instant, différente du modèle "frais de réservation + frais de
  gestion" qui, lui, est implémenté.
- ❌ `sendPostPrestationEmail` (email de satisfaction 2h après un RDV
  honoré, mentionné dans les CGU section 10) — pas encore porté.
- ❌ **Délai webhook potentiellement visible** : Stripe redirige vers
  `successUrl` (`/confirmation`) immédiatement après le paiement, mais le
  webhook `checkout.session.completed` qui passe le statut du membre à
  `paid` arrive de façon asynchrone — généralement en quelques secondes,
  mais sans garantie de délai. Si l'utilisateur clique "Voir mes
  réservations" très vite après avoir payé, il peut voir un statut
  "⚠️ Paiement en attente" pendant quelques secondes avant que le webhook
  n'ait traité l'événement, même si le paiement a bien réussi. Comportement
  inhérent à toute architecture webhook asynchrone (pas un bug introduit),
  mais pourrait surprendre un utilisateur impatient. Atténuable avec un
  polling léger sur `/mes-reservations` ou `/confirmation` — pas fait pour
  l'instant.
- ❌ Email transactionnel réel : toutes les routes ont un fallback
  `console.log` si `RESEND_API_KEY` est absente — branche un vrai
  fournisseur avant la prod.
- ❌ **Désynchronisation potentielle des frais de gestion affichés** :
  `StepPayment.tsx` calcule les frais affichés au client via
  `calcFraisGestion()` (constantes JS statiques 1,99/2,10/2,30/2,50€), alors
  que `/api/stripe/checkout` lit en priorité `app_config` (modifiable
  depuis `/admin`) pour le montant **réellement facturé**. Si tu changes un
  palier dans l'admin, le récapitulatif affiché au client avant paiement ne
  reflétera plus le vrai montant prélevé (le total réel sera correct, mais
  le chiffre affiché avant le clic "Payer" sera périmé). Pas une faille de
  sécurité (le serveur ne fait jamais confiance au client pour le montant
  réel), mais un vrai bug d'UX si tu modifies les paliers en prod. Corrigible
  en faisant lire `app_config` aussi côté `StepPayment.tsx`, ou en exposant
  une route `/api/config/frais-gestion` publique en lecture.
- ❌ **Race condition possible sur la capacité de groupe**
  (`/api/bookings/group`, action `addMemberAndGetCheckout`) : la
  vérification "groupe complet ?" lit le nombre de membres actifs, puis
  insère le nouveau membre dans une requête séparée — sans transaction ni
  verrou. Si deux personnes rejoignent le même groupe au même instant
  alors qu'il ne reste qu'une place, les deux peuvent passer la
  vérification avant que l'insert de l'autre soit visible, dépassant
  légèrement la capacité prévue. Risque faible en pratique (fenêtre de
  quelques centaines de ms), mais réel. Une correction propre nécessiterait
  une fonction PostgreSQL transactionnelle (`select ... for update` ou une
  contrainte d'unicité applicative) plutôt qu'un lire-puis-écrire côté
  Next.js.
- ❌ Tests automatisés (aucun test n'existe).

## ⚠️ Si tu as déjà exécuté les migrations d'une session précédente

Si tu pars d'une base Supabase **neuve**, ignore cette section : `0001` à
`0006` couvrent déjà tout, dans l'ordre. `0007` est redondant dans ce cas
(les `if not exists` ne feront rien) — tu peux l'exécuter sans risque, ou le
sauter.

Si tu avais déjà exécuté une **version antérieure de 0001** sur ton
Supabase (avant que je n'ajoute `member_ref`, `payment_mode`,
`referral_code`/`referred_by`/`referral_reward_granted`,
`notification_prefs`) : exécute `0007_alter_added_columns.sql` après tes
migrations existantes — il ajoute uniquement les colonnes manquantes
(`alter table add column if not exists`), sans toucher à tes données.

Le trigger (`0003`) peut être ré-exécuté sans risque dans tous les cas :
`create or replace function` et `drop trigger if exists` le rendent
rejouable. `0006` (seed app_config) est idempotent (`on conflict do
nothing`).

## Prochaines étapes recommandées

1. `npm install`, configurer `.env.local` depuis `.env.example`, `npm run dev`
2. Exécuter les migrations SQL dans l'ordre (`0001` → `0006`, puis `0007`
   uniquement si tu avais déjà une base existante — voir section ci-dessus)
   dans l'éditeur SQL Supabase
3. Suis **`TEST_PROTOCOL.md`** (à la racine de ce repo) — c'est une liste de
   vérifications concrètes dans l'ordre, avec des critères de succès/échec
   précis pour chaque flux (auth, paiement, group booking, espace pro,
   admin, crons, et les cas limites trouvés pendant l'audit). Coche au fur
   et à mesure ; reviens vers moi avec le message d'erreur exact dès que
   quelque chose casse plutôt que d'essayer de corriger à l'aveugle.
4. Le point le plus incertain de tout cet audit (section 8 du protocole) :
   le fuseau horaire en production. Je n'ai aucun moyen de le vérifier
   sans exécution réelle — c'est le test le plus important à faire avant
   de considérer le projet prêt pour de vrais clients.

## Variables d'environnement requises

Voir `.env.example`. Tu as déjà l'URL Supabase
(`suyfsuvrbdpnnijxspge.supabase.co`) — récupère `anon key` et
`service_role key` dans Project Settings > API du dashboard.
