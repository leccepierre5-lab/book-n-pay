// src/app/api/stripe/webhook/route.ts
// Port de base44/functions/stripeWebhook/entry.ts
//
// ⚠️ Sur Vercel, désactive le bodyParser par défaut via `export const config`
// n'est plus nécessaire avec l'App Router : req.text() lit déjà le body brut,
// ce qui est obligatoire pour la vérification de signature Stripe.
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { sendEmail } from '@/lib/email/send';

export async function POST(req: NextRequest) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  const body = await req.text();
  const sig = req.headers.get('stripe-signature');
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig!, webhookSecret);
  } catch (err: any) {
    console.error('[Webhook] Signature invalide:', err.message);
    return new NextResponse(`Webhook Error: ${err.message}`, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  console.log('[Webhook] Événement reçu:', event.type);

  // ── PAIEMENT CONFIRMÉ ────────────────────────────────────────────────────
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const meta = session.metadata || {};
    const bookingId = meta.bookingId;
    const memberId = meta.memberId;
    const groupRef = meta.groupRef || '';
    const dep = meta.depositAmount
      ? parseFloat(meta.depositAmount)
      : Math.max(0, (session.amount_total || 0) / 100 - 1.99);

    if (!bookingId || !memberId) {
      console.warn('[Webhook] Métadonnées manquantes — bookingId ou memberId absent');
      return NextResponse.json({ received: true });
    }

    try {
      const { data: member } = await supabase
        .from('booking_members')
        .select('*')
        .eq('id', memberId)
        .eq('booking_id', bookingId)
        .maybeSingle();

      // Idempotence : si déjà payé/arrivé, on ignore (webhook potentiellement rejoué)
      if (member?.status === 'paid' || member?.status === 'arrived') {
        console.warn(`[Webhook] Membre ${memberId} déjà 'paid' — ignoré (idempotent)`);
        return NextResponse.json({ received: true });
      }

      await supabase
        .from('booking_members')
        .update({
          status: 'paid',
          deposit: dep,
          stripe_payment_intent_id:
            typeof session.payment_intent === 'string' ? session.payment_intent : null,
          stripe_checkout_session_id: session.id,
        })
        .eq('id', memberId)
        .eq('booking_id', bookingId);

      console.log(`[Webhook] ✅ Paiement validé — booking ${bookingId}, membre ${memberId}, ${dep}€`);

      // ── Consommation de la réduction de parrainage ────────────────────────
      // Déclenché uniquement si le paiement est confirmé (jamais sur session abandonnée)
      const clientUserId = meta.clientUserId || '';
      const referralDiscountPct = parseInt(meta.referralDiscountPct || '0', 10);
      if (clientUserId && referralDiscountPct > 0) {
        // Stocker le % de réduction dans booking_members pour que la caisse recalcule
        // le bon solde (prix réduit - dépôt)
        if (memberId) {
          await supabase
            .from('booking_members')
            .update({ referral_discount_pct: referralDiscountPct })
            .eq('id', memberId);
        }

        // Consommer la réduction : remettre à 0
        await supabase
          .from('app_users')
          .update({ pending_referral_discount_pct: 0 })
          .eq('id', clientUserId);

        // Marquer l'événement de parrainage le plus ancien non-consommé comme utilisé
        const { data: unconsumedEvent } = await supabase
          .from('referral_events')
          .select('id')
          .eq('referrer_id', clientUserId)
          .eq('parrain_discount_consumed', false)
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle();

        if (unconsumedEvent) {
          await supabase
            .from('referral_events')
            .update({
              parrain_discount_consumed: true,
              parrain_discount_consumed_at: new Date().toISOString(),
            })
            .eq('id', unconsumedEvent.id);
        }

        console.log(`[Parrainage] Réduction -${referralDiscountPct}% consommée pour user=${clientUserId}`);
      }

      // Mode A groupe : l'organisateur a payé pour tous — marquer chaque membre
      const allMemberIds = meta.allMemberIds
        ? meta.allMemberIds.split(',').map((s: string) => s.trim()).filter(Boolean)
        : [];
      if (allMemberIds.length > 1) {
        // Vérification de cohérence montant : alerte si le total Stripe ne correspond pas
        // au calcul attendu (N × dépôt + fraisGestion). Non bloquant — le paiement est
        // déjà encaissé par Stripe ; c'est un filet de sécurité contre nos propres bugs.
        const metaFrais = parseFloat(meta.fraisGestion || '0');
        const metaQty = parseInt(meta.groupQuantity || '1', 10);
        const expectedTotal = Math.round((dep * metaQty + metaFrais) * 100);
        const actualTotal = session.amount_total || 0;
        if (metaFrais > 0 && Math.abs(expectedTotal - actualTotal) > 2) {
          console.error(
            `[Webhook] ⚠️ MONTANT INATTENDU Mode A — groupRef=${groupRef}` +
            ` attendu=${expectedTotal / 100}€ (${metaQty}×${dep}+${metaFrais})` +
            ` reçu=${actualTotal / 100}€ — paiement accepté, investigation requise`
          );
        }

        const otherIds = allMemberIds.filter((id: string) => id !== memberId);
        if (otherIds.length > 0) {
          await supabase
            .from('booking_members')
            .update({
              status: 'paid',
              deposit: dep,
              stripe_payment_intent_id:
                typeof session.payment_intent === 'string' ? session.payment_intent : null,
              stripe_checkout_session_id: session.id,
            })
            .in('id', otherIds)
            .neq('status', 'paid');
          console.log(`[Webhook] Mode A — ${otherIds.length} membres supplémentaires marqués paid`);
        }
      }

      // member_ref (ancien flow rejoindre) : même participant sur plusieurs bookings
      if (groupRef && member?.member_ref && allMemberIds.length <= 1) {
        const { data: groupMembers } = await supabase
          .from('booking_members')
          .select('id, booking_id, status')
          .eq('member_ref', member.member_ref)
          .neq('booking_id', bookingId);

        for (const gm of groupMembers || []) {
          if (gm.status !== 'paid') {
            await supabase
              .from('booking_members')
              .update({ status: 'paid', deposit: dep })
              .eq('id', gm.id);
          }
        }
      }

      // Email de confirmation
      const { data: booking } = await supabase
        .from('bookings')
        .select('biz_name, service_name, staff_name, date, time')
        .eq('id', bookingId)
        .single();

      const customerEmail = session.customer_details?.email || meta.clientEmail || '';
      if (customerEmail && booking && member) {
        const dateFormatted = new Date(booking.date + 'T12:00:00').toLocaleDateString('fr-FR', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        });
        await sendEmail({
          to: customerEmail,
          subject: `✅ Réservation confirmée — ${booking.biz_name}`,
          text: `Bonjour ${member.name},

Votre réservation est confirmée ! 🎉

📍 Établissement : ${booking.biz_name}
💆 Prestation : ${booking.service_name}${booking.staff_name ? `\n👤 Praticien : ${booking.staff_name}` : ''}
📅 Date : ${dateFormatted}
🕐 Heure : ${booking.time}
💶 Frais de réservation versés : ${dep}€

Votre code QR de check-in : ${member.qr_code || 'N/A'}
Présentez ce code à l'accueil le jour J.

ℹ️ Conditions :
• Vous venez → les frais de réservation sont déduits du montant final.
• Vous annulez > 48h avant → remboursement des frais de réservation.
• Vous annulez < 48h avant ou no-show → frais conservés par le professionnel.
• Le professionnel annule → remboursement intégral de vos frais de réservation.

⚠️ Note : les frais de gestion Book'nPay ne sont pas remboursés (CGV Art. 3).

À bientôt !
L'équipe Book'nPay`,
        });
      }
    } catch (err: any) {
      console.error('[Webhook] Erreur mise à jour booking:', err.message);
    }
  }

  // ── REMBOURSEMENT ────────────────────────────────────────────────────────
  if (event.type === 'charge.refunded') {
    const charge = event.data.object as Stripe.Charge;
    let meta = charge.metadata || {};

    if ((!meta.bookingId || !meta.memberId) && charge.payment_intent) {
      try {
        const pi = await stripe.paymentIntents.retrieve(charge.payment_intent as string);
        meta = { ...meta, ...(pi.metadata || {}) };
      } catch (e: any) {
        console.warn('[Webhook] Impossible de récupérer le PaymentIntent:', e.message);
      }
    }

    const bookingId = meta.bookingId;
    const memberId = meta.memberId;
    const refundedAmount = charge.amount_refunded / 100;
    const customerEmail = charge.billing_details?.email || meta.clientEmail || '';
    const customerName = charge.billing_details?.name || meta.clientName || 'Client';

    if (bookingId && memberId) {
      await supabase
        .from('booking_members')
        .update({ status: 'cancelled' })
        .eq('id', memberId)
        .eq('booking_id', bookingId);
    }

    if (customerEmail) {
      await sendEmail({
        to: customerEmail,
        subject: `💸 Remboursement effectué — Book'nPay`,
        text: `Bonjour ${customerName},

Votre remboursement de ${refundedAmount}€ a bien été traité.

Le montant sera crédité sur votre moyen de paiement d'origine sous 5 à 10 jours ouvrés selon votre banque.

⚠️ Note : les frais de gestion Book'nPay ne sont pas remboursés conformément aux CGV Art. 3.

Si vous avez des questions, contactez-nous à Booknpay.64@gmail.com

À bientôt,
L'équipe Book'nPay`,
      });
    }
  }

  return NextResponse.json({ received: true });
}
