// src/app/api/cron/expire-groups/route.ts
// Déclenché chaque nuit à 2h UTC (vercel.json "0 2 * * *") — plan Hobby limite à 1x/jour.
// Pour chaque groupe dont le payment_deadline est dépassé :
//   - Si tous les membres sont payés → marque complete (cas où le webhook aurait raté)
//   - Sinon → annule l'ensemble du groupe + remboursement Stripe des membres payés
//     + emails différenciés (payés → remboursé, non-payés → expiré)
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { sendEmail } from '@/lib/email/send';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  const now = new Date().toISOString();

  // Chercher les bookings de groupe expirés encore actifs
  const { data: expiredRows } = await supabase
    .from('bookings')
    .select('group_ref')
    .not('payment_deadline', 'is', null)
    .lt('payment_deadline', now)
    .eq('status', 'active')
    .not('group_ref', 'is', null);

  const groupRefs = [...new Set((expiredRows ?? []).map((r) => r.group_ref as string))];

  if (groupRefs.length === 0) {
    return NextResponse.json({ processed: 0 });
  }

  let processed = 0;
  let refunded = 0;
  let cancelled = 0;

  for (const ref of groupRefs) {
    const { data: groupBookings } = await supabase
      .from('bookings')
      .select('id, status, client_email, client_name, biz_name, service_name, date, time, booking_members(id, name, status, email, deposit, stripe_payment_intent_id)')
      .eq('group_ref', ref);

    const allBks = groupBookings ?? [];
    const allMembers = allBks.flatMap((b: any) => b.booking_members ?? []);
    const activeMembers = allMembers.filter((m: any) => m.status !== 'cancelled');
    const paidMembers = activeMembers.filter((m: any) => m.status === 'paid' || m.status === 'arrived');
    const unpaidMembers = activeMembers.filter((m: any) => m.status === 'invite');

    // Cas 1 : tout le monde a payé → le webhook a dû rater l'email/status
    if (unpaidMembers.length === 0 && paidMembers.length > 0) {
      await supabase
        .from('bookings')
        .update({ status: 'complete' })
        .eq('group_ref', ref)
        .neq('status', 'complete');
      console.log(`[expire-groups] Groupe ${ref} → complete (tous payés, webhook rattrapé)`);
      processed++;
      continue;
    }

    // Cas 2 : des membres n'ont pas payé → annuler et rembourser
    const firstBk = allBks[0];
    const dateFormatted = firstBk
      ? new Date(firstBk.date + 'T12:00:00').toLocaleDateString('fr-FR', {
          weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
        })
      : '';

    // Annuler tous les bookings du groupe
    await supabase
      .from('bookings')
      .update({ status: 'cancelled' })
      .eq('group_ref', ref);

    for (const bk of allBks) {
      for (const member of (bk as any).booking_members ?? []) {
        if (member.status === 'paid' && member.stripe_payment_intent_id) {
          // Rembourser via Stripe
          try {
            await stripe.refunds.create({
              payment_intent: member.stripe_payment_intent_id,
              metadata: { reason: 'group_expired', group_ref: ref },
            });
            await supabase
              .from('booking_members')
              .update({ status: 'cancelled', montant_rembourse: member.deposit ?? 0 })
              .eq('id', member.id);
            refunded++;

            // Email aux membres payés — remboursement
            const emailTo = member.email || (bk as any).client_email;
            if (emailTo) {
              await sendEmail({
                to: emailTo,
                subject: `💸 Remboursement — Groupe expiré Book'nPay`,
                text: `Bonjour ${member.name || 'vous'},\n\nMalheureusement, le délai de paiement pour votre réservation de groupe est expiré car tous les participants n'ont pas confirmé à temps.\n\n📍 ${(bk as any).biz_name}\n💆 ${(bk as any).service_name}\n📅 ${dateFormatted}\n\nVotre réservation a été annulée et vos frais de réservation (${member.deposit ?? 0}€) vous seront remboursés sous 5 à 10 jours ouvrés.\n\nNous sommes désolés pour la gêne occasionnée.\nL'équipe Book'nPay`,
              }).catch(() => {});
            }
          } catch (err: any) {
            console.error(`[expire-groups] Remboursement échoué membre ${member.id}:`, err.message);
          }
        } else if (member.status === 'invite') {
          await supabase
            .from('booking_members')
            .update({ status: 'cancelled' })
            .eq('id', member.id);
          cancelled++;

          // Email aux membres non-payés — groupe expiré
          const emailTo = member.email || (bk as any).client_email;
          if (emailTo) {
            await sendEmail({
              to: emailTo,
              subject: `❌ Réservation de groupe annulée — Book'nPay`,
              text: `Bonjour ${member.name || 'vous'},\n\nLe délai de paiement pour la réservation de groupe est expiré. Tous les participants n'ont pas confirmé dans les 20 minutes.\n\n📍 ${(bk as any).biz_name}\n💆 ${(bk as any).service_name}\n📅 ${dateFormatted}\n\nVotre place a été libérée. Vous n'avez rien à faire, aucun montant ne vous a été débité.\n\nN'hésitez pas à effectuer une nouvelle réservation sur book-n-pay.com\nL'équipe Book'nPay`,
            }).catch(() => {});
          }
        }
      }
    }

    console.log(`[expire-groups] Groupe ${ref} expiré — ${paidMembers.length} remboursements, ${unpaidMembers.length} annulations`);
    processed++;
  }

  return NextResponse.json({ processed, refunded, cancelled });
}
