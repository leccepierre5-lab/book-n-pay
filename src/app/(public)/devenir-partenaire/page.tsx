// src/app/(public)/devenir-partenaire/page.tsx
import PartnerApplicationForm from '@/components/partner/PartnerApplicationForm';

export default function DevenirPartenairePage() {
  return (
    <div className="mx-auto max-w-lg px-4 py-10">
      <h1 className="mb-2 text-xl font-semibold text-white">Devenir partenaire Book'nPay</h1>
      <p className="mb-6 text-sm text-white/60">
        Zéro commission sur tes ventes, juste des frais de réservation fixes. On te recontacte
        rapidement après ta demande.
      </p>
      <PartnerApplicationForm />
    </div>
  );
}
