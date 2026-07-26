# CGU/CGV Book'nPay — archive avant retrait de la section "Réservations de groupe"

**Statut** : version en vigueur du 21/06/2026 (mise en ligne initiale du site,
premier commit `f8b3eca`) au 26/07/2026. Remplacée à cette date par le
retrait de la section 5 ("Réservations de groupe") suite à la désactivation
de la fonctionnalité groupe (flag `GROUP_BOOKING_ENABLED = false`,
`src/lib/feature-flags.ts`).

**Pourquoi cette archive** : cette version reste la version **opposable**
pour toute réservation de groupe effectuée avant le 26/07/2026 — en cas de
litige portant sur une réservation de cette période, c'est ce texte qui
s'applique, pas la version courante du site. Conservée telle quelle (source
: `src/app/(public)/cgu/page.tsx`, avant modification par le commit qui
introduit ce fichier), sans reformulation.

---

## 1. Objet

Book'nPay est une plateforme technique de mise en relation permettant de faciliter la
réservation de prestations de services. Book'nPay intervient uniquement en tant
qu'intermédiaire technique pour sécuriser le paiement des frais de réservation. Les
présentes CGU/CGV régissent l'accès et l'utilisation de la plateforme.

## 2. Frais de réservation et frais de gestion

Lors d'une réservation, deux types de frais sont prélevés sur la carte bancaire du client :

**Frais de réservation** — Ils constituent une garantie de réservation pour le
professionnel. Ils sont versés directement au professionnel au moment de la prestation.

**Frais de gestion** — Ils rémunèrent les services de la plateforme Book'nPay, incluant le
traitement bancaire sécurisé et la mise en relation. Ces frais sont **non remboursables,
quelle que soit la cause de l'annulation** (annulation client, annulation professionnel,
no-show).

Barème des frais de gestion :
- Prestation ≤ 50 € : 1,99 € TTC
- Prestation de 50,01 € à 80 € : 2,10 € TTC
- Prestation de 80,01 € à 100 € : 2,30 € TTC
- Prestation > 100 € (plafond) : 2,50 € TTC

## 3. Politique d'annulation par le professionnel

Le professionnel s'engage à procéder au remboursement intégral des frais de réservation au
client en cas d'annulation de sa part. Les frais de gestion **ne font l'objet d'aucun
remboursement**.

## 4. Programme de fidélité "Book'nPay Sérénité"

**4.1. Principe :** Book'nPay propose un programme de fidélité récompensant la fiabilité
des Utilisateurs. Le statut de l'Utilisateur est déterminé par le nombre de rendez-vous
honorés via la plateforme.

**4.2. Statuts et avantages :** Le programme comporte quatre paliers : Standard, Bronze,
Argent et Gold. Chaque palier donne droit à un nombre défini de "Jokers" annuels,
permettant le remboursement des frais de réservation en cas d'annulation par
l'Utilisateur :
- Standard (1 à 15 RDV) : 1 Joker annuel (remboursement de 100 % des frais de réservation).
- Bronze (16 à 30 RDV) : 2 Jokers annuels (remboursement de 100 % des frais de réservation).
- Argent (31 à 50 RDV) : 3 Jokers annuels (remboursement de 100 % des frais de réservation).
- Gold (+ 50 RDV) : 4 Jokers annuels (remboursement de 100 % des frais de réservation).

**4.3. Conditions d'application :**
- **Réinitialisation :** Le compteur de "Jokers" est réinitialisé automatiquement au 1er
  janvier de chaque année civile.
- **Statut acquis :** Le statut atteint est conservé par l'Utilisateur, sous réserve
  d'effectuer un minimum de 5 rendez-vous par année civile. À défaut, l'Utilisateur est
  déclassé d'un seul palier au 1er janvier suivant (par exemple Gold vers Argent), sans
  perte des Jokers déjà attribués pour l'année en cours ni du compteur de rendez-vous
  cumulés. Ce déclassement graduel est distinct du déclassement total prévu à l'article
  4.4 en cas d'inactivité prolongée.
