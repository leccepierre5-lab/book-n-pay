// src/app/api/cron/send-rdv-reminders-j2/route.ts
// Deuxième rappel avant RDV, envoyé aux clients dont le RDV a lieu dans 2
// jours (en plus du rappel existant à J-1 dans send-rdv-reminders). Même
// logique, ciblé sur "aujourd'hui + 2 jours" au lieu de "demain".
import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { sendEmail, emailTemplate, qrCheckinBlockHtml, escapeHtml } from '@/lib/email/send';
import { getParisDateOffsetStr, formatTime, resolveMemberRecipientEmail } from '@/lib/booking-utils';
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
        console.warn(`[Rappels J-2] Pas d'email pour ${member.name} — rappel ignoré`);
        continue;
      }
      recipients.push({ booking, member, email });
    }
  }

  const result = await processBatch(
    recipients,
    'send-rdv-reminders-j2',
    (r) => `${r.member.name} <${r.email}> (${r.booking.biz_name} ${r.booking.date})`,
    async ({ booking, member, email }) => {
      // QR check-in (LOT 5, C6) — même filet que send-rdv-reminders/webhook :
      // best-effort, ne bloque jamais l'envoi du rappel lui-même.
      let qrAttachment: { filename: string; content: string; contentId: string } | null = null;
      if (member.qr_code) {
        try {
          qrAttachment = {
            filename: 'checkin-qr.png',
            content: await generateQrPngBase64(member.qr_code),
            contentId: 'checkin-qr',
          };
        } catch (e: any) {
          console.warn('[Rappels J-2] Génération QR échouée (email envoyé sans image):', e.message);
        }
      }

      await sendEmail({
        to: email,
        subject: `📅 Rappel : votre RDV dans 2 jours chez ${booking.biz_name}`,
        text: `Bonjour ${member.name},

Petit rappel : vous avez un rendez-vous le ${booking.date} à ${formatTime(booking.time)} chez ${booking.biz_name} pour "${booking.service_name}".

${member.qr_code ? `Votre code QR d'accès : ${member.qr_code}\n\n` : ''}⚠️ En cas d'empêchement, vous pouvez annuler depuis l'application Book'nPay (remboursement possible jusqu'à 48h avant le RDV).

À bientôt,
L'équipe Book'nPay`,
        html: emailTemplate(`
          <h2 style="color: #34d399; font-size: 20px; margin: 0 0 12px;">Rappel de RDV dans 2 jours</h2>
          <p style="color: #cbd5e1; font-size: 14px; line-height: 1.6; margin: 0 0 4px;">Bonjour ${escapeHtml(member.name)},</p>
          <p style="color: #cbd5e1; font-size: 14px; line-height: 1.6; margin: 0 0 16px;">
            Vous avez un rendez-vous le <strong>${escapeHtml(booking.date)} à ${escapeHtml(formatTime(booking.time))}</strong>
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

  await notifyAdminOnFailure('send-rdv-reminders-j2', result);

  return NextResponse.json({
    success: true,
    rdvDansDeuxJours: bookings?.length || 0,
    emailsEnvoyes: result.processed,
    failed: result.failed,
  });
}
