import type { Metadata } from 'next';
import Link from 'next/link';
import PartnerApplicationForm from '@/components/partner/PartnerApplicationForm';

export const metadata: Metadata = {
  title: 'Devenir partenaire — 0% de commission',
  description:
    "Rejoignez Book'nPay : abonnement fixe, zéro commission sur vos ventes, réservation en ligne et paiement sécurisé pour indépendants beauté & bien-être.",
  alternates: { canonical: '/devenir-partenaire' },
};

export default function DevenirPartenairePage() {
  return (
    <div className="min-h-dvh mx-auto max-w-lg px-4 py-10">
      <Link
        href="/tarifs"
        className="mb-6 inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-white transition-colors"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
        Voir les tarifs
      </Link>

      <div className="mb-10">
        <p className="text-[10px] font-bold tracking-[0.2em] text-mint-500/70 uppercase mb-2">PARTENARIAT</p>
        <h1 className="text-2xl font-bold text-white mb-2">Devenir partenaire</h1>
        <p className="text-base font-medium text-white/90 mb-4">
          Des réservations confirmées, sans passer votre journée au téléphone.
        </p>
        <p className="text-sm text-slate-500 leading-relaxed mb-4">
          Book&apos;nPay simplifie la prise de rendez-vous pour les professionnels des services.
          Vos clients réservent en ligne 24h/24 et versent des frais de réservation au moment de
          réserver. Vous gardez l&apos;esprit libre pour exercer.
        </p>
        <p className="text-sm text-slate-400">
          À partir de 79&nbsp;€ HT par mois, engagement selon la formule.{' '}
          <Link href="/tarifs" className="text-mint-400 underline underline-offset-2 hover:text-mint-300">
            Voir les formules →
          </Link>
        </p>
      </div>

      <div className="mb-10 space-y-4">
        <h2 className="text-sm font-semibold text-white">Ce que ça change au quotidien</h2>

        <div className="rounded-2xl bg-navy-900 border border-white/[0.08] p-5">
          <div className="w-10 h-10 rounded-xl bg-mint-500/12 border border-mint-500/20 flex items-center justify-center mb-3">
            <svg className="w-5 h-5 text-mint-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
          </div>
          <h3 className="mb-1.5 text-sm font-semibold text-white">Moins d&apos;appels pendant vos prestations</h3>
          <p className="text-xs leading-relaxed text-slate-500">
            Vos clients prennent rendez-vous même quand vous travaillez ou lorsque
            l&apos;établissement est fermé. Votre agenda se met à jour en temps réel.
          </p>
        </div>

        <div className="rounded-2xl bg-navy-900 border border-white/[0.08] p-5">
          <div className="w-10 h-10 rounded-xl bg-mint-500/12 border border-mint-500/20 flex items-center justify-center mb-3">
            <svg className="w-5 h-5 text-mint-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/>
            </svg>
          </div>
          <h3 className="mb-1.5 text-sm font-semibold text-white">Des rendez-vous mieux sécurisés</h3>
          <p className="text-xs leading-relaxed text-slate-500">
            Chaque réservation est confirmée par le paiement de frais de réservation via Stripe.
            Un client qui s&apos;engage est plus susceptible d&apos;honorer son rendez-vous. En cas
            d&apos;imprévu, l&apos;annulation est traitée selon les conditions prévues.
          </p>
        </div>

        <div className="rounded-2xl bg-navy-900 border border-white/[0.08] p-5">
          <div className="w-10 h-10 rounded-xl bg-mint-500/12 border border-mint-500/20 flex items-center justify-center mb-3">
            <svg className="w-5 h-5 text-mint-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>
            </svg>
          </div>
          <h3 className="mb-1.5 text-sm font-semibold text-white">
            Des clients qui oublient moins facilement leur rendez-vous
          </h3>
          <p className="text-xs leading-relaxed text-slate-500">
            Les rappels automatiques par email aident à limiter les oublis de dernière minute.
            Votre fichier client reste à jour, avec l&apos;historique des visites.
          </p>
        </div>

        <div className="rounded-2xl bg-navy-900 border border-white/[0.08] p-5">
          <div className="w-10 h-10 rounded-xl bg-mint-500/12 border border-mint-500/20 flex items-center justify-center mb-3">
            <svg className="w-5 h-5 text-mint-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>
            </svg>
          </div>
          <h3 className="mb-1.5 text-sm font-semibold text-white">Une tarification prévisible</h3>
          <p className="text-xs leading-relaxed text-slate-500">
            Vous payez un abonnement fixe, sans commission sur vos prestations. Les frais de
            gestion de la plateforme sont réglés par vos clients. Stripe prélève uniquement ses
            frais bancaires habituels sur chaque encaissement.
          </p>
        </div>
      </div>

      <div className="mb-10 border-t border-white/[0.07] pt-8">
        <h2 className="mb-3 text-sm font-semibold text-white">Comment ça se passe</h2>
        <ol className="space-y-2 text-xs leading-relaxed text-slate-500">
          <li>
            <span className="text-mint-400 font-semibold">1.</span> Déposez votre demande — le
            formulaire ci-dessous prend quelques minutes.
          </li>
          <li>
            <span className="text-mint-400 font-semibold">2.</span> Nous étudions votre dossier —
            nous vous recontactons sous 48 heures pour échanger sur votre activité.
          </li>
          <li>
            <span className="text-mint-400 font-semibold">3.</span> Création de votre espace —
            vous configurez vos prestations, vos horaires et votre page de réservation.
          </li>
        </ol>
      </div>

      <PartnerApplicationForm />
    </div>
  );
}
