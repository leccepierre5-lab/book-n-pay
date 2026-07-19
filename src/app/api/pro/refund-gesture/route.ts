// src/app/api/pro/refund-gesture/route.ts
// Permet au pro de rembourser un no-show "à titre de geste commercial"
// (typiquement suggéré par FicheClientIntelligente.tsx pour un client fiable).
// Différent de /api/bookings/cancel : ici c'est le PRO qui choisit,
// indépendamment de la règle des 48h (qui ne s'applique qu'aux annulations
// initiées par le client avant le RDV).
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { depositRefundAmountCents } from '@/lib/refunds';
import { cancelBookingIfNoActiveMembers } from '@/lib/booking-lifecycle';
import { sendEmail } from '@/lib/email/send';
import { logAndRespond } from '@/lib/api-error';

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const { bookingId, memberId } = await req.json();
    if (!bookingId || !memberId) {
      return NextResponse.json({ error: 'bookingId et memberId requis' }, { status: 400 });
    }

    const { data: profile } = await supabase
      .from('app_users')
      .select('role, biz_id')
      .eq('id', authData.user.id)
      .single();

    const serviceSupabase = createServiceRoleClient();
    const { data: booking } = await serviceSupabase
      .from('bookings')
      .select('biz_id, biz_name, service_name, date, time, client_email')
      .eq('id', bookingId)
      .maybeSingle();

    if (!booking) return NextResponse.json({ error: 'Réservation introuvable' }, { status: 404 });
    if (profile?.role !== 'admin' && profile?.biz_id !== booking.biz_id) {
      return NextResponse.json({ error: 'Non autorisé pour ce business' }, { status: 403 });
    }

    const { data: member } = await serviceSupabase
      .from('booking_members')
      .select('*')
      .eq('id', memberId)
      .eq('booking_id', bookingId)
      .maybeSingle();

    if (!member) return NextResponse.json({ error: 'Membre introuvable' }, { status: 404 });
    if (!member.stripe_payment_intent_id) {
      return NextResponse.json({ error: 'Aucun paiement associé à rembourser' }, { status: 400 });
    }
    // Idempotence : un double-clic (ou une requête rejouée) ne doit jamais
    // déclencher un second appel à stripe.refunds.create sur le même
    // paiement — déjà remboursé une fois, on renvoie un succès sans repasser
    // par Stripe plutôt que de laisser Stripe renvoyer une erreur ambiguë.
    if (member.status === 'cancelled') {
      return NextResponse.json({ success: true, alreadyRefunded: true });
    }

    // ⚠️ CORRECTIF SÉCURITÉ (audit) : utilisait toujours la clé live, même
    // en mode_test_paiement — un remboursement pendant un test aurait pu
    // toucher un vrai compte Stripe. Même bascule que stripe/checkout/route.ts.
    const { data: testModeConfig } = await serviceSupabase
      .from('app_config')
      .select('value')
      .eq('key', 'mode_test_paiement')
      .maybeSingle();
    const isTestMode = testModeConfig?.value === 'true';
    const stripeKey = isTestMode
      ? process.env.STRIPE_TEST_SECRET_KEY!
      : process.env.STRIPE_SECRET_KEY!;
    const stripe = new Stripe(stripeKey);
    await stripe.refunds.create({
      payment_intent: member.stripe_payment_intent_id,
      // Ne rembourse que les frais de réservation — les frais de gestion
      // Book'nPay restent acquis, même sur un geste commercial du pro.
      amount: depositRefundAmountCents(member.deposit),
      reason: 'requested_by_customer',
    });

    await serviceSupabase.from('booking_members').update({ status: 'cancelled' }).eq('id', memberId);
    // Voir lib/booking-lifecycle.ts — sans ça le créneau restait bloqué
    // pour toujours (agenda pro + anti-collision réelle).
    await cancelBookingIfNoActiveMembers(serviceSupabase, bookingId);
    await serviceSupabase.from('booking_logs').insert({
      booking_id: bookingId,
      message: `Remboursement geste commercial accordé par le professionnel`,
    });

    // Email au client — le remboursement lui-même est déjà acquis à ce stade
    // (au-dessus), un échec d'envoi ne doit jamais faire échouer la réponse.
    const clientEmail = member.email || booking.client_email;
    if (clientEmail) {
      const dateFormatted = new Date(booking.date + 'T12:00:00').toLocaleDateString('fr-FR', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      });
      const amountFormatted = (member.deposit ?? 0).toFixed(2);

      await sendEmail({
        to: clientEmail,
        subject: `✅ Remboursement — ${booking.biz_name}`,
        text: `Bonjour ${member.name},

Le professionnel vous a remboursé vos frais de réservation, à titre de geste commercial.

📍 Établissement : ${booking.biz_name}
💆 Prestation : ${booking.service_name}
📅 Date du rendez-vous concerné : ${dateFormatted}
🕐 Heure : ${booking.time}
💶 Montant remboursé : ${amountFormatted}€
✅ Crédit sous 5 à 10 jours ouvrés selon votre banque.

⚠️ Rappel : les frais de gestion Book'nPay ne sont jamais remboursés (CGV Art. 3).

Si vous avez des questions : contact@book-n-pay.com

À bientôt,
L'équipe Book'nPay`,
      }).catch(() => {});
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return logAndRespond('[RefundGesture] Erreur:', error);
  }
}
