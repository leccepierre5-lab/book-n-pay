# Audit SEO — Book'nPay
Lecture seule. Vérifications faites en conditions réelles : `npm run build` + `next start` local, et requêtes `curl` directes sur `https://www.book-n-pay.com` en prod (GET uniquement, aucune écriture).

---

## POINT 1 — Fiches démo réellement en noindex ?

| # | Constat | Fichier:ligne | Gravité | Correction suggérée |
|---|---|---|---|---|
| 1.1 | Le critère "fiche démo" n'est **pas** une colonne dédiée (`is_demo`) mais une heuristique : `owner_id IS NULL` OU `slug LIKE 'fixture-pro-%'` OU `slug LIKE 'test-%'`. Aucune colonne `is_demo` n'existe sur `businesses` (elle existe sur `bookings`/`group_bookings`, table différente, sans rapport). Confirmé par `database.types.ts` et absence totale de `is_demo` dans le schéma `businesses`. | `src/lib/business-helpers.ts:17-19` (`isNonRealBusiness`), `:53-55` (`isTesterOnlyBusiness`) ; `src/lib/database.types.ts:41-65` | MOYEN | Documenté comme volontaire dans les commentaires du code (le seul point de création réelle pose `owner_id`, `src/app/api/admin/applications/route.ts:175`). Heuristique cohérente aujourd'hui mais fragile : si un futur import/script pose un `owner_id` par erreur sur une fiche factice, elle devient indexable sans le vouloir. Envisager une vraie colonne `is_demo` si le volume de sources de création augmente. |
| 1.2 | **Confirmé en prod réelle** (curl sur `www.book-n-pay.com`) : une fiche démo (`demo-animaux-aire-sur-l-adour-2`) émet bien `<meta name="robots" content="noindex, nofollow"/>` réellement rendu dans le HTML servi. | `src/app/(public)/etablissement/[slug]/page.tsx:115-116` | — (OK) | RAS sur ce sous-point isolé. |
| 1.3 | **MAIS** cette même fiche démo (et **toute** fiche à `owner_id NULL`, donc les ~1124 fiches du seed `demo-%`) déclenche en réalité `notFound()` avant même d'afficher le contenu (`isTesterOnlyBusiness(business) && !isDemoTester`). Résultat vérifié en prod : la page retourne le contenu de `not-found.tsx` ("Page introuvable") **avec un HTTP status 200**, pas 404. Un `<meta name="robots" content="noindex"/>` supplémentaire (injecté nativement par Next.js pour tout `notFound()`) s'ajoute à celui de `generateMetadata`, donnant 2 balises `meta robots` dans le même `<head>`. Voir détail complet en point 9. | `src/app/(public)/etablissement/[slug]/page.tsx:170-177` | HAUT (recoupe point 9) | Voir point 9 — soft-404 sitewide sur `notFound()`. La branche "Fiche de démonstration" (ligne 373, pensée pour l'affichage confort) est en pratique **du code mort** pour les 1124 fiches `demo-%`, car `isTesterOnlyBusiness` (plus large, testé en premier) les intercepte toujours avant. |
| 1.4 | Sitemap : `getSitemapBusinesses()` filtre bien `owner_id NOT NULL`, `frozen=false`, `is_published=true`, exclut `fixture-pro-%`, `test-%`, et `SHOWCASE_SLUGS` (`demo-book-n-pay`). **Vérifié en prod réelle** : `sitemap.xml` contient actuellement **6 URLs, 0 fiche établissement** — parce qu'il n'existe à ce jour **aucun business réel** en base (`owner_id` non NULL) : cohérent avec la mémoire projet (radiation micro-entreprise, aucun vrai partenaire approuvé). Donc aujourd'hui, 0 risque de fuite démo par le sitemap — mais ce sera le premier test critique à refaire dès l'approbation du premier vrai partenaire. | `src/lib/queries/catalog.ts:207-229` ; sitemap prod vérifié via `curl https://www.book-n-pay.com/sitemap.xml` | — (OK aujourd'hui, à re-tester au 1er vrai partenaire) | Aucune action requise maintenant. Retester `sitemap.xml` dès la 1ère fiche réelle publiée. |
| 1.5 | `/recherche` (page de listing) exclut bien les fiches à `owner_id NULL` pour un visiteur non-testeur (`opts?.isTester` calculé côté serveur uniquement, jamais un paramètre client). **Vérifié en prod locale** : `/recherche` sans session ne génère **aucun** lien `<a href="/etablissement/...">` (0 lien, cohérent avec 0 business réel actuellement) — donc aucun dofollow vers une fiche démo possible aujourd'hui pour un visiteur/crawler anonyme. | `src/lib/queries/catalog.ts:81-83` ; `src/app/(public)/recherche/page.tsx:52-57` | — (OK) | RAS. |
| 1.6 | Doute à noter explicitement : le comportement pour un slug `fixture-pro-*` (12 comptes réels de test, `owner_id` non NULL mais `isTesterOnlyBusiness=true`) n'a pas été testé en requête réelle (pas de slug connu à disposition dans ce rapport). Le code suggère un comportement identique à 1.3 (soft-404 + noindex), mais **non vérifié empiriquement** — à confirmer avant de considérer ce sous-cas clos. | `src/lib/business-helpers.ts:43-45` | — (doute déclaré) | Tester une URL `fixture-pro-*` en conditions réelles avant de clore ce point. |

**Verdict point 1** : la fiche démo n'atterrit dans aucun sitemap, n'est liée nulle part en dofollow, et porte bien un signal noindex à la fois via `generateMetadata` et via le `notFound()` natif de Next.js. Le noindex fonctionne donc *en pratique* aujourd'hui. Le problème réel n'est pas "est-ce indexé" (non) mais "la manière dont c'est bloqué est un soft-404 sitewide" (voir point 9) — un anti-pattern SEO connu (Search Console le signale explicitement comme erreur), même s'il n'entraîne pas d'indexation à tort dans l'état actuel.

---

## POINT 2 — robots.txt

| Constat | Fichier:ligne | Gravité | Correction suggérée |
|---|---|---|---|
| Génération dynamique via App Router, contenu vérifié identique entre code source et prod réelle (`curl https://www.book-n-pay.com/robots.txt`). Disallow cohérent : `/admin`, `/pro`, `/api`, `/connexion`, `/inscription`, `/mon-compte`, `/mes-reservations`, `/mes-favoris`, `/confirmation`, `/pay`, `/rejoindre`, `/simulator`. | `src/app/robots.ts:4-30` | — (OK) | RAS. |
| `/simulator` est en `Disallow` (empêche le crawl) mais n'a **pas** de `noindex` propre (pas de `generateMetadata` dans `src/app/(public)/simulator/page.tsx`). Un `Disallow` empêche le crawl, pas nécessairement l'indexation d'une URL découverte par un lien externe (Google peut indexer l'URL "à l'aveugle", sans extrait). Cas mineur, faible probabilité. | `src/app/(public)/simulator/page.tsx` (pas de metadata) ; `src/app/robots.ts:25` | BAS | Si `/simulator` n'a aucune valeur SEO, ajouter un `noindex` explicite en plus du disallow (défense en profondeur), au lieu de compter sur le disallow seul. |
| Aucune règle spécifique par environnement (pas de condition sur `VERCEL_ENV`) dans `robots.ts` — le contenu est identique en prod et en preview Vercel. Voir point 12 pour l'analyse complète. | `src/app/robots.ts` | MOYEN (recoupe point 12) | Voir point 12. |

---

## POINT 3 — sitemap.xml

| Constat | Fichier:ligne | Gravité | Correction suggérée |
|---|---|---|---|
| Contenu réel actuel (vérifié en prod) : 6 URLs statiques (`/`, `/recherche`, `/tarifs`, `/devenir-partenaire`, `/mentions-legales`, `/cgu`), 0 fiche établissement (voir 1.4). Aucune URL morte détectée dans ces 6 URLs — toutes répondent en 200 sur le contenu réel attendu. | `src/app/sitemap.ts:8-15` | — (OK) | RAS. |
| `/mentions-legales` est listé dans le sitemap alors que sa propre page est en `robots: { index: false, follow: false }` (identité éditeur CCI Bayonne manquante — dette connue, cf. mémoire projet `project_bnp_gap_analysis_cahier_charges`). Incohérence : une URL noindex ne devrait pas figurer dans le sitemap (signal contradictoire pour Google). | `src/app/sitemap.ts:13` vs `src/app/(public)/mentions-legales/page.tsx:15` | MOYEN | Retirer `/mentions-legales` du sitemap tant qu'elle reste en `noindex`, ou l'y remettre seulement une fois l'identité éditeur complétée et le noindex levé. |
| `getSitemapBusinesses()` ne filtre le `owner_id` correctement que si l'app ne crée jamais de business à `owner_id` non NULL par un chemin autre que l'approbation partenaire — un seul point de création vérifié (`applications/route.ts:175`), cohérent avec le commentaire du code. Pas d'autre chemin de création trouvé dans `src/app/api`. | `src/lib/queries/catalog.ts:207-229` | — (OK, vérifié) | RAS. |

---

## POINT 4 — Title / meta description

| Constat | Fichier:ligne | Gravité | Correction suggérée |
|---|---|---|---|
| Template global cohérent : `%s | Book'nPay`, titre par défaut distinct pour la home. Vérifié réellement rendu sur plusieurs pages (home, tarifs, recherche, fiche établissement) — pas de duplication générique constatée sur les pages testées. | `src/app/layout.tsx:19-25` | — (OK) | RAS. |
| `/simulator` n'a **aucun** `export const metadata` — hérite du titre/description génériques de la home ("Book'nPay — Réservation en ligne beauté & bien-être"), non spécifique à la page. Duplication de title/description avec la home. | `src/app/(public)/simulator/page.tsx` | BAS (page disallow, faible impact) | Ajouter un `metadata` dédié si la page doit un jour devenir indexable ; sinon acceptable vu le disallow. |
| Fiches établissement : title/description générés dynamiquement (`{name} — {activité} à {ville}` / `Réservez en ligne chez {name}...`), uniques par fiche, longueur raisonnable observée sur l'exemple testé (title ≈ 60 caractères, description ≈ 140 caractères). Pas de fallback vide détecté. | `src/app/(public)/etablissement/[slug]/page.tsx:118-132` | — (OK) | RAS. |

---

## POINT 5 — Canonical

| Constat | Fichier:ligne | Gravité | Correction suggérée |
|---|---|---|---|
| Fiche établissement : canonical self-referencing correct, vérifié en prod (`<link rel="canonical" href="https://www.book-n-pay.com/etablissement/{slug}"/>`). | `src/app/(public)/etablissement/[slug]/page.tsx:148` | — (OK) | RAS. |
| `/recherche` : canonical fixe vers `/recherche` sans query params, **vérifié réellement** avec `?category=beaute` — le canonical reste bien `https://www.book-n-pay.com/recherche` quel que soit le filtre. Bonne pratique volontaire (évite la dilution du classement entre variantes de filtres), documentée en commentaire. | `src/app/(public)/recherche/page.tsx:7` | — (OK) | RAS. |
| **`/tarifs` n'a aucun canonical** (`alternates` absent de `src/app/(public)/tarifs/layout.tsx`). Vérifié en prod locale : `<link rel="canonical">` absent du HTML rendu. Page présente dans le sitemap avec priority 0.6, donc jugée importante, mais sans self-canonical. | `src/app/(public)/tarifs/layout.tsx:3-7` | MOYEN | Ajouter `alternates: { canonical: '/tarifs' }`. |
| **La home (`/`) n'a aucun canonical** non plus — vérifié en prod locale, `<link rel="canonical">` absent. `metadataBase` est bien défini (`src/app/layout.tsx:20`) mais cela ne génère pas automatiquement une balise canonical. | `src/app/layout.tsx:19-35` | MOYEN | Ajouter `alternates: { canonical: '/' }` dans les metadata de `src/app/layout.tsx` ou de `src/app/page.tsx`. |
| `/devenir-partenaire` a un canonical explicite correct. `/mentions-legales`, `/cgu` non vérifiés en détail (moindre priorité, déjà noindex ou faible trafic). | `src/app/(public)/devenir-partenaire/page.tsx:9` | — (OK) | RAS. |

---

## POINT 6 — Structure Hn

| Constat | Fichier:ligne | Gravité | Correction suggérée |
|---|---|---|---|
| Home : un seul H1, rendu côté serveur (SSR), confirmé dans `HomeClient.tsx:307`. | `src/components/home/HomeClient.tsx:307` | — (OK) | RAS. |
| Fiche établissement : un seul H1 (`{business.name}`), pas de saut de niveau détecté dans ce fichier. | `src/app/(public)/etablissement/[slug]/page.tsx:184` | — (OK) | RAS. |
| **`/recherche` n'a AUCUN H1 ni H2** — vérifié dans le HTML réellement rendu (0 occurrence de `<h1` et `<h2` sur la page, filtres et titre "X établissements" ne sont que des `<Link>`/`<p>`). C'est une page listée dans le sitemap avec priority 0.9 (2e priorité après la home), donc SEO-sensible, sans structure de titre du tout. | `src/app/(public)/recherche/page.tsx` (aucun `<h1>`/`<h2>` dans tout le fichier) | HAUT | Ajouter un H1 (ex. "Trouvez et réservez un professionnel près de chez vous", ou dynamique selon `category`/`city`) — d'autant plus important avec l'arrivée de nouvelles catégories métier, où cette page va porter le poids SEO des nouvelles requêtes ("sophrologue Bayonne" etc.). |

---

## POINT 7 — Données structurées JSON-LD

| Constat | Fichier:ligne | Gravité | Correction suggérée |
|---|---|---|---|
| Fiche établissement : `LocalBusiness` avec `name`, `url`, `telephone`/`image` conditionnels, `address`+`geo` OU `areaServed` (jamais les deux, cohérent avec `address_public`), `openingHoursSpecification`, `makesOffer`. Volontairement pas d'`aggregateRating` (avis non fondés sur de vrais avis visibles — évite une pénalité manuelle Google, décision déjà documentée en commentaire). Schéma raisonnablement conforme schema.org. | `src/app/(public)/etablissement/[slug]/page.tsx:37-95` | — (OK) | RAS. |
| Le JSON-LD n'est **pas** émis sur les fiches non réelles (`!isNonRealBusiness(business)` conditionne le `<script type="application/ld+json">`), cohérent avec le noindex. | `src/app/(public)/etablissement/[slug]/page.tsx:220-225` | — (OK) | RAS. |
| Root layout : JSON-LD `@graph` avec `SoftwareApplication` + `Organization`, prix dérivés de `BNP_PLANS` (source de vérité unique). Pas de `LocalBusiness` global pour l'entreprise elle-même (normal, c'est une plateforme, pas un commerce physique). | `src/app/layout.tsx:44-75` | — (OK) | RAS. |
| Non vérifié avec un validateur schema.org officiel (Rich Results Test) — seule une relecture structurelle a été faite. À confirmer par Pierre via https://search.google.com/test/rich-results une fois une vraie fiche indexable disponible. | — | — (doute déclaré) | Passer l'URL d'une vraie fiche (dès qu'il y en aura une) dans le Rich Results Test de Google. |

