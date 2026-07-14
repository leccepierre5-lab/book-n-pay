# Rapport d'audit — Bloc 1 (preuves d'exécution)

Exécuté le 2026-07-14 contre la production (`https://www.book-n-pay.com`,
projet Supabase `suyfsuvrbdpnnijxspge`). Scripts dans ce dossier, lecture
seule pour `rls-check.mjs` et `webhook-signature-check.mjs` ; `rate-limit-check.mjs`
envoie des requêtes réelles mais avec des payloads conçus pour ne produire
aucun effet de bord (voir commentaires en tête de fichier).

## 1. RLS Supabase (`rls-check.mjs`)

22 tables testées avec la clé anon publique. **0 trou détecté** — toutes les
tables sensibles (`app_users`, `bookings`, `booking_members`,
`business_settings`, `chat_messages`, `favorites`, `partner_applications`,
`rate_limits`, `overage_charges`, `referral_events`) renvoient 0 ligne à un
visiteur anonyme. Les tables publiques par design (`businesses`, `services`,
`staff`, `app_config`, `business_reviews`, `staff_schedules`, `staff_absences`)
renvoient leurs données — attendu, c'est le catalogue public du site.

**Bug trouvé (pas une fuite)** : `profiles` renvoie une erreur Postgres 500
— récursion infinie dans la policy `profiles_select_own_or_admin` (sous-select
sur `profiles` depuis une policy de `profiles`). Échoue fermé, aucune donnée
exposée. Table déjà identifiée comme reliquat mort dans `SECURITY_TODO.md`
(absente de `database.types.ts`) — argument de plus pour la supprimer plutôt
que la réparer.

## 2. Rate limiting (`rate-limit-check.mjs`)

| Endpoint | Limite documentée | Résultat |
|---|---|---|
| `register` | 5/15min IP | ✅ prouvé — 429 à la requête #6 |
| `bookings/group` (addMemberAndGetCheckout) | 10/10min IP | ✅ prouvé — 429 à la requête #11 |
| `stripe/checkout` | 30/10min IP | ✅ prouvé — 429 exactement à la 30ᵉ requête cumulée (deux passages de test consécutifs) |
| `forgot-password` | 5/15min IP + 3/15min email | ⚠️ **NON PROUVÉ par ce protocole.** La route renvoie toujours `200 {ok:true}`, y compris quand la limite est atteinte — comportement **volontaire** (anti-énumération, explicite dans le code source), pas un bug. Un `429` n'apparaîtra jamais sur cette route par conception : ce script ne peut donc pas confirmer que le compteur incrémente réellement. **À revérifier manuellement** (ex. lire les logs serveur, ou compter les emails Resend réellement envoyés lors d'un test contrôlé). |
| `checkin-by-qr` | 30/5min compte pro | ⚠️ **NON PROUVÉ par ce protocole.** La route exige une session pro authentifiée (401 avant le rate limiter) ; ce script n'a pas de session pro disponible. **À revérifier manuellement**, connecté en pro (boucle de scans QR depuis la console devtools, ou fournir un token de session de test à un script dédié). |

## 3. Signature webhook Stripe (`webhook-signature-check.mjs`)

- Sans header `stripe-signature` → `400` ✅
- Header présent mais invalide → `400` ✅

Les deux cas sont rejetés avant tout accès à la base (vérifié dans
`src/app/api/stripe/webhook/route.ts` : `constructEventAsync` échoue avant le
premier appel Supabase).

## Ce que ce rapport ne couvre PAS

- `forgot-password` et `checkin-by-qr` : voir ci-dessus, non prouvés par
  l'automatisation, à tester manuellement.
- Aucun test d'intrusion actif au-delà de ce qui est listé ici (pas de scan de
  vulnérabilités, pas de brute-force réel, pas de tentative d'écriture).
