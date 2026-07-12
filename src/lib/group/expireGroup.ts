import Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendEmail } from '@/lib/email/send';
import { depositRefundAmountCents } from '@/lib/refunds';

export async function expireGroupByRef(
  ref: string,
  supabase: SupabaseClient,
  stripe: Stripe,
): Promise<{ expired: boolean }> {
  const { data: groupBookings } = await supabase
    .from('bookings')
    .select('id, status, client_email, biz_name, service_name, date, time, booking_members(id, name, status, email, deposit, stripe_payment_intent_id)')
    .eq('group_ref', ref);

  const allBks = groupBookings ?? [];
  const allMembers = allBks.flatMap((b: any) => b.booking_members ?? []);
  const activeMembers = allMembers.filter((m: any) => m.status !== 'cancelled');
  const paidMembers = activeMembers.filter((m: any) => m.status === 'paid' || m.status === 'arrived');
  const unpaidMembers = activeMembers.filter((m: any) => m.status === 'invite');

  if (unpaidMembers.length === 0 && paidMembers.length > 0) {
    await supabase
      .from('bookings')
      .update({ status: 'complete' })
      .eq('group_ref', ref)
      .neq('status', 'complete');
    return { expired: false };
  }

  const firstBk = allBks[0];
  const dateFormatted = firstBk
    ? new Date(firstBk.date + 'T12:00:00').toLocaleDateString('fr-FR', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      })
    : '';

  await supabase
    .from('bookings')
    .update({ status: 'cancelled' })
    .eq('group_ref', ref);

  for (const bk of allBks) {
    for (const member of (bk as any).booking_members ?? []) {
      if (member.status === 'paid' && member.stripe_payment_intent_id) {
        try {
          await stripe.refunds.create({
            payment_intent: member.stripe_payment_intent_id,
            // Ne rembourse que les frais de réservation — les frais de
            // gestion Book'nPay restent acquis même sur une expiration de groupe.
            amount: depositRefundAmountCents(member.deposit),
            metadata: { reason: 'group_expired', group_ref: ref },
          });
          await supabase
            .from('booking_members')
            .update({ status: 'cancelled', montant_rembourse: member.deposit ?? 0 })
            .eq('id', member.id);

          const emailTo = member.email || (bk as any).client_email;
          if (emailTo) {
            await sendEmail({
              to: emailTo,
              subject: `💸 Remboursement — Groupe expiré Book'nPay`,
              text: `Bonjour ${member.name || 'vous'},\n\nMalheureusement, le délai de paiement pour votre réservation de groupe est expiré car tous les participants n'ont pas confirmé à temps.\n\n📍 ${(bk as any).biz_name}\n💆 ${(bk as any).service_name}\n📅 ${dateFormatted}\n\nVotre réservation a été annulée et vos frais de réservation (${member.deposit ?? 0}€) vous seront remboursés sous 5 à 10 jours ouvrés.\n\nNous sommes désolés pour la gêne occasionnée.\nL'équipe Book'nPay`,
            }).catch(() => {});
          }
        } catch (err: any) {
          console.error(`[expireGroup] Remboursement échoué membre ${member.id}:`, err.message);
        }
      } else if (member.status === 'invite') {
        await supabase
          .from('booking_members')
          .update({ status: 'cancelled' })
          .eq('id', member.id);

        const emailTo = member.email || (bk as any).client_email;
        if (emailTo) {
          await sendEmail({
            to: emailTo,
            subject: `❌ Réservation de groupe annulée — Book'nPay`,
            text: `Bonjour ${member.name || 'vous'},\n\nLe délai de paiement pour la réservation de groupe est expiré. Tous les participants n'ont pas confirmé dans les 20 minutes.\n\n📍 ${(bk as any).biz_name}\n💆 ${(bk as any).service_name}\n📅 ${dateFormatted}\n\nVotre place a été libérée. Aucun montant ne vous a été débité.\n\nN'hésitez pas à effectuer une nouvelle réservation sur book-n-pay.com\nL'équipe Book'nPay`,
          }).catch(() => {});
        }
      }
    }
  }

  console.log(`[expireGroup] Groupe ${ref} expiré — ${paidMembers.length} remboursements, ${unpaidMembers.length} annulations`);
  return { expired: true };
}
