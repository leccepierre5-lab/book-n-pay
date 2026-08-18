# Plan — normalisation des numéros de téléphone

Rédigé le 18/08/2026, en réponse au bug trouvé en testant réellement la collision téléphone à l'inscription (voir `CLAUDE.md`, section "Invariants moteur — réservations" et l'historique `phonesMatch()`/migration 0056). **Aucun code, aucune migration exécutée pour ce chantier — ce document est un plan, pas une implémentation.** Pierre tranche, puis exécution dans une session séparée avec parcours navigateur complet (règle CLAUDE.md sur les autorisations).

## ⚠️ Constat préalable qui change la donne

La décision du 18/08 de conserver `UNIQUE(app_users.phone)` supposait cette contrainte active. **Ce n'est probablement pas le cas aujourd'hui.** Preuve trouvée en lecture (service_role) : trois lignes `app_users` distinctes partagent actuellement le même numéro littéral `0600000000` (`Test BnP` créé 28/06, `Test ICS Pierre` ×2 créés 14/08). Une contrainte `UNIQUE` active rendrait cet état impossible, quel que soit le chemin d'écriture (RLS ne protège pas contre les contraintes de table, `service_role` non plus). Aucune migration versionnée (`supabase/migrations/`) ne crée ni ne supprime de contrainte `UNIQUE` sur `phone` — l'affirmation du commentaire dans `register/route.ts` ("héritée du schéma d'origine") n'a jamais été reconfirmée depuis l'audit du 15/08.

**Vérification demandée à Pierre avant toute décision** (lecture seule, SQL Editor Supabase — exactement la requête déjà présente en fin de migration 0056) :
```sql
select conname, pg_get_constraintdef(oid) from pg_constraint where conname like '%phone%';
```
Si elle ne retourne rien pour `app_users`, la contrainte n'existe pas : "conserver UNIQUE(phone)" devient "ajouter UNIQUE(phone)", ce qui change le chantier (il faut d'abord traiter les doublons existants, pas seulement les futurs).

## 1. Inventaire — toutes les colonnes téléphone

Comptage exact au 18/08/2026 (lecture service_role) :

| Table.colonne | Total non-null | Format brut `0X` | Format `+33X` | Autre/invalide |
|---|---|---|---|---|
| `app_users.phone` | 7 | 6 (dont 3 doublons `0600000000`, comptes de test) | 0 | 0 |
| `businesses.phone` | 2 | 2 | 0 | 0 |
| `booking_members.phone` | 14 | 12 | 2 | 0 |
| `bookings.client_phone` | 15 | 12 | 2 | 1 (`"okokokok"`, jamais nettoyé par la 0056 — colonne hors périmètre de cette migration) |
| `partner_applications.phone` | 9 | 6 valides + 3 malformés (`06515151515` 11 chiffres, `065956464` 9 chiffres, `484845` 6 chiffres) | 0 | 3 |

Aucun numéro DOM-TOM (`+590/594/596/262/269`) présent actuellement dans aucune table — cas théorique, pas vécu.

**Deux vrais clients récurrents identifiés** (par le numéro, présent en double format) : `659238538` et `695165441` — chacun a au moins une réservation en format brut ET une en format normalisé. C'est la preuve concrète, pas hypothétique, que ces deux clients peuvent déjà être affectés par les points 2 et 3 ci-dessous.

