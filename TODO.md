# TODO — reprise bnp-next

État au 2026-07-14 (fin de session) : working tree clean, `master` local sur
`1033d32` (2 commits d'avance sur `origin/master` qui reste à `7debeba` —
push réservé à Pierre). Décision Sérénité appliquée (commits `1f32080`,
`9cfb462`). Ménage vestiges terminé (commits `fad4347`, `7debeba`). Audit
sécurité archivé dans `docs/memory/security-audit-2026-07.md` (`1033d32`).

## Ouvert, par priorité

1. **Volet légal** (le plus urgent en risque réel) : mentions légales,
   politique RGPD dédiée, médiateur consommation, relecture avocat. En
   attente que Pierre rassemble SIREN / adresse / hébergeur / durées de
   conservation.
2. **Retest manuel des rate limits** non prouvés par le protocole
   automatique :
   - `forgot-password` — vérifier via la table `rate_limits` Supabase.
   - `checkin-by-qr` — nécessite une session pro authentifiée.
3. **Suppression de la table `profiles`** — récursion RLS documentée dans
   `SECURITY_TODO.md`, non urgent car fail-fermé.
4. **Communication utilisateurs de la MAJ CGU** — optionnel, en leur
   faveur, sans urgence.
