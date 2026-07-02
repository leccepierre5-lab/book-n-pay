# Security TODO — Book'nPay

Points relevés lors de l'audit de sécurité du 01/07/2026 (fork dédié), non
traités depuis. Chaque section donne la localisation exacte trouvée en
vérifiant le code actuel, le risque, et une piste de correctif.

## 1. RLS non versionnée (Critique)

Seules 2 tables ont leurs policies RLS suivies dans `supabase/migrations/` :
`business_photos` (`0012_social_photos_payments.sql`) et `staff_schedules`
(`0014_onboarding_pro.sql`). Toutes les autres tables (`bookings`,
`booking_members`, `business_settings`, `app_users`, `businesses`,
`overage_charges`, etc.) ont leurs policies — si elles existent — configurées
uniquement via le Dashboard Supabase, donc absentes de git.

**Risque** : impossible de reproduire l'état RLS depuis un environnement
vierge, de le revoir en code review, ou de revenir en arrière après une
modification manuelle (voir l'incident du 30/06 : récursion infinie sur
`is_admin()`, corrigée en prod sans trace versionnée).

**Piste** : `supabase db pull --schema public` (ou export manuel via le
Dashboard → Database → Roles/Policies) pour générer une migration de
rattrapage capturant l'état actuel, puis versionner toute modification future.

**Bloqué côté agent (02/07/2026)** : pas de CLI Supabase liée, pas de
`DATABASE_URL` dans `.env.local`, et l'API REST n'expose pas `pg_policies`
(catalogue système hors du schéma `public`). Impossible d'introspecter l'état
RLS actuel depuis cet environnement sans risquer de le deviner et de casser
une policy en prod. Requête à faire tourner dans le SQL Editor Supabase et à
transmettre pour générer la migration de rattrapage :
```sql
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename, policyname;

SELECT relname, relrowsecurity, relforcerowsecurity
FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'
ORDER BY relname;
```

## 2. IDOR bookings/group — ✅ corrigé le 02/07/2026 (commit `357d678`)

`src/app/api/bookings/group/route.ts` — route multi-actions volontairement
publique (rejoindre un groupe sans compte). `getBooking` et
`addMemberAndGetCheckout` renvoyaient la ligne complète (téléphone, email,
`qr_code` de check-in, IDs Stripe) à quiconque connaît un `bookingId` — aucune
vérification de session, l'UUID était le seul contrôle d'accès.
`getBookingsByGroupRef` renvoyait en plus toutes les réservations d'un groupe
via `groupRef` seul, sans être appelée par aucun code front.

**Risque accepté et non éliminé** : un `bookingId` qui fuite (lien partagé,
log, capture d'écran) permet toujours de voir les noms et statuts des
participants du groupe — c'est le cas d'usage produit (rejoindre sans compte).
Ce qui a été supprimé, c'est la fuite des champs sensibles non affichés
(téléphone, email, `qr_code`, IDs Stripe, coordonnées de l'organisateur) et
l'action `getBookingsByGroupRef` (dead code, aucun bénéfice produit).

**Correctif appliqué** : `getBooking` ne sélectionne plus que
`id, biz_name, service_name, date, time, status, services(...), booking_members(id, name, status, invite_expiry)`.
`addMemberAndGetCheckout` ne renvoie plus la ligne membre brute dans
`alreadyJoined`. `getBookingsByGroupRef` supprimée entièrement.

**Reste à envisager si besoin futur** : logger les accès, token à durée de vie
courte plutôt que le `bookingId` brut pour un contrôle d'accès plus strict.

## 3. Rate limiting absent — ✅ corrigé le 02/07/2026 (commit `b4b577b`)

Table `rate_limits` + fonction atomique `check_rate_limit()` (migration 0021,
exécutée en prod), helper `src/lib/rate-limit.ts` fail-open. Câblé sur
`register` (5/15min IP), `forgot-password` (5/15min IP + 3/15min email),
`checkin-by-qr` (30/5min par compte pro — le `qr_code` reste 6 chiffres,
non changé, seul le rythme d'essais est limité), `stripe/checkout`
(30/10min IP), `bookings/group` `addMemberAndGetCheckout` (10/10min IP).

## 4. Gel établissement sans remboursement — ✅ corrigé le 02/07/2026 (commit `67cfb8f`)

`src/app/api/admin/freeze-business/route.ts`, action `freeze` : reprend la
boucle de remboursement de `expireGroup.ts` (`stripe.refunds.create` par
`stripe_payment_intent_id`, `montant_rembourse` mis à jour, email dédié).
Fallback en simple annulation (sans remboursement Stripe) si le membre a payé
en espèces/TPE et n'a donc pas de `stripe_payment_intent_id`.

## 5. XSS / injection HTML dans les emails — ✅ corrigé le 02/07/2026 (commit `67cfb8f`)

`escapeHtml()` ajouté dans `src/lib/email/send.ts`, appliqué sur toutes les
valeurs utilisateur interpolées dans un template HTML : `member.name` /
`booking.biz_name` / `booking.service_name` (cloturer-prestation),
`firstName` (register), `firstName` / `app.etablissement` (admin/applications),
`prenom` (cron/verifier-inactivite).

## 6. Comparaison non constant-time (secret loyalty/cron) — ✅ corrigé le 02/07/2026 (commit `67cfb8f`)

`isValidBearerSecret()` ajouté dans `src/lib/constant-time.ts`
(`crypto.timingSafeEqual`), remplace les 9 comparaisons `!==` classiques :
les 8 routes `src/app/api/cron/*` (`CRON_SECRET`) + `loyalty/update-status`
(`INTERNAL_API_SECRET`).
