// src/app/api/pro/refund-gesture/route.ts
// Permet au pro de rembourser un no-show "à titre de geste commercial"
// (typiquement suggéré par FicheClientIntelligente.tsx pour un client fiable).
// Différent de /api/bookings/cancel : ici c'est le PRO qui choisit,
// indépendamment de la règle des 48h (qui ne s'applique qu'aux annulations
// initiées par le client avant le RDV).
import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { depositRefundAmountCents, retrieveManagementFeeAmount, reverseConnectedAccountTransfer } from '@/lib/refunds';
import { cancelBookingIfNoActiveMembers } from '@/lib/booking-lifecycle';
import { sendEmail } from '@/lib/email/send';
import { logAndRespond } from '@/lib/api-error';
import { getStripeClient } from '@/lib/stripe/client';
import { formatTime } from '@/lib/booking-utils';
import { notifyAdminOnFailure } from '@/lib/notify-admin';

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

    const stripe = await getStripeClient(serviceSupabase);
    const depositCents = depositRefundAmountCents(member.deposit);
    // ⚠️ CORRECTIF (bug critique reverse_transfer) : cette route n'avait
    // jusqu'ici AUCUN try/catch autour du refund — un échec Stripe faisait
    // planter toute la requête (500 brut via le catch générique en bas de
    // fichier), sans jamais alerter personne côté admin. Contrairement à
    // bookings/cancel ou freeze-business, il n'y a pas d'événement externe
    // déjà survenu à couvrir coûte que coûte ici (c'est un geste VOLONTAIRE
    // du pro) — on garde donc le comportement "on s'arrête si le refund
    // échoue", on ajoute juste la visibilité admin qui manquait.
    try {
      await stripe.refunds.create({
        payment_intent: member.stripe_payment_intent_id,
        // Ne rembourse que les frais de réservation — les frais de gestion
        // Book'nPay restent acquis, même sur un geste commercial du pro.
        amount: depositCents,
        reason: 'requested_by_customer',
        // Cette route envoie déjà son propre email (ci-dessous) : ce flag
        // dit au webhook charge.refunded de ne pas en renvoyer un second
        // pour le même remboursement. Un remboursement déclenché ailleurs
        // (dashboard Stripe, admin freeze) n'a pas ce flag et le webhook
        // reste le filet normal.
        metadata: { email_sent: 'true' },
      });
    } catch (stripeErr: any) {
      console.error('[RefundGesture] Erreur Stripe:', stripeErr.message);
      await notifyAdminOnFailure('pro/refund-gesture:refund', {
        processed: 0,
        failed: 1,
        failedItems: [memberId],
        failedDescriptions: [`membre ${memberId} (booking ${bookingId}, ${member.deposit ?? 0}€) — ${stripeErr.message}`],
      });
      return NextResponse.json(
        { error: 'Le remboursement Stripe a échoué — notre équipe a été alertée, réessaie ou contacte-nous si ça persiste.' },
        { status: 502 }
      );
    }

    // Récupération du dépôt déjà transféré au pro (transfer_data.destination)
    // — remboursement PARTIEL ici (dépôt seul, frais de gestion conservés),
    // reverse_transfer sur le refund seul sous-récupérerait (voir
    // lib/refunds.ts) : réversal séparée à montant exact. Best-effort strict,
    // ne bloque jamais la suite (créneau déjà géré ci-dessous) — un échec est
    // une alerte admin, jamais un blocage (le refund client, lui, a déjà
    // réussi au-dessus).
    const reversal = await reverseConnectedAccountTransfer(
      stripe,
      member.stripe_payment_intent_id,
      depositCents,
      'RefundGesture'
    );
    if (reversal.error) {
      await notifyAdminOnFailure('pro/refund-gesture:reverse_transfer', {
        processed: 0,
        failed: 1,
        failedItems: [memberId],
        failedDescriptions: [
          `membre ${memberId} (booking ${bookingId}) — récupération du dépôt (${member.deposit ?? 0}€) auprès du pro échouée, à vérifier manuellement — ${reversal.error}`,
        ],
      });
    }

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

      // ⚠️ CORRECTIF (audit email 27/07, même classe que C15 `e7cfe60`) : le
      // rappel générique ne donnait aucun montant — un client qui a payé en
      // une seule fois (ex. 11,99€) ne devinait pas de lui-même la part
      // conservée. Best-effort, n'a jamais bloqué l'envoi de l'email.
      const managementFeeAmount = await retrieveManagementFeeAmount(
        stripe,
        member.stripe_checkout_session_id,
        'RefundGesture'
      );
      const managementFeeLine = managementFeeAmount != null
        ? `❌ Conservé : ${managementFeeAmount.toFixed(2)}€ (frais de gestion Book'nPay, CGV Art. 2 — jamais remboursés)`
        : `⚠️ Les frais de gestion Book'nPay ne sont jamais remboursés (CGV Art. 2).`;

      await sendEmail({
        to: clientEmail,
        subject: `✅ Remboursement — ${booking.biz_name}`,
        text: `Bonjour ${member.name},

Le professionnel vous a remboursé vos frais de réservation, à titre de geste commercial.

📍 Établissement : ${booking.biz_name}
💆 Prestation : ${booking.service_name}
📅 Date du rendez-vous concerné : ${dateFormatted}
🕐 Heure : ${formatTime(booking.time)}
✅ Remboursé : ${amountFormatted}€ (frais de réservation, intégral)
${managementFeeLine}
Crédit sous 5 à 10 jours ouvrés selon votre banque.

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
