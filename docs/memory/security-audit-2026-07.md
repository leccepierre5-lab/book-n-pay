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

**Non prouvé automatiquement** (à tester manuellement) :
- `forgot-password` — masque volontairement l'état du rate limit, jamais de
  429 par design. Vérifier via la table `rate_limits` Supabase.
- `checkin-by-qr` — nécessite une session pro authentifiée.

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
- **P2** : suppression de la table `profiles` (récursion RLS documentée
  dans `SECURITY_TODO.md`, non urgent car fail-fermé).
- **P2** : migrations 0001-0007 (schéma de base) toujours non versionnées,
  dette connue documentée dans `SECURITY_TODO.md`, non bloquant.
- Optionnel, sans urgence : communication utilisateurs de la MAJ CGU (en
  leur faveur).
