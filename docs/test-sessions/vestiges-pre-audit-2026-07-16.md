# Nettoyage des vestiges pré-existants — avant audit fonctionnel du 16/07/2026

Distinct du nettoyage de fin d'audit (`audit-2026-07-16.md`, cible les données
créées PENDANT l'audit). Ici : des résidus de tests antérieurs (08/07,
chantier CAS 2 / anti-surbooking), identifiés comme polluants pour les
parcours pro/client de l'audit et à supprimer AVANT de commencer.

## Reconnaissance (lecture seule, exécutée le 16/07 via script)

Scripts utilisés (nouveaux, lecture seule, service_role, dans
`scripts/audit/`) : `vestiges-recon.mjs` (identification) et
`vestiges-refs.mjs` (comptage des références dans toutes les tables
candidates, pour vérifier l'ordre enfants→parents).

### Comptes `@test.local`

| id | email | app_users.role | biz_id | created_at |
|---|---|---|---|---|
| `7618472c-24e2-4236-ba61-06dec61b859a` | test-debug-org-mrcjyx2f@test.local | client | – | 2026-07-08 |
| `3690923b-6d93-419b-8fec-d346a19ab0e0` | test-debug-pro-mrcjyx2f@test.local | client | – | 2026-07-08 |
| `b31d794f-3eb1-4539-af6a-601bd1b1bd1c` | test-debug-org-mrcjyhjj@test.local | client | – | 2026-07-08 |
| `972afab2-333b-4f24-b847-b00cf8eac04a` | test-debug-pro-mrcjyhjj@test.local | client | – | 2026-07-08 |

Note : les 4 comptes ont `app_users.role = 'client'` malgré le nommage
"pro"/"org" — le statut pro réel vient de la possession d'un business
(`businesses.owner_id`), pas de ce champ.

### Businesses "Debug %"

| id | name | owner_id |
|---|---|---|
| `17f56f95-5388-450b-aa44-2b5fc85f5c97` | Debug mrcjyhjj | `972afab2-…` (test-debug-pro-mrcjyhjj) |
| `a98731eb-f3dc-4907-8395-567fd923fdd2` | Debug mrcjyx2f | `3690923b-…` (test-debug-pro-mrcjyx2f) |

### Comptage des références (toutes tables candidates, par `biz_id`/`user_id`)

`staff`, `staff_schedules`, `staff_absences`, `business_photos`,
`business_settings`, `business_reviews`, `business_review_items`,
`services`, `flash_slots`, `overage_charges`, `bookings` (par `biz_id` et
par `client_id`), `favorites` → **0 partout**.

**Conclusion : les 2 businesses et les 4 comptes sont totalement orphelins.**
Aucune donnée enfant à nettoyer avant eux — le nettoyage se limite à
supprimer directement `businesses` puis `app_users` puis `auth.users`.

## Script de suppression (ciblé par ID exact, pas par pattern — plus sûr ici
puisque les IDs sont connus et fixes)

```sql
-- ══════════════════════════════════════════════════════════════════
-- Nettoyage vestiges pré-audit — 2 businesses "Debug %" + 4 comptes
-- @test.local (08/07/2026). Confirmé orphelins par recon le 16/07.
-- ══════════════════════════════════════════════════════════════════

-- 1. Businesses
DELETE FROM businesses
WHERE id IN (
  '17f56f95-5388-450b-aa44-2b5fc85f5c97',
  'a98731eb-f3dc-4907-8395-567fd923fdd2'
);

-- 2. app_users (avant auth.users)
DELETE FROM app_users
WHERE id IN (
  '7618472c-24e2-4236-ba61-06dec61b859a',
  '3690923b-6d93-419b-8fec-d346a19ab0e0',
  'b31d794f-3eb1-4539-af6a-601bd1b1bd1c',
  '972afab2-333b-4f24-b847-b00cf8eac04a'
);

-- 3. auth.users : PAS de DELETE SQL brut (satellites identities/sessions/
-- refresh_tokens gérés par Supabase). Via Dashboard (Authentication > Users
-- > filtrer "test.local" > supprimer) ou Admin API
-- (supabase.auth.admin.deleteUser), même doctrine que le nettoyage de fin
-- d'audit.
```

## Statut

Recon faite, script rédigé. **Pas encore exécuté** — en attente du feu vert
de Pierre avant le DELETE `businesses`/`app_users` (SQL Editor) et la
suppression des 4 comptes `auth.users` (Dashboard ou Admin API).
