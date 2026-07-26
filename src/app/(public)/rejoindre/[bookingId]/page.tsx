// src/app/(public)/rejoindre/[bookingId]/page.tsx
// Point d'entrée du lien de partage de groupe (équivalent JoinGroup.jsx).
// Accessible sans authentification — un invité doit pouvoir rejoindre et
// payer sa place sans compte préalable (cohérent avec le flow Base44).
import JoinGroupClient from '@/components/group/JoinGroupClient';
import { GROUP_BOOKING_ENABLED } from '@/lib/feature-flags';

export default async function RejoindrePage({
  params,
  searchParams,
}: {
  params: Promise<{ bookingId: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  // Flag OFF (26/07, feature-flags.ts) — bloque aussi ce point d'entrée par
  // lien direct (un lien déjà partagé avant la désactivation resterait sinon
  // accessible même si create-group/bookings/group sont fermés côté API).
  if (!GROUP_BOOKING_ENABLED) {
    return (
      <div className="min-h-dvh flex items-center justify-center px-4 text-center">
        <div>
          <p className="text-3xl mb-3">🚧</p>
          <p className="text-white font-semibold mb-1">Fonctionnalité indisponible</p>
          <p className="text-slate-400 text-sm">La réservation de groupe n&apos;est pas active pour le moment.</p>
        </div>
      </div>
    );
  }

  const { bookingId } = await params;
  const { t } = await searchParams;
  return <JoinGroupClient bookingId={bookingId} organizerToken={t ?? null} />;
}