- **Frais exclus :** Le "Joker" permet exclusivement le remboursement des frais de
  réservation. Les frais de gestion sont définitivement acquis à Book'nPay et ne font
  l'objet d'aucun remboursement, quel que soit le statut de l'Utilisateur.

**4.4. Maintien du statut et inactivité :** Le maintien du statut atteint (Bronze, Argent,
Gold) est conditionné par une utilisation régulière de la plateforme. En cas d'inactivité
constatée sur une période de deux (2) mois consécutifs (absence de réservation honorée sur
la période), l'Utilisateur sera automatiquement déclassé au statut Standard. En
conséquence de ce déclassement, l'Utilisateur perdra l'ensemble des avantages liés à son
ancien statut, y compris le solde des "Jokers" non consommés. Le compteur de rendez-vous
cumulés sera également réinitialisé à zéro pour repartir sur la base du palier Standard.

## 5. Réservations de groupe

**5.1. Processus de réservation :** Lorsqu'un utilisateur crée une réservation de groupe,
les places réservées sont maintenues pendant une période de trente (30) minutes.

**5.2. Condition de finalisation :** L'intégralité du paiement des frais de réservation
doit être effectuée par chaque membre du groupe dans ce délai imparti de 30 minutes, tel
qu'affiché par le compte à rebours présent sur l'interface.

**5.3. Annulation automatique :** Passé ce délai de 30 minutes, si la transaction totale du
groupe n'est pas finalisée, la réservation est automatiquement annulée et les places sont
remises à disposition des autres utilisateurs de la plateforme. La responsabilité de la
finalisation du paiement incombe à chaque participant invité par le chef de groupe.

**5.4. Modification du groupe :** Le créateur du groupe (ou "chef de groupe") dispose de la
faculté de modifier le nombre de participants au sein de la réservation.

**5.5. Conditions de modification :** Toute modification du nombre de participants doit
impérativement être effectuée avant l'expiration du délai de 30 minutes imparti à la
réservation initiale. Passé ce délai, la réservation est considérée comme définitive et
aucune modification du nombre de participants ne pourra être prise en compte via la
plateforme.

**5.6. Complétude du groupe et remboursement :** La réservation de groupe est considérée
comme effective uniquement si l'intégralité des places réservées fait l'objet d'un
paiement dans le délai imparti de 30 minutes. À défaut de paiement de l'ensemble des
participants, la réservation globale sera automatiquement annulée. En cas d'annulation
automatique, Book'nPay procédera au remboursement des frais de réservation aux membres
ayant effectué leur paiement. Toutefois, les frais de gestion restent définitivement
acquis à Book'nPay et ne feront l'objet d'aucun remboursement, quel que soit le motif de
l'annulation.

