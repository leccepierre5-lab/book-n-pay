// src/app/(public)/reschedule/[token]/page.tsx
// Point d'entrée du lien envoyé au client par pro/reschedule-propose/route.ts
// (migration 0055) — accessible sans authentification, le token est le seul
// facteur d'accès.
import RescheduleResponseClient from '@/components/booking/RescheduleResponseClient';

export default async function ReschedulePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <RescheduleResponseClient token={token} />;
}
