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
`admin/*`, `auth/*` (register, post-signup, change-password, delete-account, forgot-password), `booking/post-visit-status*`, `bookings/*` (create, create-group, group, availability, cancel, checkin-by-qr, cloturer-prestation, logs, save-member-email, update-member), `chat/send`, `cron/*` (9 tâches), `favorites`, `flash-slots*`, `group/*`, `loyalty/*`, `pro/*` (12 routes dont `export-clients`, `setup-billing`, `staff`), `stripe/*` (checkout, webhook, connect-onboarding, connect-status, transactions).

### Sécurité — correctifs livrés
- Toutes les routes API renvoient des erreurs génériques au client (plus de fuite `error.message` brut), sauf messages métier légitimes préservés volontairement (auth, Stripe card errors) et l'erreur de signature webhook Stripe (utile au debug dashboard).
- IDOR/rôle corrigés : `loyalty/use-joker`, `bookings/cancel`, `loyalty/update-status` (secret serveur-à-serveur), `checkin-by-qr` (rôle + même établissement), `bookings/update-member` (whitelist champs), `stripe/connect-status`.
- Open redirect corrigé (`successUrl` validé contre l'origine de la requête), headers HTTP hardening, anti-tampering montant.
- Établissements gelés exclus dès la recherche.
- **Verrouillage zoom tactile** (`src/app/layout.tsx`, `export const viewport`) — `maximum-scale: 1`, `user-scalable: false`, testé en prod (Playwright + CDP) sur `/`, `/pro`, `/admin`, `/connexion`.

### Migrations SQL
17 migrations (`0008` à `0024`) : flash slots/favoris, parrainage + RPCs atomiques, onboarding pro, abonnement pro, approbation partenaire, popup post-visite, rate limiting, RLS snapshot, planning staff, assignation staff.

---

## CE QUI RESTE À FAIRE

### Technique / code
- **Sécurité mineure** : injection de formule CSV dans l'export RGPD pro (`api/pro/export-clients/route.ts`), IDOR mineurs (`api/auth/post-signup/route.ts`, `api/bookings/save-member-email/route.ts`), rôle/nom auto-déclarés dans le chat (`api/chat/send/route.ts`), pas de rate limiting sur `api/bookings/create`.
- **Câbler `ENGAGEMENT_NOTICE_DAYS`** (`src/lib/plans-config.ts:54`, loi Chatel) — la constante et `isInEngagementPeriod()` existent mais ne sont utilisées nulle part dans le flux réel.
- **Pages mentions légales + CGU self-service** à finaliser.
- **Table `profiles`** — suspectée orpheline en base. Chantier DB séparé, prudence : ne jamais y toucher sans vérifier qu'elle est vide et non référencée (RLS/FK/code).
- **Tests automatisés** — actuellement scripts manuels (`test-complet.mjs`, `verify-booking.mjs`, `verify-local.mjs`, `test-paiement-4242.mjs`), pas de suite automatisée en CI.
- **Flash blanc au chargement de la home** (mineur).
- README.md — pas encore resynchronisé (STATUS.md l'est depuis ce soir).

### Bloquants commerciaux (hors code, utilisateur seul)
1. **URSSAF** — bloque tout le reste.
2. **Bascule Stripe live** — clé `sk_live_` à ne jamais poser sans feu vert explicite, une fois l'URSSAF réglé.
3. **Validation juridique** du préavis loi Chatel (`ENGAGEMENT_NOTICE_DAYS = 30`) avant câblage effectif.

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
- **Dernier commit** : `6eebce7 — fix: verrouille le zoom tactile (pinch-to-zoom) sur toute l'app`
- **Vercel** : projet `book-n-pay-next` (`prj_wV1ntQoNyi0Kl7hP9QLVLEtgvtkv`), prod alias `book-n-pay.com` / `www.book-n-pay.com`. Un projet Vercel doublon nommé `book-n-pay` existe mais est déconnecté du Git — ignorer, ne pas confondre.
