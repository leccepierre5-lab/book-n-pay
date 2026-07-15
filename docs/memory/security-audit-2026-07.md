# Audit sécurité — 2026-07

Audit sécurité complet mené le 2026-07-14 sur book-n-pay-next. Protocole en
6 blocs (preuves d'exécution réelles, viewport a11y, Sérénité, CI, trackers,
hooks) — format à reprendre à l'identique si un audit similaire est refait.
Les 5 commits de l'audit ont été mergés sur `master` via PR #6 (`c88b43d`).

## Vérifié réellement en prod (pas supposé sur lecture de code)

- RLS propre sur 22 tables (0 trou). Seule `profiles` (table morte connue) a
  une policy en récursion infinie — échoue fermé, pas une fuite.
- Rate limiting confirmé sur `register`, `bookings-group`, `stripe-checkout`
  (429 exactement aux seuils documentés).
- Signature webhook Stripe rejette bien un payload sans signature ou avec
  une fausse signature.

## Décision Sérénité (même journée)

Modèle de fidélité aligné code = référence — voir
[`docs/serenite-decision.md`](../serenite-decision.md) pour le détail
(jokers 1/2/3/4, remboursement 100 % tous paliers).

## Ménage vestiges d'audit

Retrait du hook pre-push legacy, `CLAUDE.md` créé/enrichi avec la
description de la chaîne de protection anti-push, `.gitignore` des settings
locaux, suppression des fichiers temporaires laissés à la racine.

## Reste à faire

Détail et priorités à jour dans `TODO.md` à la racine du repo. En résumé :

- **P0 — légal** (le plus urgent en risque réel) : mentions légales,
  politique RGPD dédiée, médiateur consommation. Bloqué en attente que
  Pierre rassemble SIREN / adresse / hébergeur / durées de conservation.
- **P1** : `forgot-password` et `checkin-by-qr` à tester manuellement pour
  confirmer le rate limiting.
- **P1** : lint a 193 warnings `react/no-unescaped-entities` non corrigés
  (volontairement laissés en warning, pas en erreur) — à nettoyer un jour,
  aucune urgence.
- **P2** : migrations 0001-0007 (schéma de base) toujours non versionnées,
  dette connue documentée dans `SECURITY_TODO.md`, non bloquant.
- Optionnel, sans urgence : communication utilisateurs de la MAJ CGU (en
  leur faveur).

## Fait ce mois-ci (post-audit)

- **Suppression de la table `profiles`** — clos le 15/07/2026. Audit
  d'usage (0 ligne, 0 référence code, 0 FK entrante, 0 fonction dépendante),
  migration `supabase/migrations/0023_drop_profiles.sql`, exécutée en base
  par Pierre, vérifiée post-suppression (`is_admin()`/`auth_biz_id()` OK,
  `rls-check.mjs` relancé → 0 trou sur 21 tables).
- **Retest manuel `forgot-password` et `checkin-by-qr`** — clos le
  15/07/2026, données réelles observées dans `public.rate_limits` :
  - `forgot-password:ip:83.193.30.142` → `count=5`,
    `window_start=2026-07-14 13:31:39` — compteur exactement au plafond
    documenté (5/15 min par IP) : le rate limit mord.
  - `forgot-password:email:audit-ratelimit-test@book-n-pay.invalid` →
    `count=3`, `window_start=2026-07-14 13:31:40` — compteur exactement au
    plafond documenté (3/15 min par email) : le rate limit mord.
  - `checkin-by-qr:<uuid-compte-pro>` → 6 lignes distinctes du 09/07 avec
    compteurs entre 1 et 2 — le mécanisme est câblé et compte réellement
    par compte pro, mais **aucune ligne n'atteint le plafond (30/5 min)** :
    le blocage effectif à 30 n'est pas prouvé par ces données, seule
    l'existence et le fonctionnement du compteur le sont.
  - Bonus (hors mandat, observé au passage, confirmatif) : `join-group:ip`
    → 10, `stripe-checkout:ip` → 30, cohérents avec les plafonds
    documentés.
