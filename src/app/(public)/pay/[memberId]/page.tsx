import { createServiceRoleClient } from '@/lib/supabase/server';
import PayGuestClient from '@/components/group/PayGuestClient';
import GroupTimer from '@/components/booking/GroupTimer';
import Link from 'next/link';

export default async function PayGuestPage({
  params,
}: {
  params: Promise<{ memberId: string }>;
}) {
  const { memberId } = await params;
  const supabase = createServiceRoleClient();

  const { data: member } = await supabase
    .from('booking_members')
    .select(`
      id,
      name,
      booking_id,
      status,
      bookings!inner(
        id,
        biz_name,
        service_name,
        service_id,
        staff_name,
        date,
        time,
        group_ref,
        payment_deadline,
        services(deposit, price)
      )
    `)
    .eq('id', memberId)
    .maybeSingle();

  if (!member) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 text-center">
        <div>
          <p className="text-3xl mb-3">🔗</p>
          <p className="text-white font-semibold mb-1">Lien invalide ou expiré</p>
          <p className="text-slate-400 text-sm">Ce lien de paiement n'existe pas.</p>
          <Link href="/" className="mt-4 inline-block text-xs text-emerald-400 hover:underline">
            Retour à l'accueil
          </Link>
        </div>
      </div>
    );
  }

  if (member.status === 'paid' || member.status === 'arrived') {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 text-center">
        <div>
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
            style={{
              background: 'linear-gradient(135deg, rgba(52,211,153,0.2), rgba(52,211,153,0.06))',
              boxShadow: 'inset 0 0 0 1px rgba(52,211,153,0.25)',
            }}
          >
            <svg className="w-8 h-8 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </div>
          <p className="text-white font-bold text-lg mb-1">Déjà payé !</p>
          <p className="text-slate-400 text-sm">Votre place est confirmée.</p>
        </div>
      </div>
    );
  }

  if (member.status === 'cancelled') {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 text-center">
        <div>
          <p className="text-3xl mb-3">❌</p>
          <p className="text-white font-semibold mb-1">Réservation annulée</p>
          <p className="text-slate-400 text-sm">Cette place n'est plus disponible.</p>
        </div>
      </div>
    );
  }

  const booking = (member as any).bookings;
  const deadline: string | null = booking?.payment_deadline ?? null;
  const isGroupPending = booking?.group_ref && deadline && new Date(deadline) > new Date();

  return (
    <div>
      {isGroupPending && (
        <div className="max-w-sm mx-auto px-4 pt-6">
          <GroupTimer deadline={deadline!} />
        </div>
      )}
      <PayGuestClient
        member={{ id: member.id, name: member.name, booking_id: member.booking_id }}
        booking={booking}
      />
    </div>
  );
}
