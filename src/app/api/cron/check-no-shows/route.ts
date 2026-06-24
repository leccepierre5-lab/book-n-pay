// src/app/api/cron/check-no-shows/route.ts
// Port de base44/functions/checkNoShows/entry.ts
//
// Déclenché par Vercel Cron (voir vercel.json) toutes les 15 minutes.
// Détecte les no-shows (15 à 180 min après le RDV, membre encore 'paid'),
// les marque 'no_show', et désactive les FlashSlots expirés.
import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { parseParisDatetime } from '@/lib/booking-utils';

export async function GET(req: NextRequest) {
  // Protection : seul Vercel Cron (avec le bon secret) peut déclencher ceci.
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const now = new Date();
  const nowTs = now.getTime();

  console.log('[NoShow] Vérification lancée à', now.toISOString());

  // 0. Désactiver les FlashSlots dont le créneau est déjà passé
  const { data: activeFlashSlots } = await supabase
    .from('flash_slots')
    .select('id, biz_name, date, time')
    .eq('active', true);

  let flashExpired = 0;
  for (const fs of activeFlashSlots || []) {
    if (parseParisDatetime(fs.date, fs.time).getTime() < nowTs) {
      await supabase.from('flash_slots').update({ active: false }).eq('id', fs.id);
      flashExpired++;
    }
  }

  // 1. Récupérer les bookings actifs avec leurs membres
  const { data: bookings } = await supabase
    .from('bookings')
    .select('id, biz_name, date, time, booking_members(id, status)')
    .eq('status', 'active');

  let processed = 0;

  for (const booking of bookings || []) {
    if (!booking.date || !booking.time) continue;
    const rdvDate = parseParisDatetime(booking.date, booking.time);
    const diffMin = (nowTs - rdvDate.getTime()) / 60000;

    if (diffMin < 15 || diffMin > 180) continue;

    const paidMembers = (booking.booking_members || []).filter((mb: any) => mb.status === 'paid');
    if (paidMembers.length === 0) continue;

    for (const mb of paidMembers) {
      await supabase.from('booking_members').update({ status: 'no_show' }).eq('id', mb.id);
    }

    await supabase.from('booking_logs').insert({
      booking_id: booking.id,
      message: 'No-show automatique — frais de réservation retenus',
    });

    console.log(
      `[NoShow] No-show automatique — ${booking.biz_name} | ${booking.date} ${booking.time} | ${paidMembers.length} membre(s)`
    );
    processed++;
  }

  return NextResponse.json({
    checked: bookings?.length || 0,
    noShows: processed,
    flashSlotsExpired: flashExpired,
    timestamp: now.toISOString(),
  });
}
