# Book'nPay — État du projet (5 juillet 2026)

## Stack

- **Next.js 16.2.9** (App Router) + **TypeScript strict**
- **Supabase** (auth + base de données + RLS)
- **Stripe** (Checkout + Connect + webhooks — en mode **test**, bascule live bloquée jusqu'à régularisation URSSAF)
- **Tailwind CSS** (palette navy/mint custom)
- **Resend** (emails transactionnels)
- **Vercel** (déploiement, crons via `vercel.json`)

Migration depuis une app **Base44** (no-code). Toute la logique métier a été portée à la main.

---

## CE QUI FONCTIONNE

### Pages publiques
| Route | Notes |
|---|---|
| `/recherche` | Filtres catégorie/ville/prix/note, autocomplétion clavier+souris sur le filtre ville, exclut établissements gelés |
| `/etablissement/[slug]` | Fiche + BookingFlow (genre Homme/Femme/Enfants, staff, multi-créneaux) |
| `/connexion`, `/inscription` | Auth Supabase, parrainage (`?ref=`), génération `referral_code` |
| `/confirmation` | Post-paiement + lien partage groupe |
| `/mes-reservations`, `/mes-reservations/[id]` | Liste + calendrier, statuts, annulation (+ Joker), fidélité, parrainage |
| `/mes-favoris` | Favoris |
| `/mon-compte` | Profil, suppression de compte self-service |
| `/rejoindre/[bookingId]` | Rejoindre une réservation de groupe |
| `/pay/[memberId]` | Paiement individuel dans un groupe |
| `/cgu`, `/tarifs`, `/devenir-partenaire`, `/simulator` | Pages statiques / formulaires |

### Espace pro (`/pro/*`)
Dashboard (réservations du jour, stats, check-in QR, caisse, calendrier), `équipe` (planning staff), `flash-slots`, `onboarding`, `prestations` (genre Enfants/Garçon/Fille), `profil`, `réglages`, `setup-billing`, `transactions`.

### Espace admin (`/admin`)
Candidatures (approuver/rejeter), config `app_config`, gel/dégel d'établissements.

### API (57 routes sous `src/app/api/`)
`admin/*`, `auth/*` (register, change-password, delete-account, forgot-password), `booking/post-visit-status*`, `bookings/*` (create, create-group, group, availability, cancel, checkin-by-qr, cloturer-prestation, logs, save-member-email, update-member), `chat/send`, `cron/*` (10 tâches dont `check-engagement-notice`), `favorites`, `flash-slots*`, `group/*`, `loyalty/*`, `pro/*` (12 routes dont `export-clients`, `setup-billing`, `staff`), `stripe/*` (checkout, webhook, connect-onboarding, connect-status, transactions).

### Sécurité — correctifs livrés
- Toutes les routes API renvoient des erreurs génériques au client (plus de fuite `error.message` brut), sauf messages métier légitimes préservés volontairement (auth, Stripe card errors) et l'erreur de signature webhook Stripe (utile au debug dashboard).
- IDOR/rôle corrigés : `loyalty/use-joker`, `bookings/cancel`, `loyalty/update-status` (secret serveur-à-serveur), `checkin-by-qr` (rôle + même établissement), `bookings/update-member` (whitelist champs), `stripe/connect-status`.
- Open redirect corrigé (`successUrl` validé contre l'origine de la requête), headers HTTP hardening, anti-tampering montant.
- Établissements gelés exclus dès la recherche.
- **Verrouillage zoom tactile** (`src/app/layout.tsx`, `export const viewport`) — `maximum-scale: 1`, `user-scalable: false`, testé en prod (Playwright + CDP) sur `/`, `/pro`, `/admin`, `/connexion`.
- **Sécurité mineure (audit du 03/07)** : injection de formule CSV neutralisée sur l'export RGPD pro (`api/pro/export-clients`), rôle/nom du chat dérivés côté serveur au lieu du body (`api/chat/send` — empêche l'usurpation client→pro), rate limiting ajouté sur `bookings/create` et `bookings/save-member-email` (20/10min par IP), route `auth/post-signup` supprimée (IDOR sur endpoint mort, aucun appelant dans le repo).
- **Message d'erreur admin clarifié** (`api/admin/applications/route.ts`) : quand l'email d'une candidature pro correspond à un compte déjà existant, l'admin reçoit un 409 explicite ("Cet email a déjà un compte...") au lieu du message générique anti-énumération — la route est déjà protégée par un check `role==='admin'`, donc pas de risque d'énumération à révéler ce cas précis.

### Loi Chatel — préavis de fin d'engagement
Cron `cron/check-engagement-notice` en **dry-run** : détecte quotidiennement les abonnements pro dans la fenêtre de préavis (`ENGAGEMENT_NOTICE_DAYS = 30`, `plans-config.ts:54`) et logge le résultat (console + JSON), **aucun email envoyé**. Testé par fixture temporaire (créée puis supprimée, zéro résidu). Pas encore ajouté à `vercel.json` — ne tourne pas encore automatiquement. Reste à faire une fois le texte légal validé par Pierre : câbler l'envoi email + ajouter un flag anti-répétition (ex. `notice_sent_at` sur `business_settings`) pour ne notifier qu'une fois par pro — TODO explicite déjà présent dans le code.

### Migrations SQL
17 migrations (`0008` à `0024`) : flash slots/favoris, parrainage + RPCs atomiques, onboarding pro, abonnement pro, approbation partenaire, popup post-visite, rate limiting, RLS snapshot, planning staff, assignation staff.

---

## CE QUI RESTE À FAIRE

### Technique / code
- **Chatel — envoi email + anti-répétition** : le cron de détection tourne en dry-run (voir section dédiée plus haut) ; reste à câbler l'envoi réel une fois le texte légal validé par Pierre, plus un flag anti-répétition (`notice_sent_at` ou équivalent) pour ne pas notifier le même pro à chaque exécution quotidienne du cron.
- **Pages mentions légales + CGU self-service** à finaliser.
- **Table `profiles`** — suspectée orpheline en base. Chantier DB séparé, prudence : ne jamais y toucher sans vérifier qu'elle est vide et non référencée (RLS/FK/code).
- **Tests automatisés** — actuellement scripts manuels (`test-complet.mjs`, `verify-booking.mjs`, `verify-local.mjs`, `test-paiement-4242.mjs`), pas de suite automatisée en CI.
- **Flash blanc au chargement de la home** (mineur).
- README.md — pas encore resynchronisé (STATUS.md l'est depuis ce soir).

### Bloquants commerciaux (hors code, utilisateur seul)
1. **URSSAF** — bloque tout le reste.
2. **Bascule Stripe live** — clé `sk_live_` à ne jamais poser sans feu vert explicite, une fois l'URSSAF réglé.
3. **Validation juridique** du préavis loi Chatel (`ENGAGEMENT_NOTICE_DAYS = 30`) avant d'activer l'envoi email réel (détection déjà prête, voir section dédiée).

---

## Variables d'environnement nécessaires

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://suyfsuvrbdpnnijxspge.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...

# Stripe (mode test tant que l'URSSAF n'est pas réglé)
STRIPE_TEST_SECRET_KEY=...
STRIPE_WEBHOOK_SECRET=...

# Email (Resend)
RESEND_API_KEY=...

# App
NEXT_PUBLIC_SITE_URL=https://book-n-pay.com

# Sécurité
CRON_SECRET=...                 ← protège /api/cron/*
INTERNAL_API_SECRET=...         ← protège /api/loyalty/update-status
```

### Piège PowerShell → Vercel
> ⚠️ Ne jamais utiliser `echo "valeur" | vercel env add ...` depuis PowerShell Windows.
> PowerShell ajoute un BOM (`﻿`) au début de la valeur, ce qui corrompt les clés API silencieusement.
> **Utiliser le Bash tool ou `printf 'valeur' | vercel env add ...`** depuis bash/sh.

---

## Git

- **Remote** : `https://github.com/leccepierre5-lab/book-n-pay.git`
- **Branche** : `master`
- **Dernier commit** : `fix(admin): message 409 explicite quand l'email d'une candidature pro existe déjà` (hash à venir, Pierre le verra après commit)
- **Vercel** : projet `book-n-pay-next` (`prj_wV1ntQoNyi0Kl7hP9QLVLEtgvtkv`), prod alias `book-n-pay.com` / `www.book-n-pay.com`. Un projet Vercel doublon nommé `book-n-pay` existe mais est déconnecté du Git — ignorer, ne pas confondre.
- **Garde-fou push** : hook `pre-push` (`scripts/git-hooks/pre-push`, voir README) — bloque tout `git push` sans `ALLOW_PUSH=1`. Claude Code ne committe ni ne pousse jamais lui-même sur ce repo ; c'est Pierre qui tape les deux commandes après avoir vu le diff réel.