`partner_applications.phone` : formulaire de candidature, jamais utilisé pour de l'autorisation — cosmétique pour l'admin, hors périmètre prioritaire de ce chantier (mentionné pour l'inventaire complet demandé, pas pour action immédiate).

## 2. Tous les points de comparaison

| Emplacement | Compare | Normalise ? |
|---|---|---|
| `src/app/api/auth/register/route.ts` (pré-check collision) | input normalisé vs `app_users.phone` stocké | **Non** — seul l'input est normalisé |
| `src/app/api/bookings/group/route.ts` (`existingByPhone`, "déjà rejoint") | `memberData.phone` normalisé vs `booking_members.phone` stocké | **Non** |
| `src/app/api/bookings/group/route.ts` (garde "établissement ne peut pas rejoindre sa réservation") | `memberData.phone` normalisé vs `businesses.phone` stocké | **Non** (mais aucun impact constaté, les 2 numéros business actuels sont bruts) |
| `src/app/api/loyalty/use-joker/route.ts` (lignes 51, 67) — **porte d'autorisation** | `phone` (body, brut) vs `callerProfile.phone` et `targetMember.phone` | **Non**, aucun côté |
| `src/app/api/loyalty/update-status/route.ts` | `memberPhone` (transmis brut depuis `booking_members.phone` par `update-member/route.ts`) vs `app_users.phone` | **Non**, aucun côté |
| `src/app/api/pro/client-stats/route.ts` (×2) | `phone` (query param) vs `booking_members.phone` et `app_users.phone` | **Non** |
| `src/app/api/cron/reset-jokers-annuel/route.ts` | `user.phone` vs `booking_members.phone` | **Non** |
| `src/lib/booking-utils.ts::resolveMemberRecipientEmail` (rappels J-1/J-2, clôture) | `member.phone` vs `booking.client_phone` | **Non** |
| `src/lib/booking-utils.ts::phonesMatch()` (bookings/cancel, post-visit-status/ack) | les deux arguments | **Oui**, déjà sûr — normalise les deux côtés en interne |
| `src/app/api/pro/export-clients/route.ts` | `booking_members.phone` vs `bookings.client_phone` | **Oui**, déjà sûr — normalise les deux côtés avant de comparer, sert de référence pour le pattern correct |
| **RLS `bookings_select`** (migration 0022) : `bm.phone = u.phone` | booking_members vs app_users | **Non, structurellement impossible** — comparaison SQL brute, ne peut pas appeler `normalizePhone()` |
| **RLS `chat_messages_insert`/`chat_messages_select`** : même comparaison | booking_members vs app_users | **Non**, même raison |
| **RLS `booking_members_select`** : `check_booking_access(booking_id, phone)` | inconnu | **⚠️ Inconnu — fonction non versionnée**, voir ci-dessous |

**Angle mort à combler avant de trancher** : `is_admin()`, `owns_biz()` et surtout `check_booking_access()` sont créées manuellement en base, jamais versionnées (rappelé explicitement dans le commentaire de tête de la migration 0022). Demande à faire à Pierre, SQL Editor, lecture seule :
```sql
select pg_get_functiondef('public.check_booking_access(uuid, text)'::regprocedure);
```
Si cette fonction compare aussi des téléphones bruts, c'est un point de comparaison supplémentaire à traiter, potentiellement plus large que les 3 policies déjà identifiées.

**Conclusion du point 2** : les deux seuls endroits déjà sûrs (`phonesMatch()`, `export-clients`) normalisent les DEUX côtés avant de comparer — c'est le pattern à généraliser. Tout le reste compare au moins un côté brut. Les policies RLS sont le point le plus contraignant : une policy SQL ne peut pas appeler la fonction JS `normalizePhone()`, donc la seule façon de les rendre fiables est de garantir que les DONNÉES stockées sont déjà normalisées — pas de fix côté requête possible.

## 3. Atomicité — ce qui casse entre deux étapes

Si l'on normalise `app_users` puis `booking_members` (ou l'inverse) en deux migrations séparées, la fenêtre entre les deux est exactement l'état déjà observé aujourd'hui pour les 2 clients réels identifiés au point 1 — RLS `bookings_select`/`chat_messages_*` échoue pour toute ligne dont les deux côtés ne sont pas encore alignés, dans les deux sens (accès refusé), jamais dans le sens d'un accès élargi (pas de risque d'exposer les données de quelqu'un d'autre par cette voie précise, la comparaison reste une égalité stricte).

**Recommandation : un seul script SQL, une seule transaction implicite.** PostgreSQL isole les transactions en `READ COMMITTED` par défaut : tant que le script n'a pas fait `COMMIT`, aucune autre requête ne voit un état partiel — soit tout avant, soit tout après. Les 5 `UPDATE` (les 3 tables du point 1 + éventuellement `bookings.client_phone`) doivent être dans le même fichier de migration, sans `COMMIT` intermédiaire explicite. Volume trivial (7+2+14+15 lignes) : aucun risque de verrou long. Ordre entre les tables n'a alors plus d'importance — elles deviennent visibles ensemble.

## 4. Cas limites

