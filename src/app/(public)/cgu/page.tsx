// src/app/(public)/cgu/page.tsx
// Port FIDÈLE de src/pages/CGU.jsx — texte juridique copié sans
// reformulation (contrairement au contenu marketing, une CGU/CGV engage
// contractuellement Book'nPay envers ses utilisateurs ; je ne me permets
// aucune liberté de paraphrase ici). Seule la navigation a changé
// (react-router-dom → next/link).
import Link from 'next/link';

export default function CGUPage() {
  return (
    <div className="min-h-screen bg-navy-950">
      <div className="mx-auto max-w-2xl px-4 py-8">
        <Link href="/" className="mb-6 flex items-center gap-2 text-white/50 hover:text-white">
          ← Retour
        </Link>

        <h1 className="mb-2 text-2xl font-semibold text-white">CGU/CGV — Book'nPay</h1>
        <p className="mb-8 text-xs text-white/40">Dernière mise à jour : juin 2026</p>

        <div className="space-y-7 text-sm leading-relaxed text-white/70">
          <section>
            <h2 className="mb-2 text-base font-semibold text-white">1. Objet</h2>
            <p>
              Book'nPay est une plateforme technique de mise en relation permettant de faciliter la
              réservation de prestations de services. Book'nPay intervient uniquement en tant
              qu'intermédiaire technique pour sécuriser le paiement des frais de réservation. Les
              présentes CGU/CGV régissent l'accès et l'utilisation de la plateforme.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-white">2. Frais de réservation et frais de gestion</h2>
            <p className="mb-3">
              Lors d'une réservation, deux types de frais sont prélevés sur la carte bancaire du
              client :
            </p>
            <div className="space-y-3">
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <p className="mb-1 font-semibold text-white">Frais de réservation</p>
                <p>
                  Ils constituent une garantie de réservation pour le professionnel. Ils sont versés
                  directement au professionnel au moment de la prestation.
                </p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <p className="mb-1 font-semibold text-white">Frais de gestion</p>
                <p className="mb-3">
                  Ils rémunèrent les services de la plateforme Book'nPay, incluant le traitement
                  bancaire sécurisé et la mise en relation. Ces frais sont{' '}
                  <strong className="text-white">
                    non remboursables, quelle que soit la cause de l'annulation
                  </strong>{' '}
                  (annulation client, annulation professionnel, no-show).
                </p>
                <p className="mb-2 text-xs font-medium text-white/60">Barème des frais de gestion :</p>
                <ul className="space-y-1.5 text-xs">
                  <li className="flex justify-between">
                    <span>Prestation ≤ 50 €</span>
                    <span className="font-semibold text-white">1,99 € TTC</span>
                  </li>
                  <li className="flex justify-between">
                    <span>Prestation de 50,01 € à 80 €</span>
                    <span className="font-semibold text-white">2,10 € TTC</span>
                  </li>
                  <li className="flex justify-between">
                    <span>Prestation de 80,01 € à 100 €</span>
                    <span className="font-semibold text-white">2,30 € TTC</span>
                  </li>
                  <li className="flex justify-between">
                    <span>Prestation &gt; 100 € (plafond)</span>
                    <span className="font-semibold text-white">2,50 € TTC</span>
                  </li>
                </ul>
              </div>
            </div>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-white">
              3. Politique d'annulation par le professionnel
            </h2>
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <p>
                Le professionnel s'engage à procéder au remboursement intégral des frais de
                réservation au client en cas d'annulation de sa part. Les frais de gestion{' '}
                <strong className="text-white">ne font l'objet d'aucun remboursement</strong>.
              </p>
            </div>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-white">
              4. Programme de fidélité "Book'nPay Sérénité"
            </h2>
            <p className="mb-3">
              <strong className="text-white">4.1. Principe :</strong> Book'nPay propose un programme
              de fidélité récompensant la fiabilité des Utilisateurs. Le statut de l'Utilisateur est
              déterminé par le nombre de rendez-vous honorés via la plateforme.
            </p>
            <p className="mb-3">
              <strong className="text-white">4.2. Statuts et avantages :</strong> Le programme
              comporte quatre paliers : Standard, Bronze, Argent et Gold. Chaque palier donne droit
              à un nombre défini de "Jokers" annuels, permettant le remboursement des frais de
              réservation en cas d'annulation par l'Utilisateur :
            </p>
            <div className="mb-3 space-y-2 rounded-xl border border-white/10 bg-white/5 p-4 text-xs">
              <div className="flex items-start gap-2">
                <span className="shrink-0 font-semibold text-white">Standard</span>
                <span>(1 à 15 RDV) : 1 Joker annuel (remboursement de 50 % des frais de réservation).</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="shrink-0 font-semibold text-amber-600">Bronze</span>
                <span>(16 à 30 RDV) : 1 Joker annuel (remboursement de 100 % des frais de réservation).</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="shrink-0 font-semibold text-gray-300">Argent</span>
                <span>(31 à 50 RDV) : 2 Jokers annuels (remboursement de 100 % des frais de réservation).</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="shrink-0 font-semibold text-yellow-300">Gold</span>
                <span>(+ 50 RDV) : 3 Jokers annuels (remboursement de 100 % des frais de réservation).</span>
              </div>
            </div>
            <p className="mb-2">
              <strong className="text-white">4.3. Conditions d'application :</strong>
            </p>
            <ul className="mb-3 list-disc space-y-2 pl-5">
              <li>
                <strong className="text-white/80">Réinitialisation :</strong> Le compteur de "Jokers"
                est réinitialisé automatiquement au 1er janvier de chaque année civile.
              </li>
              <li>
                <strong className="text-white/80">Statut acquis :</strong> Le statut atteint est
                conservé par l'Utilisateur, sous réserve d'effectuer un minimum de 5 rendez-vous par
                année civile.
              </li>
              <li>
                <strong className="text-white/80">Frais exclus :</strong> Le "Joker" permet
                exclusivement le remboursement des frais de réservation. Les frais de gestion sont
                définitivement acquis à Book'nPay et ne font l'objet d'aucun remboursement, quel que
                soit le statut de l'Utilisateur.
              </li>
            </ul>
            <p>
              <strong className="text-white">4.4. Maintien du statut et inactivité :</strong> Le
              maintien du statut atteint (Bronze, Argent, Gold) est conditionné par une utilisation
              régulière de la plateforme. En cas d'inactivité constatée sur une période de deux (2)
              mois consécutifs (absence de réservation honorée sur la période), l'Utilisateur sera
              automatiquement déclassé au statut Standard. En conséquence de ce déclassement,
              l'Utilisateur perdra l'ensemble des avantages liés à son ancien statut, y compris le
              solde des "Jokers" non consommés. Le compteur de rendez-vous cumulés sera également
              réinitialisé à zéro pour repartir sur la base du palier Standard.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-white">5. Réservations de groupe</h2>
            <div className="space-y-3">
              <p>
                <strong className="text-white">5.1. Processus de réservation :</strong> Lorsqu'un
                utilisateur crée une réservation de groupe, les places réservées sont maintenues
                pendant une période de trente (30) minutes.
              </p>
              <p>
                <strong className="text-white">5.2. Condition de finalisation :</strong>
                L'intégralité du paiement des frais de réservation doit être effectuée par chaque
                membre du groupe dans ce délai imparti de 30 minutes, tel qu'affiché par le compte à
                rebours présent sur l'interface.
              </p>
              <p>
                <strong className="text-white">5.3. Annulation automatique :</strong> Passé ce délai
                de 30 minutes, si la transaction totale du groupe n'est pas finalisée, la réservation
                est automatiquement annulée et les places sont remises à disposition des autres
                utilisateurs de la plateforme. La responsabilité de la finalisation du paiement
                incombe à chaque participant invité par le chef de groupe.
              </p>
              <p>
                <strong className="text-white">5.4. Modification du groupe :</strong> Le créateur du
                groupe (ou "chef de groupe") dispose de la faculté de modifier le nombre de
                participants au sein de la réservation.
              </p>
              <p>
                <strong className="text-white">5.5. Conditions de modification :</strong> Toute
                modification du nombre de participants doit impérativement être effectuée avant
                l'expiration du délai de 30 minutes imparti à la réservation initiale. Passé ce
                délai, la réservation est considérée comme définitive et aucune modification du
                nombre de participants ne pourra être prise en compte via la plateforme.
              </p>
              <p>
                <strong className="text-white">5.6. Complétude du groupe et remboursement :</strong>{' '}
                La réservation de groupe est considérée comme effective uniquement si l'intégralité
                des places réservées fait l'objet d'un paiement dans le délai imparti de 30 minutes.
                À défaut de paiement de l'ensemble des participants, la réservation globale sera
                automatiquement annulée. En cas d'annulation automatique, Book'nPay procédera au
                remboursement des frais de réservation aux membres ayant effectué leur paiement.
                Toutefois, les frais de gestion restent définitivement acquis à Book'nPay et ne
                feront l'objet d'aucun remboursement, quel que soit le motif de l'annulation.
              </p>
            </div>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-white">6. Conditions d'annulation par le client</h2>
            <div className="space-y-3">
              <p>
                <strong className="text-white">6.1. Annulation flexible :</strong> Tout Utilisateur
                peut annuler gratuitement sa réservation jusqu'à 48 heures avant l'heure prévue du
                rendez-vous. Dans ce cas, les frais de réservation seront intégralement remboursés à
                l'Utilisateur.
              </p>
              <p>
                <strong className="text-white">6.2. Frais non remboursables :</strong> Conformément à
                nos conditions, les frais de gestion ne sont en aucun cas remboursables, quelle que
                soit la date d'annulation.
              </p>
              <p>
                <strong className="text-white">6.3. Annulation tardive :</strong> Passé le délai de
                48 heures avant l'heure du rendez-vous, la réservation est considérée comme ferme et
                définitive. Aucun remboursement des frais de réservation ne sera effectué par
                Book'nPay, ces derniers étant acquis au professionnel en compensation du créneau
                bloqué.
              </p>
            </div>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-white">7. Responsabilités</h2>
            <p className="mb-3">
              Book'nPay agit exclusivement en qualité d'intermédiaire technique pour la gestion des
              transactions financières. Book'nPay n'est pas partie au contrat de prestation de
              service conclu entre le client et le professionnel. Par conséquent, Book'nPay ne
              saurait être tenu responsable :
            </p>
            <ul className="list-disc space-y-1.5 pl-5">
              <li>
                De la qualité, du contenu ou de la réalisation de la prestation de service fournie
                par le professionnel.
              </li>
              <li>
                Des litiges, différends ou dommages découlant de la relation contractuelle directe
                entre le client et le professionnel.
              </li>
            </ul>
            <p className="mt-3">
              Toute réclamation relative à la prestation elle-même doit être adressée directement au
              professionnel concerné.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-white">8. Données personnelles</h2>
            <p>
              Les données collectées (nom, téléphone, email) sont traitées exclusivement pour la
              gestion des réservations et ne sont jamais revendues à des tiers. Conformément au
              RGPD, vous disposez d'un droit d'accès, de rectification et de suppression de vos
              données en contactant :{' '}
              <a href="mailto:Booknpay.64@gmail.com" className="text-emerald-500 underline">
                Booknpay.64@gmail.com
              </a>
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-white">
              9. Programme de parrainage "Sérénité"
            </h2>
            <div className="space-y-3">
              <p>
                <strong className="text-white">9.1. Principe :</strong> Tout Utilisateur peut
                parrainer un ami via son lien ou code de parrainage personnel disponible dans son
                espace "Mes réservations".
              </p>
              <p>
                <strong className="text-white">9.2. Avantage :</strong> Lorsque l'ami parrainé
                effectue son premier rendez-vous honoré, le parrain et le filleul reçoivent chacun un
                crédit de <strong className="text-white">+5 rendez-vous honorés</strong> sur leur
                compteur de fidélité, ainsi qu'un Joker bonus valable jusqu'au 31 décembre de l'année
                en cours.
              </p>
              <p>
                <strong className="text-white">9.3. Conditions :</strong> Le bénéfice du parrainage
                n'est accordé qu'une seule fois par parrain/filleul. Toute tentative de fraude
                (auto-parrainage, faux comptes) entraîne la suppression des avantages accordés.
              </p>
            </div>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-white">10. Avis et évaluations</h2>
            <p className="mb-3">
              Book'nPay peut envoyer automatiquement un email de satisfaction 2 heures après la
              réalisation d'un rendez-vous honoré. L'Utilisateur est libre de répondre ou non. Les
              avis collectés peuvent être affichés sur la fiche de l'établissement concerné.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-white">11. Favoris et notifications</h2>
            <p>
              L'Utilisateur peut marquer des établissements partenaires comme "Favoris". Book'nPay
              peut envoyer des notifications ponctuelles à ces Utilisateurs en cas de nouveaux
              créneaux ou promotions liées aux établissements favoris, dans le respect du RGPD.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-white">12. Litiges</h2>
            <p>
              En cas de litige relatif à l'utilisation de la plateforme ou aux transactions gérées
              par Book'nPay, une solution amiable sera recherchée en priorité. À défaut, les
              tribunaux compétents seront saisis.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
