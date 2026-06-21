// src/app/(public)/mes-reservations/page.tsx
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import MyBookingsList from '@/components/booking/MyBookingsList';

export default async function MesReservationsPage() {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) redirect('/connexion?redirect=/mes-reservations');

  const { data: profile } = await supabase
    .from('app_users')
    .select('*')
    .eq('id', authData.user.id)
    .maybeSingle();

  // RLS filtre déjà : créateur OU membre via téléphone OU admin
  const { data: bookings } = await supabase
    .from('bookings')
    .select('*, booking_members(*)')
    .order('date', { ascending: false })
    .order('time', { ascending: false });

  return <MyBookingsList bookings={bookings || []} profile={profile} />;
}
