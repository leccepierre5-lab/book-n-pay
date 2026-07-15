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
comme ignorée par `rls-check.mjs`). **Retest manuel `forgot-password` et
`checkin-by-qr` fait** : rate limit confirmé mordant sur `forgot-password`
(IP et email, données réelles `rate_limits`), mécanisme confirmé actif sur
`checkin-by-qr` (nuance : blocage effectif à 30/5min non observé, seul le
comptage par compte pro l'est) — détail dans
`docs/memory/security-audit-2026-07.md`. **Volet légal : reconnaissance de
conformité faite** (mentions légales/RGPD dédié/médiateur/rétractation
absents, emails sans mentions légales/opt-out — détail dans
`docs/memory/legal-audit-2026-07-15.md`), **blocage prérequis identifié** :
RDV CCI Bayonne à prendre par Pierre avant toute rédaction sérieuse.

## Ouvert, par priorité

1. **Volet légal** (le plus urgent en risque réel) — reconnaissance de
   conformité faite le 15/07/2026, détail complet dans
   `docs/memory/legal-audit-2026-07-15.md`. État factuel :
   - Mentions légales : **absentes**.
   - Politique de confidentialité RGPD dédiée : **absente** ; le RGPD dans
     la CGU (§8) est très incomplet au regard de l'art. 13 (8 lignes, pas
     de bases légales / durées de conservation / destinataires /
     transferts hors UE).
   - Médiateur consommation : **absent**.
   - Droit de rétractation dans les CGV : **non énoncé** (ni clause ni
     exclusion motivée).
   - Emails transactionnels : **pas de mentions légales, pas d'opt-out**.
   - Case consentement marketing indistincte de l'acceptation CGU (mineur).
   - CGU/CGV : structurellement solide, Sérénité déjà aligné — pas un
     point de blocage.
   - Cookies : aucun tracker détecté dans le code, bandeau probablement
     non requis (à confirmer côté dashboard Vercel).

   **Blocage prérequis** : Pierre doit prendre RDV avec la CCI de Bayonne
   (05 59 46 59 46, 50-51 Allées Marines) pour trancher forme juridique,
   immatriculation, obligations (TVA, comptabilité). Rien de sérieux ne
   peut se rédiger avant.

   **3 infos clés à récupérer via la CCI** : forme juridique définitive,
   SIREN, obligations TVA/comptabilité.

   **Médiateur en parallèle** (indépendant du RDV CCI) : choisir entre
   CM2C / MEDICYS / AME, ~100€/an.
