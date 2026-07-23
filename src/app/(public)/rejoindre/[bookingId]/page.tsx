// src/app/(public)/rejoindre/[bookingId]/page.tsx
// Point d'entrée du lien de partage de groupe (équivalent JoinGroup.jsx).
// Accessible sans authentification — un invité doit pouvoir rejoindre et
// payer sa place sans compte préalable (cohérent avec le flow Base44).
import JoinGroupClient from '@/components/group/JoinGroupClient';

export default async function RejoindrePage({
  params,
  searchParams,
}: {
  params: Promise<{ bookingId: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const { bookingId } = await params;
  const { t } = await searchParams;
  return <JoinGroupClient bookingId={bookingId} organizerToken={t ?? null} />;
}