> ⚠️ Note technique (non contractuelle, ajoutée à l'archivage) : le délai réellement
> appliqué par le code à l'époque de cette version était de **20 minutes**, pas 30 —
> écart entre ce texte et le comportement réel du produit, découvert en audit le 26/07/2026.

## 6. Conditions d'annulation par le client

**6.1. Annulation flexible :** Tout Utilisateur peut annuler gratuitement sa réservation
jusqu'à 48 heures avant l'heure prévue du rendez-vous. Dans ce cas, les frais de
réservation seront intégralement remboursés à l'Utilisateur.

**6.2. Frais non remboursables :** Conformément à nos conditions, les frais de gestion ne
sont en aucun cas remboursables, quelle que soit la date d'annulation.

**6.3. Annulation tardive :** Passé le délai de 48 heures avant l'heure du rendez-vous, la
réservation est considérée comme ferme et définitive. Aucun remboursement des frais de
réservation ne sera effectué par Book'nPay, ces derniers étant acquis au professionnel en
compensation du créneau bloqué.

## 7. Responsabilités

Book'nPay agit exclusivement en qualité d'intermédiaire technique pour la gestion des
transactions financières. Book'nPay n'est pas partie au contrat de prestation de service
conclu entre le client et le professionnel. Par conséquent, Book'nPay ne saurait être tenu
responsable :
- De la qualité, du contenu ou de la réalisation de la prestation de service fournie par
  le professionnel.
- Des litiges, différends ou dommages découlant de la relation contractuelle directe entre
  le client et le professionnel.

Toute réclamation relative à la prestation elle-même doit être adressée directement au
professionnel concerné.

## 8. Données personnelles

Les données collectées (nom, téléphone, email) sont traitées exclusivement pour la gestion
des réservations et ne sont jamais revendues à des tiers. Conformément au RGPD, vous
disposez des droits suivants :
- **Accès et portabilité :** vous pouvez télécharger l'ensemble de vos données
  personnelles à tout moment depuis votre espace « Mon compte » (« Télécharger mes
  données »).
- **Suppression :** vous pouvez supprimer votre compte à tout moment depuis votre espace
  « Mon compte », sous réserve de n'avoir aucun rendez-vous à venir en cours. Vos
  réservations passées sont alors conservées sous forme anonymisée (nom et coordonnées
  effacés) pour nos obligations légales de facturation ; vos favoris sont définitivement
  supprimés ; votre compte de connexion est supprimé.
- **Rectification :** pour toute correction de vos données que vous ne pouvez pas
  effectuer vous-même depuis votre espace, contactez-nous à contact@book-n-pay.com.

## 9. Programme de parrainage "Sérénité"

**9.1. Principe :** Tout Utilisateur peut parrainer un ami via son lien ou code de
parrainage personnel disponible dans son espace "Mes réservations".

**9.2. Avantage :** Lorsque l'ami parrainé effectue son premier rendez-vous honoré, le
parrain et le filleul reçoivent chacun un crédit de +5 rendez-vous honorés sur leur
compteur de fidélité, ainsi qu'un Joker bonus valable jusqu'au 31 décembre de l'année en
cours.

**9.3. Conditions :** Le bénéfice du parrainage n'est accordé qu'une seule fois par
parrain/filleul. Toute tentative de fraude (auto-parrainage, faux comptes) entraîne la
suppression des avantages accordés.

**9.4. Réduction financière de parrainage :** En complément du crédit de RDV honorés et du
Joker bonus, lorsque le filleul effectue son premier rendez-vous honoré, le parrain
bénéficie d'une réduction de 20% et le filleul d'une réduction de 10% sur le prix de leur
prochaine prestation respective. Cette réduction s'applique automatiquement, est valable
une seule fois par parrainage réussi, et ne se cumule pas avec d'autres offres
promotionnelles sauf mention contraire. Cette réduction porte sur le prix de la prestation
déterminé par le Professionnel et n'affecte pas les frais de gestion dus à Book'nPay.

## 10. Avis et évaluations

Après un rendez-vous honoré, Book'nPay peut inviter l'Utilisateur, via une notification
affichée sur la plateforme, à laisser un avis sur l'établissement concerné via Google.
Book'nPay ne collecte, n'héberge ni ne modère le contenu de cet avis, qui reste géré par
Google. Une note et un nombre d'avis peuvent être affichés à titre indicatif sur la fiche
de l'établissement.

## 11. Favoris et notifications

L'Utilisateur peut marquer des établissements partenaires comme "Favoris". Book'nPay peut
envoyer des notifications ponctuelles à ces Utilisateurs en cas de nouveaux créneaux ou
promotions liées aux établissements favoris, dans le respect du RGPD.

## 12. Litiges

En cas de litige relatif à l'utilisation de la plateforme ou aux transactions gérées par
Book'nPay, une solution amiable sera recherchée en priorité. À défaut, les tribunaux
compétents seront saisis.

## 13. Litiges entre Client et Professionnel

**13.1.** Book'nPay agit exclusivement en qualité d'intermédiaire technique facilitant la
mise en relation et le paiement entre Clients et Professionnels. Book'nPay n'est ni partie
ni garant du contrat de prestation de service conclu directement entre le Client et le
Professionnel.

**13.2.** En cas de désaccord sur la qualité, le déroulement ou les modalités d'une
prestation, le Client et le Professionnel s'engagent à rechercher une solution amiable
directement entre eux. Book'nPay peut, à sa discrétion et sans obligation, faciliter cette
mise en relation mais ne tranche aucun litige relatif à l'exécution de la prestation
elle-même.

**13.3.** En cas de no-show contesté (le Client affirmant s'être présenté alors que le
Professionnel indique le contraire, ou inversement), Book'nPay peut examiner les éléments
objectifs disponibles (horodatage de connexion, QR code scanné le cas échéant, historique
de fiabilité) mais ne peut garantir une résolution favorable à l'une ou l'autre partie. La
décision finale relative aux frais de réservation reste basée sur les statuts enregistrés
dans le système au moment du rendez-vous.

**13.4.** Book'nPay se réserve le droit de suspendre ou de geler le compte d'un
Professionnel ou d'un Client en cas de litiges répétés, de signalements multiples, ou de
comportement manifestement abusif, sans que cela constitue une reconnaissance de
responsabilité de la part de Book'nPay.

## 14. Disponibilité du Service et Limitation de Responsabilité

**14.1.** Book'nPay met en œuvre des moyens raisonnables pour assurer la disponibilité et
le bon fonctionnement de la plateforme, sans garantir une disponibilité continue ou sans
interruption. Des interruptions peuvent survenir pour maintenance, mise à jour, ou pour
des causes indépendantes de la volonté de Book'nPay (panne d'un prestataire technique
tiers, incident réseau, etc.).

