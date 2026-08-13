// src/app/api/cron/send-rdv-reminders/route.ts
// Port de base44/functions/sendRdvReminders/entry.ts
// Tourne quotidiennement (voir vercel.json), envoie un rappel pour les RDV
// du lendemain à tous les membres payés.
import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { sendEmail, emailTemplate, qrCheckinBlockHtml, escapeHtml } from '@/lib/email/send';
import { getParisTomorrowStr, formatTime, resolveMemberRecipientEmail } from '@/lib/booking-utils';
import { isValidBearerSecret } from '@/lib/constant-time';
import { processBatch } from '@/lib/cron-batch';
import { notifyAdminOnFailure } from '@/lib/notify-admin';
import { generateQrPngBase64 } from '@/lib/qr';

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

  // Aplati (booking × membre) en une liste plate de destinataires — un
  // sendEmail() qui échoue pour l'un ne doit isoler que lui, pas bloquer les
  // suivants (même classe de bug qu'expire-groups, incident 22/07).
  const recipients: { booking: NonNullable<typeof bookings>[number]; member: any; email: string }[] = [];
  for (const booking of bookings || []) {
    if (optedOutBizIds.has(booking.biz_id)) continue;
    const paidMembers = (booking.booking_members || []).filter((m: any) => m.status === 'paid');

    for (const member of paidMembers) {
      if (!member.name) continue;
      const email = resolveMemberRecipientEmail(member, booking);
      if (!email) {
        console.warn(`[Rappels] Pas d'email pour ${member.name} — rappel ignoré`);
        continue;
      }
      recipients.push({ booking, member, email });
    }
  }

  const result = await processBatch(
    recipients,
    'send-rdv-reminders',
    (r) => `${r.member.name} <${r.email}> (${r.booking.biz_name} ${r.booking.date})`,
    async ({ booking, member, email }) => {
      // QR check-in (LOT 5, C6) — best-effort, ne doit jamais bloquer l'envoi
      // du rappel lui-même (même filet que le webhook de confirmation).
      let qrAttachment: { filename: string; content: string; contentId: string } | null = null;
      if (member.qr_code) {
        try {
          qrAttachment = {
            filename: 'checkin-qr.png',
            content: await generateQrPngBase64(member.qr_code),
            contentId: 'checkin-qr',
          };
        } catch (e: any) {
          console.warn('[Rappels] Génération QR échouée (email envoyé sans image):', e.message);
        }
      }

      await sendEmail({
        to: email,
        subject: `📅 Rappel : votre RDV demain chez ${booking.biz_name}`,
        text: `Bonjour ${member.name},

Rappel : vous avez un rendez-vous demain ${booking.date} à ${formatTime(booking.time)} chez ${booking.biz_name} pour "${booking.service_name}".

Pensez à être à l'heure. Votre code QR d'accès : ${member.qr_code}

⚠️ En cas d'empêchement, vous pouvez annuler depuis l'application Book'nPay (remboursement possible jusqu'à 48h avant le RDV).

À bientôt,
L'équipe Book'nPay`,
        html: emailTemplate(`
          <h2 style="color: #34d399; font-size: 20px; margin: 0 0 12px;">Rappel de RDV demain</h2>
          <p style="color: #cbd5e1; font-size: 14px; line-height: 1.6; margin: 0 0 4px;">Bonjour ${escapeHtml(member.name)},</p>
          <p style="color: #cbd5e1; font-size: 14px; line-height: 1.6; margin: 0 0 16px;">
            Vous avez un rendez-vous demain <strong>${escapeHtml(booking.date)} à ${escapeHtml(formatTime(booking.time))}</strong>
            chez ${escapeHtml(booking.biz_name)} pour « ${escapeHtml(booking.service_name)} ».
          </p>
          ${member.qr_code ? qrCheckinBlockHtml(member.qr_code, 'checkin-qr') : ''}
          <p style="color: #94a3b8; font-size: 12px; line-height: 1.6; margin: 16px 0 0;">
            En cas d&apos;empêchement, vous pouvez annuler depuis l&apos;application Book&apos;nPay (remboursement possible jusqu&apos;à 48h avant le RDV).
          </p>
        `),
        ...(qrAttachment ? { attachments: [qrAttachment] } : {}),
      });
    }
  );

  await notifyAdminOnFailure('send-rdv-reminders', result);

  return NextResponse.json({
    success: true,
    rdvDemain: bookings?.length || 0,
    emailsEnvoyes: result.processed,
    failed: result.failed,
  });
}
