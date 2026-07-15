# TODO — reprise bnp-next

État au 2026-07-15 (soir) : working tree clean, `master` local et
`origin/master` synchronisés sur `3ab76bb` (4 commits pushés par Pierre :
`0146ef5`/`0246a86`/`784be9f`/`3ab76bb`). Décision Sérénité appliquée
(commits `1f32080`, `9cfb462`). Audit sécurité archivé dans
`docs/memory/security-audit-2026-07.md` (`1033d32`). Communication CGU
Sérénité rédigée et archivée dans `docs/comm/serenite-maj-2026-07.md`
(`a849201`) — statut : à envoyer, pas encore envoyée. **Table `profiles`
supprimée de bout en bout** : audit d'usage (0 ligne/0 référence code/0 FK/
0 fonction dépendante), migration `0023_drop_profiles.sql`, **exécutée en
base par Pierre**, vérifiée post-suppression (`is_admin()`/`auth_biz_id()`
OK, audit RLS relancé → 0 trou sur 21 tables, `profiles` bien signalée
comme ignorée par `rls-check.mjs`).

## Ouvert, par priorité

1. **Volet légal** (le plus urgent en risque réel) : mentions légales,
   politique RGPD dédiée, médiateur consommation, relecture avocat. En
   attente que Pierre rassemble SIREN / adresse / hébergeur / durées de
   conservation.
2. **Retest manuel des rate limits** non prouvés par le protocole
   automatique :
   - `forgot-password` — vérifier via la table `rate_limits` Supabase.
   - `checkin-by-qr` — nécessite une session pro authentifiée.