**14.2.** Book'nPay ne saurait être tenu responsable des conséquences directes ou
indirectes d'une indisponibilité temporaire du service, notamment en cas de réservation
manquée, de paiement non traité, ou de notification non reçue, dans la limite de ce qui
est permis par la loi applicable.

**14.3.** En cas de dysfonctionnement avéré et imputable à Book'nPay ayant causé un
préjudice financier direct (par exemple, double prélèvement), Book'nPay s'engage à
procéder au remboursement du trop-perçu dans un délai raisonnable, sur signalement de
l'Utilisateur concerné.

## 15. Utilisation Frauduleuse et Sécurité des Comptes

**15.1.** Toute tentative de fraude est strictement interdite, incluant notamment : la
création de comptes multiples par une même personne, l'auto-parrainage, la falsification
d'informations d'identité ou de contact, et toute manipulation visant à obtenir indûment
des avantages du programme de fidélité ou de parrainage.

**15.2.** Book'nPay se réserve le droit de vérifier, suspendre ou supprimer tout compte
présentant des signes de fraude, sans préavis et sans indemnité, et de retirer
rétroactivement tout avantage (Jokers, réductions, statuts) obtenu de manière frauduleuse.

**15.3.** L'Utilisateur est responsable de la confidentialité de ses identifiants de
connexion. Toute action effectuée depuis un compte est présumée avoir été effectuée par
son titulaire, sauf preuve contraire d'un accès non autorisé signalé sans délai à
Book'nPay.

## 16. Propriété Intellectuelle

**16.1.** La marque "Book'nPay", son logo, son identité visuelle, ainsi que l'ensemble des
éléments composant la plateforme (textes, code source, design, base de données,
algorithmes de fidélité et de tarification) sont la propriété exclusive de Book'nPay ou de
ses concédants, et sont protégés par le droit de la propriété intellectuelle.

**16.2.** Toute reproduction, représentation, modification, ou exploitation, totale ou
partielle, de ces éléments sans autorisation écrite préalable de Book'nPay est strictement
interdite et susceptible de poursuites.

**16.3.** Les contenus publiés par les Professionnels (descriptions, photos, tarifs)
restent leur propriété, mais ces derniers concèdent à Book'nPay une licence d'utilisation
non exclusive aux seules fins d'affichage et de promotion sur la plateforme, pour la durée
de leur inscription.
