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
          Vos clients réservent, vous êtes payé. Sans commission.
        </p>
        <p className="text-sm text-slate-500 leading-relaxed mb-4">
          Book&apos;nPay est un outil de réservation pour les professionnels des services.
          Vos clients réservent en ligne à toute heure, versent des frais de réservation au
          moment de réserver, et vous récupérez ces frais directement — nous ne prélevons
          aucun pourcentage sur vos prestations.
        </p>
        <p className="text-sm text-slate-400">
          À partir de 79&nbsp;€ HT par mois.{' '}
          <Link href="/tarifs" className="text-mint-400 underline underline-offset-2 hover:text-mint-300">
            Voir les formules →
          </Link>
        </p>
      </div>

      <div className="mb-10 space-y-4">
        <div className="rounded-2xl bg-navy-900 border border-white/[0.08] p-5">
          <div className="w-10 h-10 rounded-xl bg-mint-500/12 border border-mint-500/20 flex items-center justify-center mb-3">
            <svg className="w-5 h-5 text-mint-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>
            </svg>
          </div>
          <h2 className="mb-1.5 text-sm font-semibold text-white">Aucune commission sur votre chiffre d&apos;affaires</h2>
          <p className="text-xs leading-relaxed text-slate-500">
            Vous payez un abonnement mensuel fixe, c&apos;est tout. Que vous fassiez dix ou trois
            cents réservations, nous ne prenons rien sur le prix de vos prestations. Les frais de
            gestion sont réglés par le client au moment de sa réservation, jamais par vous.
          </p>
        </div>

        <div className="rounded-2xl bg-navy-900 border border-white/[0.08] p-5">
          <div className="w-10 h-10 rounded-xl bg-mint-500/12 border border-mint-500/20 flex items-center justify-center mb-3">
            <svg className="w-5 h-5 text-mint-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
          </div>
          <h2 className="mb-1.5 text-sm font-semibold text-white">Un agenda qui travaille pendant que vous travaillez</h2>
          <p className="text-xs leading-relaxed text-slate-500">
            Vos clients réservent depuis votre fiche, à n&apos;importe quelle heure, sans vous
            appeler. Vous voyez vos rendez-vous en temps réel, vous gardez la main sur vos
            disponibilités, et vous ne perdez plus de créneaux parce que le téléphone sonnait
            pendant une prestation.
          </p>
        </div>

        <div className="rounded-2xl bg-navy-900 border border-white/[0.08] p-5">
          <div className="w-10 h-10 rounded-xl bg-mint-500/12 border border-mint-500/20 flex items-center justify-center mb-3">
            <svg className="w-5 h-5 text-mint-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/>
            </svg>
          </div>
          <h2 className="mb-1.5 text-sm font-semibold text-white">Les frais de réservation qui font venir les clients</h2>
          <p className="text-xs leading-relaxed text-slate-500">
            Chaque réservation est confirmée par des frais de réservation, encaissés de façon
            sécurisée via Stripe. Un client qui a engagé quelque chose se déplace. Et si un
            imprévu survient, le rendez-vous peut être annulé dans les conditions prévues —
            c&apos;est cadré, sans discussion pénible.
          </p>
        </div>

        <div className="rounded-2xl bg-navy-900 border border-white/[0.08] p-5">
          <div className="w-10 h-10 rounded-xl bg-mint-500/12 border border-mint-500/20 flex items-center justify-center mb-3">
            <svg className="w-5 h-5 text-mint-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
          </div>
          <h2 className="mb-1.5 text-sm font-semibold text-white">Vos clients vous reviennent</h2>
          <p className="text-xs leading-relaxed text-slate-500">
            Rappels automatiques par email avant chaque rendez-vous, fichier client tenu à jour,
            historique des visites : vous savez qui vient, qui revient, et qui ne s&apos;est plus
            manifesté depuis longtemps. Un programme de fidélité récompense les clients qui
            honorent leurs rendez-vous.
          </p>
        </div>
      </div>

      <div className="mb-10 border-t border-white/[0.07] pt-8">
        <h2 className="mb-3 text-sm font-semibold text-white">Comment ça se passe</h2>
        <ol className="space-y-2 text-xs leading-relaxed text-slate-500">
          <li><span className="text-mint-400 font-semibold">1.</span> Vous remplissez le formulaire ci-dessous.</li>
          <li><span className="text-mint-400 font-semibold">2.</span> Nous vous recontactons sous 48 heures pour échanger sur votre activité et le forfait adapté.</li>
          <li><span className="text-mint-400 font-semibold">3.</span> Si nous avançons ensemble, votre espace est créé et vous configurez votre fiche, vos prestations et vos horaires.</li>
        </ol>
      </div>

      <PartnerApplicationForm />
    </div>
  );
}
