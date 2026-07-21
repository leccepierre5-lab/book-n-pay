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

      <div className="mb-8">
        <p className="text-[10px] font-bold tracking-[0.2em] text-mint-500/70 uppercase mb-2">PARTENARIAT</p>
        <h1 className="text-2xl font-bold text-white mb-2">Devenir partenaire</h1>
        <p className="text-sm text-slate-500 leading-relaxed">
          Zéro commission sur vos ventes — uniquement des frais de réservation fixes.
          On vous recontacte sous 48h.
        </p>
      </div>

      <PartnerApplicationForm />
    </div>
  );
}
