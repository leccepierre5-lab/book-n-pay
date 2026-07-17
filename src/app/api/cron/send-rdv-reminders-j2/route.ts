// src/app/api/cron/send-rdv-reminders-j2/route.ts
// Deuxième rappel avant RDV, envoyé aux clients dont le RDV a lieu dans 2
// jours (en plus du rappel existant à J-1 dans send-rdv-reminders). Même
// logique, ciblé sur "aujourd'hui + 2 jours" au lieu de "demain".
import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { sendEmail } from '@/lib/email/send';
import { getParisDateOffsetStr } from '@/lib/booking-utils';
import { isValidBearerSecret } from '@/lib/constant-time';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!isValidBearerSecret(authHeader, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const targetDateStr = getParisDateOffsetStr(2);

  const { data: bookings } = await supabase
    .from('bookings')
    .select('*, booking_members(*)')
    .eq('date', targetDateStr)
    .neq('status', 'cancelled');

  console.log(`[Rappels J-2] ${bookings?.length || 0} RDV dans 2 jours (${targetDateStr})`);

  // Opt-out pro — clé "reminderH2" côté notification_prefs (nom hérité de
  // l'ancien libellé UI "H-2", jamais renommé en base pour ne pas invalider
  // une préférence déjà enregistrée — seul le libellé affiché a changé,
  // voir NotificationsConfig.tsx). Défaut TRUE, même raisonnement que
  // send-rdv-reminders/route.ts (ce cron envoyait déjà à tout le monde).
  const bizIds = [...new Set((bookings || []).map((b) => b.biz_id))];
  const { data: settingsRows } = bizIds.length > 0
    ? await supabase.from('business_settings').select('biz_id, notification_prefs').in('biz_id', bizIds)
    : { data: [] };
  const optedOutBizIds = new Set(
    (settingsRows || [])
      .filter((s) => (s.notification_prefs as Record<string, boolean> | null)?.reminderH2 === false)
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
        console.warn(`[Rappels J-2] Pas d'email pour ${member.name} — rappel ignoré`);
        continue;
      }

      await sendEmail({
        to: email,
        subject: `📅 Rappel : votre RDV dans 2 jours chez ${booking.biz_name}`,
        text: `Bonjour ${member.name},

Petit rappel : vous avez un rendez-vous le ${booking.date} à ${booking.time} chez ${booking.biz_name} pour "${booking.service_name}".

⚠️ En cas d'empêchement, vous pouvez annuler depuis l'application Book'nPay (remboursement possible jusqu'à 48h avant le RDV).

À bientôt,
L'équipe Book'nPay`,
      });
      sent++;
    }
  }

  return NextResponse.json({ success: true, rdvDansDeuxJours: bookings?.length || 0, emailsEnvoyes: sent });
}
