# Reprise — session soir 2026-07-16

## Fait cette session
- **Vestiges nettoyés** : 2 businesses "Debug" + 4 comptes @test.local
  supprimés (orphelins confirmés avant suppression, base re-vérifiée propre).
  Commits : a4bc27e (recon), 9fa5588 (suppression).
- **Bug RLS partner_applications corrigé et versionné** : la policy
  `partner_applications_insert_public` avait `WITH CHECK` VIDE en prod
  (divergence Dashboard vs code — RLS modifié au Dashboard sans migration).
  Fix : DROP + CREATE avec `WITH CHECK (true)`, aligné sur migration.
  Commit : 86fd475 (migration 0034). Vrai bug prod : /devenir-partenaire
  était cassé pour tout prospect réel.
- Tout poussé sur origin/master (e0e5b52..86fd475).

## Client test créé
- `test-16juillet-client-1@book-n-pay.invalid`
- id : 8d9edcc3-b141-43ce-bae2-cc52452236d1
- Compte pro test NON créé (bloqué par le bug ci-dessous).

## BUG OUVERT — 401/42501 sur INSERT anon (cause identifiée)
**Cause : migration des JWT signing keys HS256 (legacy) -> ECC P-256
(asymétrique) incomplète/incohérente côté gateway PostgREST.**
Confirmé par Dashboard > JWT Keys (Current = ECC P-256, Previous =
Legacy HS256 non révoquée) et par Supabase Discussion #45812 (symptôme
identique : rotation ECC P-256 -> tous INSERT anon en 42501 malgré
WITH CHECK true, RLS désactivée = insert passe). Citation vérifiée le
16/07 (recherche web, discussion GitHub confirmée réelle) :
https://github.com/orgs/supabase/discussions/45812

Causes ÉCARTÉES (prouvées saines) : policy RLS (corrigée), pas de policy
restrictive, GRANT anon présent, pas de trigger, clé/projet corrects
(SELECT anon 200 OK, vérifié en direct), pas de `.select()` post-insert,
code client correct (src/lib/supabase/client.ts), Postgres pur OK
(`SET ROLE anon; INSERT` réussit — test lancé par Pierre en SQL Editor,
pas observé directement par Claude Code dans cette session).

Config clés : client = sb_publishable_ (nouveau), service_role = JWT
legacy (vérifié : payload décodé ref=suyfsuvrbdpnnijxspge, role=service_role).
État hybride.

### Résolution — dans l'ordre, s'arrêter dès que INSERT anon repasse
1. Vérifier .env prod+local = clé publishable de la config ECC actuelle,
   puis rebuild + redéploiement propre.
2. Si échec : force reboot projet (Settings > General > Restart).
3. Si échec : révoquer la clé Legacy HS256 (⚠️ IRRÉVERSIBLE, casse toutes
   les sessions actives — OK en pré-lancement 0 client, PAS en prod réelle).
4. Si échec : ticket support Supabase (souci infra possible).
Ne PAS lancer à l'aveugle — touche l'infra auth de la prod.

## Reste à faire (audit fonctionnel, une fois le bug levé)
- Créer compte pro test + son business [TEST 16/07]
- Parcours client : recherche -> réservation -> paiement test -> email
- Parcours pro : dashboard, notifications, visibilité
- Cas particuliers : annulation, joker Sérénité, remboursement, groupe
- Vérifier emails reçus dans Booknpay.64
- Nettoyage SQL final (script dans audit-2026-07-16.md)

## Garde-fous inchangés
- Commit oui / push jamais (Claude Code). Pierre pousse après relecture.
- app_config.mode_test_paiement = true (rebascule false = dernière étape
  avant client réel).
- Volet légal bloqué sur RDV CCI Bayonne.
