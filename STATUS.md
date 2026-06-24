# Book'nPay — État du projet (24 juin 2026)

## Stack

- **Next.js 16.2.9** (App Router) + **TypeScript strict**
- **Supabase** (auth + base de données + RLS)
- **Stripe** (Checkout + Connect + webhooks)
- **Tailwind CSS** (palette navy/mint custom)
- **Resend** (emails transactionnels — clé à configurer)
- **Vercel** (déploiement, crons via vercel.json)

Migration depuis une app **Base44** (no-code). Toute la logique métier a été portée à la main.

---

## CE QUI FONCTIONNE

### Pages publiques
| Route | État | Notes |
|---|---|---|
| `/recherche` | ✅ | Server Component, filtres par catégorie/ville/prix/note, exclut établissements gelés |
| `/etablissement/[slug]` | ✅ | Fiche + BookingFlow (3 étapes) |
| `/connexion` | ✅ | Login Supabase + redirect param |
| `/inscription` | ✅ | Register avec support code parrainage (`?ref=`) |
| `/confirmation` | ✅ | Confirmation post-paiement + lien partage groupe si service multi-places |
| `/mes-reservations` | ✅ | Liste + vue calendrier, statuts, annulation (+ Joker), carte fidélité, parrainage |
| `/mes-reservations/[id]` | ✅ | Détail réservation individuelle |
| `/rejoindre/[bookingId]` | ✅ | Rejoindre une réservation de groupe via lien |
| `/cgu` | ✅ | CGU statiques |
| `/tarifs` | ✅ | Page tarifs |
| `/devenir-partenaire` | ✅ | Formulaire de candidature partenaire |

### Espace pro
| Route | État | Notes |
|---|---|---|
| `/pro` | ✅ | Dashboard : réservations du jour, stats du mois, check-in QR, no-show, caisse, calendrier |
| `/pro/transactions` | ✅ | Historique des transactions Stripe |
| `/pro/reglages` | ✅ | Paramètres du compte pro |

### Espace admin
| Route | État |
|---|---|
| `/admin` | ✅ | Candidatures (approuver/rejeter), config app_config, gel/dégel d'établissements |

### API Routes (26 routes)
- **Booking** : `create`, `availability`, `cancel`, `checkin-by-qr`, `update-member`, `group`, `cloturer-prestation`
- **Stripe** : `checkout`, `webhook`, `connect-onboarding`, `connect-status`, `transactions`
- **Loyalty** : `use-joker`, `update-status`
- **Admin** : `applications`, `freeze-business`
- **Chat** : `send`
- **Pro** : `bookings-month`, `client-stats`, `refund-gesture`
- **Cron** : `check-no-shows`, `send-rdv-reminders`, `cleanup-expired-invites`, `reset-jokers-annuel`, `relance-onboarding-pro`, `verifier-inactivite`

### Sécurité (correctifs appliqués)
- `/api/loyalty/use-joker` — authentification + vérification téléphone + vérification memberId
- `/api/bookings/cancel` — vérification propriétaire/membre/admin avant annulation
- `/api/loyalty/update-status` — protégé par `INTERNAL_API_SECRET` (secret serveur-à-serveur)
- `/api/bookings/checkin-by-qr` — rôle pro/admin exigé
- `/api/bookings/update-member` — whitelist des champs acceptés + vérification rôle
- `/api/stripe/connect-status` — session authentifiée propriétaire ou admin
- Établissements gelés exclus dès la recherche (plus seulement au paiement)

### Logique métier (lib)
- `normalizePhone()` — format E.164 présomption France (`0X` → `+33X`), utilisé à la saisie
- `calcFraisGestion()` — barème progressif (1,99€ / 2,10€ / 2,30€ / 2,50€)
- `calcTrustScore()` — Sérénité Score selon historique absences
- `calcDeposit()` — dépôt majoré si score < 60
- `computeStatut()` — paliers fidélité Standard/Bronze/Argent/Gold
- `isSlotClosed()` — vérification horaires/jours d'ouverture

### SQL migrations
- 7 fichiers `.sql` relus et rendus idempotents
- Backfill `referral_code` pour anciens utilisateurs
- Backfill normalisation téléphone (app_users, booking_members, bookings)
- Contrainte FK `fk_app_users_biz` protégée contre les replays

---

## CE QUI RESTE À FAIRE / RISQUES CONNUS

### Avant toute mise en prod (bloquant)
- [ ] **`npm install && npm run build`** — jamais exécuté dans cet environnement, à lancer et corriger ce qui casse
- [ ] **`RESEND_API_KEY`** manquante dans `.env.example` — sans elle, tous les emails (confirmation, rappels, no-show) passent silencieusement en no-op
- [ ] **`INTERNAL_API_SECRET`** — générer avec `openssl rand -hex 32` et ajouter dans `.env.local` + Vercel ; sans elle, la fidélité (RDV honorés, jokers) ne se met plus à jour après check-in
- [ ] **`CRON_SECRET`** — protège les endpoints `/api/cron/*` contre les appels arbitraires
- [ ] **Fuseau horaire Vercel** — Vercel exécute en UTC par défaut ; tous les calculs d'heure (`48h avant`, `no-show`, rappels) sont construits sans suffixe de fuseau. Fixer `TZ=Europe/Paris` dans les variables d'env Vercel, ou tester en conditions réelles avant la prod

### Fonctionnalités définies mais sans UI
| Fonctionnalité | Type/table existant | UI/API |
|---|---|---|
| Flash slots (offres de dernière minute) | `FlashSlot` dans `database.types.ts` | ❌ aucun |
| Favoris | `Favorite` dans `database.types.ts` | ❌ aucun |
| Logs de réservation | `BookingLog` + API `booking_logs` insère des logs | ❌ pas de UI pro pour les consulter |
| Avis Google (sync) | `BusinessReview` table + `google_place_id` sur Business | ❌ pas d'endpoint de sync — note affichée si déjà en base |

### Observations (pas des bugs, mais à savoir)
- `bookings.status = 'completed'` — jamais assigné nulle part (comportement hérité de Base44) ; une réservation honorée reste `active` au niveau du booking, seul le membre passe à `arrived`
- Normalisation téléphone — présume des numéros français. Si extension internationale, migrer vers `libphonenumber-js`
- Le barème des frais de gestion est dupliqué : `calcFraisGestion()` en TS (fallback) + `app_config` en base (source de vérité). Les deux doivent rester synchronisés

---

## Variables d'environnement nécessaires

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://suyfsuvrbdpnnijxspge.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...

# Stripe
STRIPE_SECRET_KEY=...
STRIPE_TEST_SECRET_KEY=...
STRIPE_WEBHOOK_SECRET=...

# Email (Resend)
RESEND_API_KEY=...              ← MANQUANT dans .env.example

# App
NEXT_PUBLIC_SITE_URL=https://book-n-pay.com

# Sécurité
CRON_SECRET=...                 ← protège /api/cron/*
INTERNAL_API_SECRET=...         ← protège /api/loyalty/update-status
```

---

## Git

- **Remote** : `https://github.com/leccepierre5-lab/book-n-pay.git`
- **Branche** : `master`
- **Dernier commit** : `9d6a29e — upgrade Next.js 16.2.9 (CVE-2025-66478)`