- **Numéros déjà identiques avant toute normalisation** : les 3 lignes `app_users` à `0600000000` (comptes de test, pas de vrais clients — voir constat préalable). La normalisation ne les fait pas "devenir" en collision, elles le sont déjà. **Ne bloque pas le backfill de formatage**, mais bloque l'ajout (ou la vérification) d'une contrainte `UNIQUE` réelle tant qu'elles existent — à nettoyer séparément (suppression des 2 comptes de test résiduels, `Test BnP` et un des deux `Test ICS Pierre`) avant/en même temps que toute décision sur la contrainte.
- **Numéros qui deviennent identiques SEULEMENT après normalisation** : aucun cas trouvé dans les données actuelles — `app_users` n'a aujourd'hui aucune ligne déjà en `+33X` (hors compte de test supprimé), donc aucun risque de collision nouvellement révélée sur cette table par le simple reformatage.
- **Numéros invalides déjà en base** : `bookings.client_phone` contient encore `"okokokok"` (booking `d31c7a7b-...`) — colonne jamais touchée par la 0056, sans contrainte de format. Décision à prendre : le mettre à `null` (même traitement que la 0056 sur les 3 autres tables) ou le laisser (c'est une donnée historique d'un booking déjà clos, sans effet fonctionnel connu).
- **Numéros étrangers/DOM-TOM** : aucun présent actuellement — `normalizePhone()` laisse inchangé tout ce qui commence déjà par `+`, donc sans effet sur ce cas s'il apparaît plus tard.
- **`partner_applications.phone`** : 3 valeurs malformées (11/9/6 chiffres) — champ de contact d'une candidature, jamais comparé nulle part dans le code. Hors périmètre de cette migration (qui porte sur les tables d'autorisation), à traiter séparément si souhaité — juste signalé pour l'inventaire complet demandé.

## 5. Point d'entrée — écritures futures

Chemins qui écrivent `phone` aujourd'hui, vérifiés un par un :

| Chemin | Normalise avant écriture ? |
|---|---|
| `api/auth/register` | ✅ Oui |
| `api/bookings/create`, `api/bookings/create-group` (upsert `app_users` + insert booking) | ✅ Oui |
| `api/bookings/group` (insert `booking_members`) | ✅ Oui |
| **Trigger `handle_new_user`** (migration 0010, `AFTER INSERT ON auth.users`) | **❌ Non** — insère `raw_user_meta_data->>'phone'` tel quel, aucun appel à une fonction de normalisation côté SQL |
| `scripts/audit/create-fixture-client.mjs` (créé aujourd'hui) | ❌ Non — passe `'0699999999'` brut en métadonnée, qui traverse le trigger ci-dessus sans transformation. **Confirme en conditions réelles que le trigger est bien un point d'entrée non protégé : je viens moi-même d'ajouter une 8e ligne dans le mauvais format sans m'en rendre compte avant cet audit.** |

**Recommandation** : ne pas se fier uniquement à la discipline "chaque appelant JS pense à normaliser" — le trigger `handle_new_user` le prouve, c'est already contourné une fois par accident aujourd'hui. Ajouter la normalisation **au niveau base** (fonction SQL équivalente à `normalizePhone()`, appelée par un trigger `BEFORE INSERT OR UPDATE` sur les 3 tables, ou directement dans `handle_new_user`) rendrait impossible toute réintroduction future, quel que soit le chemin d'écriture — y compris un script, une migration manuelle, ou un futur endpoint qui oublierait l'appel JS.

## 6. Réversibilité

Le backfill est un simple reformatage de chaîne (`0X` → `+33X`), sans perte d'information — **réversible par construction** : un second script inverse (`+33X` → `0X` pour les lignes concernées, en gardant la liste des ids touchés dans la migration elle-même) peut annuler l'opération si un problème est constaté après coup. Recommandation : la migration doit lister explicitement les ids modifiés (ex. `RETURNING id` loggué) plutôt que de compter sur un `WHERE phone LIKE '0%'` générique pour le rollback — plus sûr si d'autres écritures ont eu lieu entre-temps.

Si un trigger DB est ajouté (point 5), il est trivialement désactivable (`ALTER TABLE ... DISABLE TRIGGER ...`) sans toucher aux données déjà normalisées.

## Ce qu'il reste à trancher (Pierre)

1. Lancer la requête `pg_constraint` ci-dessus — la contrainte `UNIQUE(app_users.phone)` existe-t-elle vraiment ?
2. Lancer la requête `pg_get_functiondef` sur `check_booking_access()` — compare-t-elle aussi des téléphones bruts ?
3. Que faire des 3 comptes de test `0600000000` (`Test BnP`, `Test ICS Pierre` ×2) ?
4. Ajouter une vraie contrainte `UNIQUE(app_users.phone)` maintenant qu'on sait qu'elle n'est probablement pas active, ou rester sur le pré-check applicatif seul ?
5. `bookings.client_phone` ("okokokok") : nettoyer ou laisser ?
6. Ajouter un trigger DB de normalisation (point 5), ou s'en tenir à la discipline applicative existante ?
7. `partner_applications.phone` : traité dans ce chantier ou reporté ?

Une fois tranché : migration unique (point 3), fix des points de comparaison non sûrs listés au point 2, puis parcours navigateur complet avec le mécanisme de connexion sans mot de passe (voir `CLAUDE.md`) sur les deux clients réels identifiés au point 1 — c'est le seul test qui prouvera que le fix tient, pas une relecture de code.