---

## POINT 8 — Open Graph / Twitter Cards

| Constat | Fichier:ligne | Gravité | Correction suggérée |
|---|---|---|---|
| Présents et cohérents, vérifiés dans le HTML réel : `og:title`, `og:description`, `og:locale`, `og:image`, `og:image:alt`, `og:type`, `twitter:card=summary_large_image`, `twitter:title/description/image/image:alt`. | `src/app/(public)/etablissement/[slug]/page.tsx:149-155` | — (OK) | RAS. |
| Image de repli `/og-default.png` existe bien dans `public/` (vérifié) — pas de fallback cassé. | `public/og-default.png` (présent) | — (OK) | RAS. |
| Sur une fiche fictive, `og:image` retombe systématiquement sur `/og-default.png` (pas de vraie photo), volontaire et documenté. | `src/app/(public)/etablissement/[slug]/page.tsx:139-142` | — (OK, volontaire) | RAS. |

---

## POINT 9 — Pages d'erreur : vraie 404 vs soft-404

| Constat | Fichier:ligne | Gravité | Correction suggérée |
|---|---|---|---|
| **BLOQUANT confirmé en production réelle** (`curl` direct sur `www.book-n-pay.com`, pas seulement en local) : une URL de fiche établissement inexistante (`/etablissement/ce-slug-nexiste-vraiment-pas-xyz`) renvoie **HTTP 200 OK** avec le contenu de `not-found.tsx` ("Page introuvable") au lieu d'un vrai statut 404. Idem pour toute fiche à `owner_id NULL` (les ~1124 démo) vue par un visiteur non-testeur. | `src/app/(public)/etablissement/[slug]/page.tsx:167,177` déclenchent `notFound()` ; comportement Next.js documenté dans `node_modules/next/dist/client/components/not-found.js:21` ("insert un meta noindex ET status 404") — le status 404 n'est **pas** appliqué en pratique ici. | HAUT | Cause probable : `generateMetadata` est async (attend une requête DB) donc les headers HTTP (status 200 par défaut) sont déjà committés/streamés avant que `notFound()` soit levé plus loin dans le rendu du composant page — Next.js ne peut alors plus changer le status a posteriori (limite connue du streaming SSR de l'App Router). À creuser côté Pierre : soit trouver un moyen de lever `notFound()` plus tôt (avant tout flush), soit vérifier si une version plus récente de Next corrige ce comportement, soit ajouter un contrôle applicatif qui force un vrai 404 (ex. Route Handler dédié, ou vérification en amont dans un `layout.tsx`/middleware avant le streaming). |
| Conséquence pratique : Google Search Console classera potentiellement ces URLs comme "soft 404" (catégorie d'erreur explicitement suivie dans le rapport Couverture). Le `noindex` présent limite le risque d'indexation à tort, mais n'élimine pas le gaspillage de budget de crawl ni l'alerte Search Console. Tout outil de monitoring qui se fie au status HTTP (au lieu du contenu) pour détecter des 404 sera aveugle à ce problème. | — | HAUT | Idem ligne au-dessus — un seul correctif à trouver, impact large (toute URL `/etablissement/[slug]` inexistante ou démo, potentiellement `/mes-reservations/[id]` aussi, voir ligne suivante). |
| Le même pattern `notFound()` existe sur `/mes-reservations/[id]` — **non testé en conditions réelles** dans cet audit (nécessite une session authentifiée), mais partage la même architecture (route dynamique + `generateMetadata`/données asynchrones + `notFound()`), donc probablement affecté par le même soft-404. Doute à lever. | `src/app/(public)/mes-reservations/[id]/page.tsx` | — (doute déclaré) | Pierre : vérifier `curl` (avec cookie de session) sur un ID de réservation inexistant pour confirmer/infirmer. Moindre priorité SEO (page authentifiée, déjà hors index via disallow `/mes-reservations`). |
| `not-found.tsx` générique (utilisé par le routeur Next quand aucune route ne matche du tout, ex. `/n-importe-quoi`) — non testé séparément dans cet audit, mais son comportement dépend du même mécanisme Next.js ; probablement le même soft-404 pour toute URL complètement inconnue du site. | `src/app/not-found.tsx` | — (doute déclaré, à tester) | Pierre : `curl -D - https://www.book-n-pay.com/url-totalement-inventee` pour confirmer si le 404 générique (sans passer par `notFound()` explicite dans une page) a le même problème ou est correctement en 404. |

---

## POINT 10 — Performance / signaux Core Web Vitals

| Constat | Fichier:ligne | Gravité | Correction suggérée |
|---|---|---|---|
| Toutes les images utilisent `next/image` (`<Image>`) — aucune balise `<img>` brute trouvée dans `src/app` ni `src/components` (recherche exhaustive). | `src/app/(public)/etablissement/[slug]/page.tsx:247` et ailleurs | — (OK) | RAS. |
| Police via `next/font/google` (`Inter`), avec `display: 'swap'` explicite — évite le blocage de rendu par la police (FOIT). | `src/app/layout.tsx:9-13` | — (OK) | RAS. |
| Pas de Lighthouse/CWV mesuré (hors scope demandé) — seuls les signaux de code ont été vérifiés, tous positifs sur ce point. | — | — | RAS. |

---

## POINT 11 — URLs

| Constat | Fichier:ligne | Gravité | Correction suggérée |
|---|---|---|---|
| `trailingSlash` non configuré dans `next.config.mjs` → comportement par défaut Next.js (pas de slash final, redirection automatique si un slash final est demandé). Pas de risque de duplication avec/sans slash constaté. | `next.config.mjs` (absence de la clé) | — (OK) | RAS. |
| Slugs des fiches établissement lisibles et cohérents (`demo-animaux-aire-sur-l-adour-2`, kebab-case, catégorie+ville+index). Slugs `fixture-pro-*` et `test-*` sont des résidus techniques bien identifiés et filtrés (voir point 1). | `supabase/seed/demo_businesses.sql:11-1092` | — (OK) | RAS. |

---

## POINT 12 — Environnements preview Vercel

| Constat | Fichier:ligne | Gravité | Correction suggérée |
|---|---|---|---|
| **Aucune protection applicative** trouvée dans le code : ni `next.config.mjs`, ni `vercel.json`, ni `middleware.ts` ne conditionnent un header `X-Robots-Tag` ou un `robots.txt`/`sitemap.ts` différent selon `process.env.VERCEL_ENV`. Le repo s'appuie **entièrement et sans filet applicatif** sur le comportement automatique de Vercel (qui ajoute par défaut `X-Robots-Tag: noindex` sur les déploiements preview `*.vercel.app`). | `next.config.mjs`, `vercel.json`, `src/middleware.ts` (aucune trace de `VERCEL_ENV`) | MOYEN | Ajouter une défense en profondeur : dans `src/app/robots.ts`, retourner `disallow: '/'` global si `process.env.VERCEL_ENV === 'preview'` (ou différent de `'production'`), au lieu de compter uniquement sur le header automatique de la plateforme. Faible effort, élimine un point de défaillance externe (dépendance à un comportement Vercel non garanti contractuellement et modifiable). |
| `SITE_URL` est codé en dur sur `https://www.book-n-pay.com` (pas dérivé de `VERCEL_URL`), donc un déploiement preview génère un `sitemap.xml`/`robots.txt` qui référence quand même le domaine de prod — pas dangereux en soi (n'expose rien côté preview), mais peut prêter à confusion en cas de test manuel sur preview. | `src/lib/site-config.ts:3` | BAS | Aucune action nécessaire à ce stade — cohérent avec le fait que seule la prod doit être indexée. |
| Non vérifié empiriquement dans cet audit : impossible de confirmer ici si le header `X-Robots-Tag` est réellement présent sur un déploiement preview actuel (aucune URL preview active fournie/testée). Doute explicite à lever par Pierre en jetant un oeil aux headers d'un preview Vercel réel (`curl -I` sur une URL `*.vercel.app` de branche). | — | — (doute déclaré) | Pierre : vérifier une URL preview réelle avec `curl -I` pour confirmer la présence du header Vercel avant de considérer ce point clos. |

---

## SYNTHÈSE

### (a) BLOQUANT avant d'ajouter les nouvelles catégories métier

1. **Soft-404 sitewide sur `/etablissement/[slug]`** (point 9) — confirmé en production réelle : toute fiche inexistante ou démo répond en HTTP 200 avec le contenu "Page introuvable", au lieu d'un vrai 404. Le `noindex` limite le dégât côté indexation (les fiches démo ne devraient pas être indexées aujourd'hui), mais ce n'est pas un vrai filet — Search Console va accumuler des alertes "soft 404", et **ajouter des centaines de nouvelles fiches démo pour les catégories bien-être/sophrologie/naturopathie va démultiplier ces soft-404 dans le rapport Couverture**, rendant plus difficile de repérer un vrai problème d'indexation le jour où de vraies fiches existeront. C'est le risque business explicite de Pierre (multiplication de pages "vides" visibles par Google), sauf qu'ici elles sont vides ET signalées en erreur plutôt que silencieusement absentes.
2. **`/recherche` sans aucun H1** (point 6) — c'est la page qui va porter tout le poids SEO des nouvelles catégories (requêtes "sophrologue [ville]", "naturopathe [ville]"...). Sans structure de titre, l'ajout de catégories n'apporte aucun bénéfice SEO organique sur cette page tant que ce n'est pas corrigé.
3. **Sitemap : `/mentions-legales` listé alors que noindex** (point 3) — signal contradictoire à corriger avant tout effort d'indexation sérieux, sinon Google reçoit des instructions incohérentes dès le premier crawl approfondi.

### (b) Peut attendre

- Canonical manquant sur `/` et `/tarifs` (point 5) — impact limité tant que le trafic organique reste faible et qu'il n'y a pas de vraies variantes d'URL concurrentes.
- Absence de colonne `is_demo` dédiée (point 1.1) — l'heuristique actuelle fonctionne, juste fragile sur le long terme.
- Défense en profondeur sur les previews Vercel (point 12) — le filet automatique de la plateforme fonctionne probablement déjà ; ajouter le code applicatif est une amélioration de robustesse, pas une urgence.
- `/simulator` sans metadata dédiée (point 4) — déjà protégée par `Disallow`, impact SEO marginal.
- Vérifications restées en doute déclaré (JSON-LD non passé au validateur officiel, comportement `/mes-reservations/[id]` et `not-found.tsx` générique non testés en conditions réelles, comportement `fixture-pro-*` non testé) — à lever quand le temps le permet, aucune n'a de signal montrant un problème actif.

**Point notable positif** : contrairement à la crainte initiale, la fuite d'indexation des ~1124 fiches démo n'est **pas** confirmée aujourd'hui — ni le sitemap, ni la recherche publique ne les exposent, et le `noindex` est bien émis (même via un mécanisme bancal). Le vrai chantier avant d'ouvrir de nouvelles catégories est de fiabiliser le comportement HTTP (point 9) et la page `/recherche` (point 6), pas de "boucher une fuite" qui n'existe pas dans l'état actuel de la base.
