import Link from 'next/link';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import MyBookingsList from '@/components/booking/MyBookingsList';

export default async function MesReservationsPage() {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();

  if (!authData.user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-56px)] px-6 text-center">
        <p className="text-slate-400 mb-6 text-base">Connectez-vous pour voir vos réservations</p>
        <Link
          href="/connexion?redirect=/mes-reservations"
          className="rounded-xl bg-mint-500 px-8 py-3 font-semibold text-navy-950"
        >
          Se connecter →
        </Link>
      </div>
    );
  }

  // Service role pour bypass RLS — l'utilisateur est déjà vérifié ci-dessus
  const supabaseAdmin = createServiceRoleClient();

  const { data: profile } = await supabaseAdmin
    .from('app_users')
    .select('*')
    .eq('id', authData.user.id)
    .maybeSingle();

  // Récupérer les IDs des bookings via booking_members (phone) + client_id
  // Couvre : booking individuel, groupe organisateur, groupe invité,
  // et anciens bookings où client_id = null (créés avant le fix auth)
  const bookingIdSet = new Set<string>();

  const { data: memberRows } = profile?.phone
    ? await supabaseAdmin
        .from('booking_members')
        .select('booking_id')
        .eq('phone', profile.phone)
    : { data: [] as { booking_id: string }[] };
  (memberRows ?? []).forEach((r) => bookingIdSet.add(r.booking_id));

  const { data: orgRows } = await supabaseAdmin
    .from('bookings')
    .select('id')
    .eq('client_id', authData.user.id);
  (orgRows ?? []).forEach((b) => bookingIdSet.add(b.id));

  const allIds = [...bookingIdSet];

  const { data: bookings } = allIds.length > 0
    ? await supabaseAdmin
        .from('bookings')
        .select('*, booking_members(*)')
        .in('id', allIds)
        .order('date', { ascending: false })
        .order('time', { ascending: false })
    : { data: [] as any[] };

  // Historique des parrainages réussis (en tant que parrain)
  const { data: referralEvents } = await supabaseAdmin
    .from('referral_events')
    .select('*')
    .eq('referrer_id', authData.user.id)
    .order('created_at', { ascending: false });

  return (
    <MyBookingsList
      bookings={bookings || []}
      profile={profile}
      referralEvents={referralEvents || []}
    />
  );
}
