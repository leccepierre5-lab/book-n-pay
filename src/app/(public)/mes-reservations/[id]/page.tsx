// src/app/(public)/mes-reservations/[id]/page.tsx
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import ChatThread from '@/components/chat/ChatThread';

export default async function BookingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) redirect(`/connexion?redirect=/mes-reservations/${id}`);

  const { data: booking } = await supabase
    .from('bookings')
    .select('*, booking_members(*)')
    .eq('id', id)
    .maybeSingle();

  if (!booking) notFound();

  const { data: profile } = await supabase
    .from('app_users')
    .select('name, role')
    .eq('id', authData.user.id)
    .maybeSingle();

  const senderRole = profile?.role === 'pro' || profile?.role === 'admin' ? 'pro' : 'client';

  return (
    <div className="flex min-h-dvh flex-col">
      <div className="mx-auto w-full max-w-lg flex-1 px-4 py-6">
        <div className="mb-4 flex items-center gap-3">
          <Link href="/mes-reservations" className="text-white/60 hover:text-white">
            ←
          </Link>
          <div>
            <h1 className="text-lg font-semibold text-white">{booking.biz_name}</h1>
            <p className="text-xs text-white/50">
              {booking.service_name} · {booking.date} à {booking.time}
            </p>
          </div>
        </div>

        <div className="mb-4 rounded-xl bg-navy-900 p-4">
          <p className="mb-2 text-sm font-medium text-white">Participants</p>
          <div className="space-y-1.5">
            {booking.booking_members?.map((m: any) => (
              <div key={m.id} className="flex items-center justify-between text-sm">
                <span className="text-white/80">{m.name}</span>
                <span className="text-xs text-white/40">{m.status}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="h-96 overflow-hidden rounded-xl bg-navy-900">
          <ChatThread bookingId={booking.id} senderRole={senderRole} senderName={profile?.name || 'Vous'} />
        </div>
      </div>
    </div>
  );
}
