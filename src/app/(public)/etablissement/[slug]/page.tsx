// src/app/(public)/etablissement/[slug]/page.tsx
// Port de src/pages/BookingFlow.jsx — la page établissement EST le point
// d'entrée du parcours de réservation (comme dans l'app actuelle).
import { notFound } from 'next/navigation';
import { getBusinessBySlug } from '@/lib/queries/catalog';
import BookingFlow from '@/components/booking/BookingFlow';

const CATEGORY_ICONS: Record<string, string> = {
  beaute: '✂️',
  'bien-etre': '🧖',
  sport: '🏄',
  enfants: '👶',
  food: '🍽️',
  education: '📚',
  creatif: '🎨',
  services: '🔧',
};

export default async function EtablissementPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const business = await getBusinessBySlug(slug);

  if (!business) notFound();

  // Un établissement gelé reste accessible par lien direct (favori,
  // ancien lien partagé) même s'il n'apparaît plus dans la recherche —
  // on l'affiche clairement plutôt que de laisser l'utilisateur découvrir
  // le blocage seulement au moment de payer.
  if (business.frozen) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4 text-center">
        <div>
          <p className="mb-2 text-2xl">⏸️</p>
          <h1 className="mb-2 text-lg font-semibold text-white">{business.name}</h1>
          <p className="text-sm text-white/50">
            Cet établissement est temporairement indisponible. Reviens plus tard.
          </p>
        </div>
      </div>
    );
  }

  return (
    <BookingFlow business={business} icon={CATEGORY_ICONS[business.category] || '🏢'} />
  );
}
