# TODO — reprise bnp-next

État au 2026-07-15 : working tree clean, `master` local et `origin/master`
synchronisés sur `a849201` (push déjà effectué, plus rien en attente).
Décision Sérénité appliquée (commits `1f32080`, `9cfb462`). Ménage vestiges
terminé (commits `fad4347`, `7debeba`). Audit sécurité archivé dans
`docs/memory/security-audit-2026-07.md` (`1033d32`). Communication CGU
Sérénité rédigée et archivée dans `docs/comm/serenite-maj-2026-07.md`
(`a849201`) — statut : à envoyer, pas encore envoyée. Table `profiles` :
audit d'usage fait, suppression versionnée dans
`supabase/migrations/0023_drop_profiles.sql` — exécution en base restant
à faire par Pierre.

## Ouvert, par priorité

1. **Volet légal** (le plus urgent en risque réel) : mentions légales,
   politique RGPD dédiée, médiateur consommation, relecture avocat. En
   attente que Pierre rassemble SIREN / adresse / hébergeur / durées de
   conservation.
2. **Retest manuel des rate limits** non prouvés par le protocole
   automatique :
   - `forgot-password` — vérifier via la table `rate_limits` Supabase.
   - `checkin-by-qr` — nécessite une session pro authentifiée.
