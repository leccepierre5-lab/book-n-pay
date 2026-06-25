import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
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

  const { data: profile } = await supabase
    .from('app_users')
    .select('*')
    .eq('id', authData.user.id)
    .maybeSingle();

  const { data: bookings } = await supabase
    .from('bookings')
    .select('*, booking_members(*)')
    .order('date', { ascending: false })
    .order('time', { ascending: false });

  // Historique des parrainages réussis (en tant que parrain)
  const { data: referralEvents } = await supabase
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
