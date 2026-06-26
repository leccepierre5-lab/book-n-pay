import Link from 'next/link';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { normalizePhone } from '@/lib/booking-utils';
import MyBookingsList from '@/components/booking/MyBookingsList';
import type { Booking, BookingMember } from '@/lib/database.types';

export type GroupMap = Record<string, (Booking & { booking_members: BookingMember[] })[]>;

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

  const supabaseAdmin = createServiceRoleClient();

  const { data: profile } = await supabaseAdmin
    .from('app_users')
    .select('*')
    .eq('id', authData.user.id)
    .maybeSingle();

  // Rechercher par téléphone normalisé ET format brut (incohérence historique en base)
  const bookingIdSet = new Set<string>();

  if (profile?.phone) {
    const rawPhone = profile.phone;
    const normPhone = normalizePhone(profile.phone);
    const phonesFilter = rawPhone === normPhone
      ? `phone.eq.${rawPhone}`
      : `phone.eq.${rawPhone},phone.eq.${normPhone}`;

    const { data: memberRows } = await supabaseAdmin
      .from('booking_members')
      .select('booking_id')
      .or(phonesFilter);
    (memberRows ?? []).forEach((r) => bookingIdSet.add(r.booking_id));
  }

  const { data: orgRows } = await supabaseAdmin
    .from('bookings')
    .select('id')
    .eq('client_id', authData.user.id);
  (orgRows ?? []).forEach((b) => bookingIdSet.add(b.id));

  const allIds = [...bookingIdSet];

  const { data: userBookings } = allIds.length > 0
    ? await supabaseAdmin
        .from('bookings')
        .select('*, booking_members(*)')
        .in('id', allIds)
        .order('date', { ascending: false })
        .order('time', { ascending: false })
    : { data: [] as (Booking & { booking_members: BookingMember[] })[] };

  const bookings = userBookings ?? [];

  // Pour chaque groupe (group_ref non-null), charger TOUS les bookings du groupe
  // afin d'afficher la progression et les participants complets
  const groupRefs = [
    ...new Set(bookings.filter((b) => b.group_ref).map((b) => b.group_ref as string)),
  ];

  const groupMap: GroupMap = {};
  if (groupRefs.length > 0) {
    const { data: allGroupBookings } = await supabaseAdmin
      .from('bookings')
      .select('*, booking_members(*)')
      .in('group_ref', groupRefs)
      .order('time', { ascending: true });

    groupRefs.forEach((ref) => {
      groupMap[ref] = (allGroupBookings ?? []).filter((b) => b.group_ref === ref) as (Booking & { booking_members: BookingMember[] })[];
    });
  }

  const { data: referralEvents } = await supabaseAdmin
    .from('referral_events')
    .select('*')
    .eq('referrer_id', authData.user.id)
    .order('created_at', { ascending: false });

  return (
    <MyBookingsList
      bookings={bookings}
      profile={profile}
      referralEvents={referralEvents || []}
      groupMap={groupMap}
    />
  );
}
