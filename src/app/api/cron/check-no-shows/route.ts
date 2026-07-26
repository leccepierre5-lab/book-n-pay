// src/app/api/cron/check-no-shows/route.ts
//
// Déclenché par Vercel Cron (voir vercel.json) tous les jours à 8h UTC.
// Détecte les no-shows (15 min+ après le RDV, membre encore 'paid'),
// les marque 'no_show', et désactive les FlashSlots expirés.
import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { parseParisDatetime, formatTime, resolveMemberRecipientEmail } from '@/lib/booking-utils';
import { isValidBearerSecret } from '@/lib/constant-time';
import { processBatch } from '@/lib/cron-batch';
import { notifyAdminOnFailure } from '@/lib/notify-admin';
import { notifyProNoShow } from '@/lib/pro-notifications';
import { sendEmail } from '@/lib/email/send';

export async function GET(req: NextRequest) {
  // Protection : seul Vercel Cron (avec le bon secret) peut déclencher ceci.
  const authHeader = req.headers.get('authorization');
  if (!isValidBearerSecret(authHeader, process.env.CRON_SECRET)) {
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

  const expiredFlashSlots = (activeFlashSlots || []).filter(
    (fs) => parseParisDatetime(fs.date, fs.time).getTime() < nowTs
  );

  // processBatch (lib/cron-batch.ts) isole chaque item — un échec sur un
  // FlashSlot ou un booking ne doit plus bloquer le traitement des suivants
  // (même classe de bug qu'expire-groups, incident 22/07).
  const flashResult = await processBatch(
    expiredFlashSlots,
    'check-no-shows:flash-slots',
    (fs) => `${fs.biz_name} ${fs.date} ${fs.time}`,
    async (fs) => {
      await supabase.from('flash_slots').update({ active: false }).eq('id', fs.id);
    }
  );

  // 1. Récupérer les bookings actifs des 7 derniers jours avec leurs membres
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const sevenDaysAgoStr = sevenDaysAgo.toISOString().slice(0, 10);
  const todayStr = now.toISOString().slice(0, 10);

  const { data: bookings } = await supabase
    .from('bookings')
    .select('id, biz_name, service_name, date, time, client_email, client_phone, booking_members(id, name, phone, email, status)')
    .neq('status', 'cancelled')
    .gte('date', sevenDaysAgoStr)
    .lte('date', todayStr);

  const eligibleBookings = (bookings || [])
    .filter((booking) => {
      if (!booking.date || !booking.time) return false;
      const rdvDate = parseParisDatetime(booking.date, booking.time);
      const diffMin = (nowTs - rdvDate.getTime()) / 60000;
      // Grâce période 15 min — ignore les RDV futurs ou trop récents
      return diffMin >= 15;
    })
    .map((booking) => ({
      booking,
      paidMembers: (booking.booking_members || []).filter((mb: any) => mb.status === 'paid'),
    }))
    .filter(({ paidMembers }) => paidMembers.length > 0);

  const noShowResult = await processBatch(
    eligibleBookings,
    'check-no-shows',
    ({ booking }) => `${booking.biz_name} ${booking.date} ${booking.time}`,
    async ({ booking, paidMembers }) => {
      for (const mb of paidMembers) {
        await supabase.from('booking_members').update({ status: 'no_show' }).eq('id', mb.id);
      }

      await supabase.from('booking_logs').insert({
        booking_id: booking.id,
        message: 'No-show automatique — frais de réservation retenus',
      });

      // ⚠️ AJOUT (audit LOT 3, 26/07) : jusqu'ici aucune notification —
      // ni client ni pro n'apprenaient qu'un no-show venait d'être enregistré.
      // Ton client volontairement neutre : le no-show peut être un empêchement
      // légitime, on constate une absence, on n'accuse pas.
      const dateFormatted = new Date((booking as any).date + 'T12:00:00').toLocaleDateString('fr-FR', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      });
      for (const mb of paidMembers) {
        const emailTo = resolveMemberRecipientEmail(mb as any, booking as any);
        if (emailTo) {
          await sendEmail({
            to: emailTo,
            subject: `Absence constatée — ${(booking as any).biz_name}`,
            text: `Bonjour ${(mb as any).name || ''},\n\nNous n'avons pas pu confirmer votre présence à votre rendez-vous chez ${(booking as any).biz_name}.\n\n💆 Prestation : ${(booking as any).service_name}\n📅 Date : ${dateFormatted}\n🕐 Heure : ${formatTime((booking as any).time)}\n\nSi vous avez été empêché(e), nous en sommes désolés. Conformément à nos conditions, les frais de réservation restent acquis au professionnel en compensation du créneau bloqué.\n\nSi vous pensez qu'il y a une erreur, contactez-nous à contact@book-n-pay.com.\n\nL'équipe Book'nPay`,
          }).catch(() => {});
        }
        await notifyProNoShow(supabase, booking.id, { memberName: (mb as any).name || null });
      }

      console.log(
        `[NoShow] No-show automatique — ${booking.biz_name} | ${booking.date} ${booking.time} | ${paidMembers.length} membre(s)`
      );
    }
  );

  await notifyAdminOnFailure('check-no-shows:flash-slots', flashResult);
  await notifyAdminOnFailure('check-no-shows', noShowResult);

  return NextResponse.json({
    checked: bookings?.length || 0,
    noShows: noShowResult.processed,
    flashSlotsExpired: flashResult.processed,
    failed: noShowResult.failed + flashResult.failed,
    timestamp: now.toISOString(),
  });
}
