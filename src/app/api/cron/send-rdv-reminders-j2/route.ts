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
    .eq('status', 'active');

  console.log(`[Rappels J-2] ${bookings?.length || 0} RDV dans 2 jours (${targetDateStr})`);

  let sent = 0;

  for (const booking of bookings || []) {
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
