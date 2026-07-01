// src/app/api/booking/post-visit-status/route.ts
// Retourne, pour le client connecté, la dernière prestation clôturée par le
// pro (status='arrived') pas encore vue via le popup post-RDV. Marque
// immédiatement le membre comme "vu" pour ne pas le reservir au poll suivant.
import { NextResponse } from 'next/server';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { phonesMatch } from '@/lib/booking-utils';

export async function GET() {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    return NextResponse.json({ pending: false });
  }

  const supabaseAdmin = createServiceRoleClient();

  const { data: profile } = await supabaseAdmin
    .from('app_users')
    .select('phone, referral_code')
    .eq('id', authData.user.id)
    .maybeSingle();

  if (!profile?.phone) {
    return NextResponse.json({ pending: false });
  }

  const { data: candidateRows } = await supabaseAdmin
    .from('booking_members')
    .select('id, phone, booking_id, bookings!inner(biz_id, biz_name, service_name, date, time, status)')
    .eq('status', 'arrived')
    .eq('post_visit_popup_shown', false)
    .neq('bookings.status', 'cancelled');

  const matches = (candidateRows ?? []).filter((r) => phonesMatch(r.phone, profile.phone));

  if (matches.length === 0) {
    return NextResponse.json({ pending: false });
  }

  // La prestation la plus récente en cas de plusieurs clôtures en attente
  matches.sort((a, b) => {
    const ba = (a as any).bookings;
    const bb = (b as any).bookings;
    const da = `${ba?.date ?? ''} ${ba?.time ?? ''}`;
    const db = `${bb?.date ?? ''} ${bb?.time ?? ''}`;
    return db.localeCompare(da);
  });

  const member = matches[0] as any;
  const booking = member.bookings;

  const { data: business } = await supabaseAdmin
    .from('businesses')
    .select('name, google_place_url')
    .eq('id', booking.biz_id)
    .maybeSingle();

  await supabaseAdmin
    .from('booking_members')
    .update({ post_visit_popup_shown: true })
    .eq('id', member.id);

  return NextResponse.json({
    pending: true,
    bizName: business?.name || booking.biz_name,
    serviceName: booking.service_name,
    googlePlaceUrl: business?.google_place_url || null,
    referralCode: profile.referral_code || null,
  });
}
