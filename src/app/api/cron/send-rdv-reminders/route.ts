// src/app/api/cron/send-rdv-reminders/route.ts
// Port de base44/functions/sendRdvReminders/entry.ts
// Tourne quotidiennement (voir vercel.json), envoie un rappel pour les RDV
// du lendemain à tous les membres payés.
import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { sendEmail } from '@/lib/email/send';
import { getParisTomorrowStr } from '@/lib/booking-utils';
import { isValidBearerSecret } from '@/lib/constant-time';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!isValidBearerSecret(authHeader, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const tomorrowStr = getParisTomorrowStr();

  const { data: bookings } = await supabase
    .from('bookings')
    .select('*, booking_members(*)')
    .eq('date', tomorrowStr)
    .neq('status', 'cancelled');

  console.log(`[Rappels] ${bookings?.length || 0} RDV demain (${tomorrowStr})`);

  // Opt-out pro — défaut TRUE (absence de préférence = envoi, comme avant
  // le câblage de ce flag). Ne pas confondre avec un défaut "false" : ce
  // cron envoyait déjà à 100% des business, câbler avec un défaut false
  // aurait coupé les rappels en masse au déploiement (voir
  // NotificationsConfig.tsx pour le raisonnement complet).
  const bizIds = [...new Set((bookings || []).map((b) => b.biz_id))];
  const { data: settingsRows } = bizIds.length > 0
    ? await supabase.from('business_settings').select('biz_id, notification_prefs').in('biz_id', bizIds)
    : { data: [] };
  const optedOutBizIds = new Set(
    (settingsRows || [])
      .filter((s) => (s.notification_prefs as Record<string, boolean> | null)?.reminderH24 === false)
      .map((s) => s.biz_id)
  );

  let sent = 0;

  for (const booking of bookings || []) {
    if (optedOutBizIds.has(booking.biz_id)) continue;
    const recipients = (booking.booking_members || []).filter((m: any) => m.status === 'paid');

    for (const member of recipients) {
      if (!member.name) continue;

      const email = member.phone === booking.client_phone ? booking.client_email : null;

      if (!email) {
        console.warn(`[Rappels] Pas d'email pour ${member.name} — rappel ignoré`);
        continue;
      }

      await sendEmail({
        to: email,
        subject: `📅 Rappel : votre RDV demain chez ${booking.biz_name}`,
        text: `Bonjour ${member.name},

Rappel : vous avez un rendez-vous demain ${booking.date} à ${booking.time} chez ${booking.biz_name} pour "${booking.service_name}".

Pensez à être à l'heure. Votre code QR d'accès : ${member.qr_code}

⚠️ En cas d'empêchement, vous pouvez annuler depuis l'application Book'nPay (remboursement possible jusqu'à 48h avant le RDV).

À bientôt,
L'équipe Book'nPay`,
      });
      sent++;
    }
  }

  return NextResponse.json({ success: true, rdvDemain: bookings?.length || 0, emailsEnvoyes: sent });
}
