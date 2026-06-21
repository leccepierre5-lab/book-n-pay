// src/app/(public)/confirmation/page.tsx
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import ShareGroupLink from '@/components/group/ShareGroupLink';

export default async function ConfirmationPage({
  searchParams,
}: {
  searchParams: Promise<{ booking?: string }>;
}) {
  const { booking: bookingId } = await searchParams;
  const supabase = await createClient();

  const { data: booking } = bookingId
    ? await supabase.from('bookings').select('*, services(max_persons)').eq('id', bookingId).maybeSingle()
    : { data: null };

  // Si le service accepte plusieurs personnes, propose le lien de partage
  // de groupe (équivalent du bandeau de partage affiché par JoinGroup.jsx
  // côté organisateur dans l'original).
  const isGroupBooking = (booking as any)?.services?.max_persons && (booking as any).services.max_persons > 1;

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">
        <div className="mb-4 text-5xl">🎉</div>
        <h1 className="mb-2 text-xl font-semibold text-white">Réservation confirmée !</h1>
        {booking ? (
          <p className="mb-6 text-sm text-white/60">
            {booking.service_name} chez {booking.biz_name}
            <br />
            le {booking.date} à {booking.time}
          </p>
        ) : (
          <p className="mb-6 text-sm text-white/60">
            Ta réservation a été enregistrée. Un email de confirmation va te parvenir.
          </p>
        )}

        {isGroupBooking && bookingId && (
          <div className="mb-6">
            <ShareGroupLink bookingId={bookingId} />
          </div>
        )}

        <Link
          href="/mes-reservations"
          className="inline-block rounded-xl bg-mint-500 px-6 py-3 text-sm font-medium text-navy-950"
        >
          Voir mes réservations
        </Link>
      </div>
    </div>
  );
}
