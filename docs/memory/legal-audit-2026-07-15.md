# Audit de conformité légale — reconnaissance du 2026-07-15

Reconnaissance de l'existant en matière de conformité légale française
(book-n-pay-next), menée en lecture seule le 15/07/2026 — aucun fichier
créé, aucun commit à l'issue de l'audit lui-même. Sert de source de
vérité pour la reprise après le RDV CCI Bayonne (voir `TODO.md`, item
"Volet légal") — ne pas redémarrer cette reconnaissance à zéro dans une
future session, repartir d'ici.

## 1. Mentions légales

❌ **Absent** — aucune page dédiée (`grep` sur `mentions-legales` /
`mentions_legales` / `impressum` : 0 résultat dans `src/`). Aucun lien
dans la navigation, aucun composant `Footer` global n'existe dans le
repo (`grep -i footer` : 0 fichier). Le seul texte visible en dehors du
flux de réservation est `CGULine` (`src/app/page.tsx:113-122`), qui ne
renvoie que vers `/cgu`. Aucune des mentions LCEN (identité éditeur,
forme juridique, SIREN/RCS, adresse siège, directeur de publication,
hébergeur avec coordonnées) n'existe nulle part dans le code.

## 2. Politique de confidentialité / RGPD

❌ **Page dédiée absente** — `grep` sur `confidentialite` / `privacy` /
`donnees-personnelles` / `politique-*` : 0 résultat.

⚠️ **RGPD dans la CGU, très incomplet** — `src/app/(public)/cgu/page.tsx`
§8 "Données personnelles" (lignes 258-268), 8 lignes au total : liste les
données collectées (nom/téléphone/email), une finalité unique ("gestion
des réservations"), promesse de non-revente, droits d'accès/rectification/
suppression via un email Gmail (`Booknpay.64@gmail.com`). (résolu le 16/07/2026 : remplacé par contact@book-n-pay.com dans le commit qui suit)
Manque au regard de l'art. 13 RGPD : finalités réelles incomplètes
(paiement Stripe, fidélité Sérénité, parrainage, avis/notifications
§10-§11 non mentionnés comme traitement de données) ; **aucune base
légale** énoncée ; **aucune durée de conservation** ; **aucun
destinataire** cité (Stripe, Supabase, Resend, hébergeur) ; **aucune
mention de transfert hors UE** (Stripe Irlande OK mais Supabase/Vercel
US) ; droits incomplets (portabilité, opposition, retrait du
consentement, réclamation CNIL absents) ; pas de contact DPO distinct
(email Gmail personnel, pas `privacy@book-n-pay.com`).

❌ **Cookies** — aucun bandeau de consentement, aucun composant de gestion
cookies nulle part dans `src/`. Les seules occurrences de `cookie` dans le
code sont la plomberie de session Supabase (`middleware.ts`,
`lib/supabase/server.ts`, routes `auth/*`) — pas un enjeu de consentement
au sens CNIL (cookies strictement nécessaires). **Aucun tracker/analytics
détecté** dans le code (`grep` Google Analytics/gtag/Meta Pixel/
Hotjar/Clarity/Matomo : 0 résultat) — donc probablement pas de bandeau
requis à ce jour, mais à confirmer côté Vercel Analytics/Speed Insights
si activés hors code source.

## 3. CGU/CGV (`src/app/(public)/cgu/page.tsx`)

✅ **Page existante, 16 sections** — Objet (1), Frais de réservation/
gestion (2), Annulation pro (3), Programme Sérénité (4), Réservations de
groupe (5), Annulation client (6), Responsabilités (7), Données
personnelles (8), Parrainage (9), Avis (10), Favoris/notifications (11),
Litiges (12), Litiges Client/Pro (13), Disponibilité/responsabilité (14),
Fraude/sécurité (15), Propriété intellectuelle (16). Date "Dernière mise
à jour : juillet 2026" (ligne 25) déjà à jour — le contenu §4.2 est bien
aligné sur la grille 1/2/3/4 Jokers, 100% (cohérent avec la décision du
14/07, voir `docs/serenite-decision.md`).

⚠️ **Prix TTC** — présent et explicite (barème §2, "TTC" affiché à
chaque ligne).

⚠️ **Modalités de paiement** — implicites seulement (carte bancaire
mentionnée en passant §2), pas de section dédiée nommant Stripe ni
précisant le moment du débit.

❌ **Droit de rétractation** — **aucune mention**, ni clause d'exercice
ni exclusion motivée. Le cas Book'nPay relève probablement de l'exception
légale L221-28 9° du Code de la consommation (prestation de service à
date/période déterminée), mais ce n'est **jamais énoncé explicitement**
dans le texte — c'est un vrai manque, pas juste un détail rédactionnel.

❌ **Garanties légales** — non mentionnées (à statuer : Book'nPay étant
intermédiaire technique et non vendeur du service presté, l'applicabilité
est à trancher, mais rien n'est dit du tout).

⚠️ **Réclamation** — §12 "Litiges" reste vague ("solution amiable
recherchée en priorité... tribunaux compétents"), pas de procédure de
réclamation formalisée (contact dédié, délai de réponse).

## 4. Médiateur consommation

❌ **Absent** — `grep` sur `mediateur` / `mediation` / `CM2C` / `MCP` /
`mediation-conso` : 0 résultat dans tout `src/`. Aucune coordonnée,
aucune mention dans la CGU (section 12 "Litiges" n'y renvoie pas).

## 5. Autres surfaces de conformité

**Formulaires** — ✅ case à cocher CGU/CGV présente et fonctionnelle à 3
endroits : `RegisterForm.tsx` (inscription, `cguAccepted` stocké),
`PartnerApplicationForm.tsx` (candidature pro, `cgu_accepted_at`/
`cgu_version` horodatés), `StepPayment.tsx` (réservation, ×2
occurrences). Toutes renvoient vers `/cgu`.
⚠️ Aucune n'a de lien séparé vers une politique de confidentialité
(normal, puisqu'elle n'existe pas — voir section 2) ni de case de
consentement marketing distincte de l'acceptation CGU.

**Emails transactionnels** — `src/lib/email/send.ts`, template HTML
unique (`emailTemplate()`, lignes 57-72) réutilisé par tous les emails du
produit. ❌ Pied de page minimal ("Book'nPay — votre fidélité est votre
assurance"), **aucun lien de désinscription, aucune mention de base
légale, aucune coordonnée légale**. Les emails "avis/satisfaction" (§10
CGU) et "notifications favoris" (§11 CGU) s'apparentent à de la
sollicitation et n'ont pas d'opt-out visible dans le template partagé —
à vérifier si un désabonnement existe ailleurs (pas trouvé dans
`send.ts`, qui semble être le seul point d'envoi).

## Synthèse

La CGU est structurellement solide et à jour sur le volet commercial
(Sérénité, annulation, groupe), mais **zéro mentions légales, zéro
politique de confidentialité dédiée, zéro médiateur, RGPD réduit à 8
lignes**. Rien de tout ça n'est bloqué par du code — c'est un chantier de
rédaction pure, en attente des infos administratives issues du RDV CCI
Bayonne (forme juridique, SIREN, obligations TVA/comptabilité) et du
choix d'un médiateur (CM2C / MEDICYS / AME, indépendant du RDV CCI). Voir
`TODO.md` pour l'état d'avancement courant de ce blocage.
