// src/app/api/cron/send-rdv-reminders/route.ts
// Port de base44/functions/sendRdvReminders/entry.ts
// Tourne quotidiennement (voir vercel.json), envoie un rappel pour les RDV
// du lendemain à tous les membres payés.
import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { sendEmail } from '@/lib/email/send';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];

  const { data: bookings } = await supabase
    .from('bookings')
    .select('*, booking_members(*)')
    .eq('date', tomorrowStr)
    .eq('status', 'active');

  console.log(`[Rappels] ${bookings?.length || 0} RDV demain (${tomorrowStr})`);

  let sent = 0;

  for (const booking of bookings || []) {
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
