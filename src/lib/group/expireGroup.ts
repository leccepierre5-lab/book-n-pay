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
    // Filet de course — cette branche protège contre une lecture juste avant
    // que le webhook checkout.session.completed (temps réel) n'ait fini de
    // marquer tout le groupe 'completed' (section "Complétion de groupe",
    // stripe/webhook/route.ts). Rarement atteinte en pratique : le webhook
    // devance quasi toujours ce code (appelé par le cron quotidien
    // expire-groups OU par le polling lazy group/pending-status), d'où 0
    // ligne 'complete' observée en base au 17/07 malgré ce bug de frappe
    // vieux de plusieurs sessions (commit 2dae9c4) — pas du code mort
    // (chemin réellement atteignable), juste une fenêtre de course étroite.
    // 'completed' est la seule valeur valide de l'enum (active/cancelled/
    // completed) — 'complete' (sans d) échouait silencieusement ici.
    await supabase
      .from('bookings')
      .update({ status: 'completed' })
      .eq('group_ref', ref)
      .neq('status', 'completed');
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
              text: `Bonjour ${member.name || 'vous'},\n\nMalheureusement, le délai de paiement pour votre réservation de groupe est expiré car tous les participants n'ont pas confirmé à temps.\n\n📍 ${(bk as any).biz_name}\n💆 ${(bk as any).service_name}\n📅 ${dateFormatted}\n\nVotre réservation a été annulée et vos frais de réservation (${member.deposit ?? 0}€) vous seront remboursés sous 5 à 10 jours ouvrés (hors frais de gestion, non remboursables).\n\nVous pouvez reprendre votre réservation en solo dès maintenant si vous le souhaitez, sans attendre les autres participants.\n\nNous sommes désolés pour la gêne occasionnée.\nL'équipe Book'nPay`,
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
            text: `Bonjour ${member.name || 'vous'},\n\nLe délai de paiement pour la réservation de groupe est expiré. Tous les participants n'ont pas confirmé dans les 20 minutes.\n\n📍 ${(bk as any).biz_name}\n💆 ${(bk as any).service_name}\n📅 ${dateFormatted}\n\nVotre place a été libérée. Aucun montant ne vous a été débité.\n\nVous pouvez reprendre votre réservation en solo dès maintenant si vous le souhaitez, sans attendre les autres participants.\n\nL'équipe Book'nPay`,
          }).catch(() => {});
        }
      }
    }
  }

  console.log(`[expireGroup] Groupe ${ref} expiré — ${paidMembers.length} remboursements, ${unpaidMembers.length} annulations`);
  return { expired: true };
}
