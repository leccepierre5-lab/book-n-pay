# Inventaire migrations vs base réelle — 13/08/2026

Vérifié avec l'accès service role de cet environnement (mêmes appels que
le code réel, `.select().limit(1)`, pas de raccourci `head:true` — un
premier essai avec `head:true` a produit un **faux négatif** : 204 sans
erreur sur une table absente. Corrigé avant de produire cet inventaire.

## 1. Tables — 25 vérifiées

**Absentes (2) :**
- `pro_charges` — migration 0041 jamais exécutée. **C'est l'incident.**
- `profiles` — legacy connu (déjà documenté dans `0022_rls_snapshot.sql`
  comme "probable reliquat", jamais lu/écrit par le code actuel). Sans
  rapport avec l'incident, pas un problème.

**Présentes (23) :** app_config, app_users, booking_logs, booking_members,
bookings, business_photos, business_review_items, business_reviews,
business_settings, businesses, chat_messages, favorites, flash_slots,
overage_charges, partner_applications, rate_limits, referral_events,
services, staff, staff_schedules, staff_absences, business_locations,
business_deletion_log.

## 2. Colonnes ajoutées par `ALTER TABLE ... ADD COLUMN` — 34 vérifiées sur 8 tables

Toutes les colonnes ajoutées par une migration depuis l'origine du dossier
(hors `pro_charges`, déjà absente au niveau table) :

| Table | Colonnes vérifiées | Résultat |
|---|---|---|
| `app_users` | cgu_accepted_at, cgu_version | ✅ toutes présentes |
| `booking_members` | is_demo, paid_by_member_id, paid_for_at, post_visit_popup_shown, retraction_consent_at, retraction_consent_version | ✅ toutes présentes |
| `bookings` | is_demo, organizer_token, overage_processed_at | ✅ toutes présentes |
| `business_settings` | bookings_count_reset_at, engagement_end_date, monthly_bookings_count, next_billing_date, payment_method_type, plan_key, stripe_customer_id, stripe_payment_method_id, stripe_subscription_id, subscription_start_date, subscription_status | ✅ toutes présentes |
| `businesses` | facebook_url, is_published, service_area_radius_km | ✅ toutes présentes |
| `partner_applications` | approved_at, category, category_label, cgu_accepted_at, cgu_version, monthly_bookings_estimate, practitioners_count, type | ✅ toutes présentes |
| `services` | allow_group | ✅ présente |
| `staff` | deactivated_at, is_active | ✅ toutes présentes |

**Zéro colonne manquante.** L'incident est isolé à `pro_charges` (0041) —
ni un autre trou de table, ni une colonne manquante ailleurs.

## 3. Chronologie — le "comment", pas juste "un oubli"

- **11/08** (`c1b09bc`) — migration 0041 (`pro_charges`) créée et poussée.
- **12/08** — règle "jamais de push avant confirmation d'exécution"
  instituée (mémoire `feedback_bnp_migration_before_push.md`), **le
  lendemain** de 0041.
- Depuis le 12/08 : chaque migration confirmée exécutée par Pierre avant
  push — et cet inventaire le prouve (zéro colonne manquante sur tout ce
  qui a suivi 0041).
- **13/08 (aujourd'hui)** — 0050 tente `ALTER TABLE pro_charges` → échoue
  bruyamment (`42P01`) → révèle que 0041 n'a jamais tourné, restée
  invisible 2 jours parce qu'elle échoue silencieusement (voir §4).

0041 est passée entre les mailles **avant** que la règle qui l'aurait
empêchée n'existe. Depuis, la règle a fonctionné à 100% (0042 à 0050,
tout confirmé, tout présent).

## 4. Fonctionnalités en prod qui dépendent de `pro_charges` — comportement réel vérifié

**`pro/cancel-booking/route.ts` (annulation par le pro) — SÛRE.**
Remboursement client + libération du créneau se font AVANT la tentative
d'insertion `pro_charges`, dans un bloc totalement indépendant. L'insert
échoue, capturé par un `try/catch` dédié qui écrit dans `booking_logs`
(table présente) et appelle `notifyAdminOnFailure` (email admin). Aucune
annulation cassée aujourd'hui — seule la refacturation manque, et une
alerte a dû partir à chaque occurrence si `ADMIN_EMAIL` est configuré.

**`src/lib/stripe/pro-charge-billing.ts` (webhook Stripe) — SÛRE mais
silencieuse.** `reconcileProChargesFromInvoice` et
`invoicePendingChargesOnCancellation` font `const { data } = await
supabase.from('pro_charges')...` puis `if (!data) return;` — une table
absente renvoie `{data: null, error}` (pas une exception), donc la
fonction s'arrête proprement. Le webhook Stripe ne casse jamais, la mise
à jour de `subscription_status` (même handler) n'est jamais affectée.
Mais aucune alerte n'est levée dans ce cas précis — silencieux, à
corriger.

**`pro/delete-account/route.ts` (garde-fou suppression de compte) — VRAI
BUG TROUVÉ, distinct de l'incident initial.** Le code fait `count` sur
`pro_charges` sans capturer l'erreur : table absente → `count` vaut
`null` → `(count ?? 0) > 0` devient `false` → **le garde-fou serait
silencieusement contourné**, laissant croire à zéro charge en attente au
lieu de remonter l'erreur. Sans conséquence aujourd'hui (zéro vrai pro,
personne n'a utilisé cette route), mais même défaut de méthode : une
erreur transformée en "zéro" plutôt que remontée. À corriger avec la
migration.

**`ProDashboard.tsx` / `getProStats` (affichage dashboard pro) — SÛRE.**
Même pattern silencieux que le webhook : table absente → liste vide →
dashboard affiche 0€/aucun historique au lieu de planter. Pas grave en
soi (affichage), mais même famille de silence.

## Conclusion

Un seul incident réel : migration 0041 jamais exécutée, découverte
aujourd'hui via l'échec de 0050. Aucune autre migration ni colonne
manquante. Deux corrections à apporter en plus de rejouer 0041 :
1. Garde-fou suppression de compte : capturer l'erreur sur `pro_charges`
   au lieu de la traiter comme "zéro".
2. `pro-charge-billing.ts` : alerter l'admin si `pro_charges` est
   inatteignable, au lieu de s'arrêter en silence.
