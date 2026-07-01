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

## 2. IDOR bookings/group

`src/app/api/bookings/group/route.ts` — route multi-actions volontairement
publique (rejoindre un groupe sans compte). Les actions `getBooking` et
`getBookingsByGroupRef` renvoient la réservation complète (membres, téléphones,
dépôts) à quiconque connaît un `bookingId` ou `groupRef` — aucune vérification
de session, l'UUID est le seul contrôle d'accès.

**Risque** : un `bookingId`/`groupRef` qui fuite (lien partagé, log, capture
d'écran) expose les données personnelles de tous les participants du groupe,
sans limite de tentatives (voir aussi #3).

**Piste** : accepter le risque documenté si le produit exige un accès sans
compte (cas d'usage réel), mais a minima logger les accès et envisager un
token à durée de vie courte plutôt que le `groupRef`/`bookingId` brut pour les
actions en lecture large.

## 3. Rate limiting absent

Aucune librairie ni middleware de rate limiting dans `src/` (vérifié par
recherche globale). Concerne en particulier :
- `src/app/api/bookings/checkin-by-qr/route.ts` — `qr_code` généré par
  `generateQrCode()` (`src/lib/booking-utils.ts`) : **6 chiffres aléatoires
  seulement** (1 000 000 combinaisons), pas un UUID malgré le commentaire du
  fichier qui l'affirme à tort. Brute-forçable sans limite de tentatives.
- Routes d'auth (`/api/auth/register`, `/api/auth/forgot-password`) et
  `/api/bookings/group` (`addMemberAndGetCheckout`, sensible aux abus de
  création de membres invités).

**Piste** : middleware Next.js avec un compteur Redis/Upstash (ou table
Supabase dédiée) sur IP + endpoint sensible ; commencer par `checkin-by-qr`
et les routes d'auth.

## 4. Gel établissement sans remboursement

`src/app/api/admin/freeze-business/route.ts`, action `freeze` (lignes 54-67) :
annule tous les booking_members `paid`/`arrived` des réservations futures,
mais **n'appelle jamais `stripe.refunds.create()`**. Contraste avec
`src/lib/group/expireGroup.ts` qui rembourse systématiquement les membres
payés lors de l'expiration d'un groupe.

**Risque** : un client dont l'établissement est gelé par un admin perd les
frais de réservation déjà payés, sans remboursement automatique ni notification
explicite du non-remboursement.

**Piste** : reprendre la boucle de remboursement de `expireGroup.ts`
(`stripe.refunds.create` par `stripe_payment_intent_id` + email dédié) dans
la branche `freeze`.

## 5. XSS / injection HTML dans les emails

`src/app/api/bookings/cloturer-prestation/route.ts` lignes 80-92 : le corps
HTML de l'email interpole directement `member.name`, `booking.biz_name`,
`booking.service_name` sans échappement — `member.name` est saisi librement
par le client à la réservation. Même famille de risque probable partout où
`emailTemplate()` est utilisé avec du contenu utilisateur non échappé
(`src/app/api/admin/applications/route.ts`, `src/app/api/cron/verifier-inactivite/route.ts`).

**Risque** : injection de balises (liens de phishing, images de tracking,
casse de mise en page) dans un email envoyé par Book'nPay — pas d'exécution
de `<script>` dans la plupart des clients mail, mais surface d'abus réelle.

**Piste** : échapper (`<`, `>`, `&`, `"`) toute valeur utilisateur avant
interpolation dans un template HTML, ou passer par une fonction `escapeHtml()`
centralisée dans `src/lib/email/send.ts`.

## 6. Comparaison non constant-time (secret loyalty/cron)

`src/app/api/loyalty/update-status/route.ts` ligne 24 :
```ts
if (authHeader !== `Bearer ${process.env.INTERNAL_API_SECRET}`) {
```
Comparaison de chaîne classique (`!==`), pas `crypto.timingSafeEqual`. Même
motif répété sur `CRON_SECRET` dans toutes les routes `src/app/api/cron/*`
(ex. `reset-jokers-annuel`, `retry-overage-charges`).

**Risque** : timing attack théorique pour reconstituer le secret
caractère par caractère — difficile à exploiter en pratique sur un réseau
bruité, mais c'est le type de comparaison que `crypto.timingSafeEqual`
existe précisément pour éviter, et le coût du correctif est nul.

**Piste** : petit helper `constantTimeEqual(a, b)` (buffers de même longueur
+ `crypto.timingSafeEqual`, avec un padding/`false` immédiat si les longueurs
diffèrent) réutilisé partout où un secret bearer est comparé.
