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

## Blindage technique — audit de l'existant (session dédiée, après audit fonctionnel)

Objectif : passer en revue chaque brique critique d'un SaaS de réservation +
paiement, en mode AUDIT DE L'EXISTANT (le SaaS tourne déjà en prod) — PAS
en construction from-scratch. Pour chaque point : présent dans le code ?
correct ? couvert par la doc ? versionné en migration ? Croiser avec
SECURITY_TODO.md et docs/memory/security-audit-2026-07.md pour ne pas
dupliquer.

Stack connue : Next.js / Supabase / Stripe / Resend. Ne PAS reposer les
questions de stack. À confirmer dans les docs existants : modèle de flux
financier (Stripe Connect direct vs encaissement puis reversement) et cible
prestataires.

Briques à auditer :
1. BDD & gestion du temps
   - Schéma réel (app_users, businesses, services, bookings, payments) —
     déjà confirmé contre migrations.
   - Dates/heures stockées en UTC ? Conversion timezone pro vs client ?
   - Buffer times entre rendez-vous ?
2. Anti double-booking & concurrence
   - Verrouillage (SELECT FOR UPDATE / transaction) contre les race
     conditions sur un même créneau ?
   - Réservation temporaire (créneau bloqué pendant le paiement, libéré
     si échec) ?
3. Paiement Stripe
   - Webhooks résilients (checkout.session.completed valide la résa même
     si le client ferme le navigateur) ?
   - Idempotence (pas de double débit) ?
   - Remboursement partiel/total + gestion des frais Stripe non remboursés ?
   - Factures conformes (numérotation séquentielle, mentions légales, TVA) ?
4. Notifications & délivrabilité
   - Emails transactionnels (confirmation, rappels J-1 / H-2 anti no-show) ?
   - DNS SPF / DKIM / DMARC configurés ? (redirection Ionos déjà OK)
5. Conformité & monitoring
   - RGPD : script de suppression totale des données d'un utilisateur
     (right to be forgotten) ?
   - Monitoring erreurs (Sentry) + logs d'audit ?

Note : le prompt architecture complet d'origine est archivé (conversation
2026-07-16). Le convertir en checklist point par point contre l'existant.
