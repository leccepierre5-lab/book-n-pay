// src/app/api/bookings/cancel/route.ts
// Port de base44/functions/refundClientBooking/entry.ts — version simplifiée
// car on stocke déjà stripe_payment_intent_id sur booking_members (pas besoin
// de chercher la session par pagination comme le faisait Base44).
//
// Règle CGV reprise des emails Base44 : remboursement intégral des frais de
// réservation si annulation > 48h avant le RDV ; sinon les frais restent
// acquis au pro (pas de remboursement). Les frais de gestion ne sont jamais
// remboursés. Cette route applique cette règle — elle ne se contente pas de
// rembourser sur simple demande.
//
// ⚠️ CORRECTIF DE SÉCURITÉ (trouvé en audit) : la route vérifiait juste la
// présence d'une session, jamais que l'utilisateur connecté correspondait
// au créateur du booking ou au membre ciblé. N'importe quel utilisateur
// authentifié pouvait annuler/rembourser la réservation de quelqu'un
// d'autre en devinant un bookingId/memberId. Corrigé en vérifiant
// l'appartenance avant toute action.
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { parseParisDatetime, phonesMatch } from '@/lib/booking-utils';
import { depositRefundAmountCents } from '@/lib/refunds';
import { sendEmail } from '@/lib/email/send';
import { logAndRespond } from '@/lib/api-error';

const CANCEL_DEADLINE_HOURS = 48;

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const { bookingId, memberId } = await req.json();
    if (!bookingId || !memberId) {
      return NextResponse.json({ error: 'bookingId et memberId requis' }, { status: 400 });
    }

    const serviceSupabase = createServiceRoleClient();

    const { data: booking } = await serviceSupabase
      .from('bookings')
      .select('*')
      .eq('id', bookingId)
      .maybeSingle();
    if (!booking) return NextResponse.json({ error: 'Réservation introuvable' }, { status: 404 });

    const { data: member } = await serviceSupabase
      .from('booking_members')
      .select('*')
      .eq('id', memberId)
      .eq('booking_id', bookingId)
      .maybeSingle();
    if (!member) return NextResponse.json({ error: 'Membre introuvable' }, { status: 404 });

    // Vérifie que l'appelant est bien le créateur du booking OU le membre
    // ciblé lui-même (identifié par son téléphone de profil) OU admin.
    const { data: callerProfile } = await supabase
      .from('app_users')
      .select('phone, role')
      .eq('id', authData.user.id)
      .single();

    const isCreator = booking.client_id === authData.user.id;
    const isTargetMember = callerProfile?.phone && phonesMatch(callerProfile.phone, member.phone);
    const isAdmin = callerProfile?.role === 'admin';

    if (!isCreator && !isTargetMember && !isAdmin) {
      return NextResponse.json({ error: 'Non autorisé à annuler cette réservation' }, { status: 403 });
    }

    if (member.status !== 'paid') {
      return NextResponse.json(
        { error: 'Seule une réservation payée peut être annulée ici (utilise le Joker pour les autres cas).' },
        { status: 400 }
      );
    }

    const rdvDateTime = parseParisDatetime(booking.date, booking.time);
    const hoursUntilRdv = (rdvDateTime.getTime() - Date.now()) / (1000 * 60 * 60);
    const eligibleForRefund = hoursUntilRdv >= CANCEL_DEADLINE_HOURS;

    let refundDone = false;
    if (eligibleForRefund && member.stripe_payment_intent_id) {
      try {
        const stripeKey = process.env.STRIPE_SECRET_KEY || process.env.STRIPE_TEST_SECRET_KEY!;
        const stripe = new Stripe(stripeKey);
        await stripe.refunds.create({
          payment_intent: member.stripe_payment_intent_id,
          // Ne rembourse que les frais de réservation — les frais de gestion
          // Book'nPay restent acquis (CGV Art. 3, déjà annoncé dans l'email
          // ci-dessous ; sans `amount` explicite Stripe rembourse tout le
          // PaymentIntent par défaut, gestion incluse).
          amount: depositRefundAmountCents(member.deposit),
          reason: 'requested_by_customer',
        });
        refundDone = true;
        console.log(`[CancelClient] ✅ Remboursement OK — booking=${bookingId} membre=${memberId}`);
      } catch (stripeErr: any) {
        console.error('[CancelClient] Erreur Stripe:', stripeErr.message);
      }
    }

    await serviceSupabase
      .from('booking_members')
      .update({ status: 'cancelled' })
      .eq('id', memberId);

    await serviceSupabase.from('booking_logs').insert({
      booking_id: bookingId,
      message: eligibleForRefund
        ? `Annulation client (>48h) — remboursement ${refundDone ? 'effectué' : 'tenté, à vérifier manuellement'}`
        : 'Annulation client (<48h) — frais de réservation conservés par le professionnel',
    });

    // Email de confirmation d'annulation au client
    const clientEmail = authData.user.email;
    if (clientEmail) {
      const dateFormatted = new Date(booking.date + 'T12:00:00').toLocaleDateString('fr-FR', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      });
      const refundLine = eligibleForRefund
        ? refundDone
          ? `✅ Remboursement de vos frais de réservation initié — crédit sous 5 à 10 jours ouvrés selon votre banque.`
          : `⚠️ Remboursement initié mais une vérification manuelle peut être nécessaire — contactez-nous si vous ne le recevez pas.`
        : `❌ Annulation à moins de 48h du RDV — les frais de réservation sont conservés par le professionnel (CGV Art. 3).`;

      await sendEmail({
        to: clientEmail,
        subject: `❌ Réservation annulée — ${booking.biz_name}`,
        text: `Bonjour ${member.name},

Votre réservation a bien été annulée.

📍 Établissement : ${booking.biz_name}
💆 Prestation : ${booking.service_name}
📅 Date : ${dateFormatted}
🕐 Heure : ${booking.time}

${refundLine}

⚠️ Rappel : les frais de gestion Book'nPay ne sont jamais remboursés (CGV Art. 3).

Si vous avez des questions : contact@book-n-pay.com

À bientôt,
L'équipe Book'nPay`,
      }).catch(() => {});
    }

    return NextResponse.json({
      success: true,
      refundDone,
      eligibleForRefund,
      hoursUntilRdv: Math.round(hoursUntilRdv),
    });
  } catch (error: any) {
    return logAndRespond('[CancelClient] Erreur:', error);
  }
}
