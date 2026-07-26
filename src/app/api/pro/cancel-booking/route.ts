// src/app/api/pro/cancel-booking/route.ts
// C15 — le seul mécanisme manquant qui touche un cas certain à se produire
// (un pro tombe malade / indisponible sur un RDV déjà payé) : jusqu'ici
// aucune route ne permettait au pro d'annuler UN rendez-vous précis à venir
// avec remboursement du client — seuls existaient refund-gesture (geste sur
// un RDV déjà passé/no-show) et freeze-business (gèle tout l'établissement).
// La CGU (Art. 3) promet explicitement le remboursement intégral des frais
// de réservation en cas d'annulation par le pro — cette route l'exécute.
//
// Statut : réutilise 'cancelled' (booking_members.status), PAS un statut
// dédié — ~35 sites du repo (staff-assignment, availability, agenda,
// mes-reservations, send-rdv-reminders...) testent tous `!== 'cancelled'`
// pour savoir si un membre est encore actif ; un statut parallèle casserait
// silencieusement chacun d'eux (risque réel de double-booking via
// staff-assignment). La distinction "annulé par le pro" vit dans
// booking_logs (format constant ci-dessous), pas dans le statut — même
// convention que refund-gesture/expireGroup/freeze-business.
import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { parseParisDatetime, formatTime } from '@/lib/booking-utils';
import { proCancellationRefundAmountCents } from '@/lib/refunds';
import { cancelBookingIfNoActiveMembers } from '@/lib/booking-lifecycle';
import { notifyAdminOnFailure } from '@/lib/notify-admin';
import { checkRateLimit } from '@/lib/rate-limit';
import { sendEmail } from '@/lib/email/send';
import { logAndRespond } from '@/lib/api-error';
import { getStripeClient } from '@/lib/stripe/client';

// Préfixe constant et parsable — devient la source de comptage des
// annulations pro (litige, stats, futur indicateur de fiabilité). Ne pas
// changer le format sans mettre à jour tout code qui le lira un jour.
// Forme : "ANNULATION_PRO | pro_id=<uuid> | pro_email=<email> |
// montant_rembourse=<X.XX> | refund_status=<ok|echec>"
const LOG_PREFIX = 'ANNULATION_PRO';

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const { allowed } = await checkRateLimit(`pro-cancel-booking:${authData.user.id}`, 20, 10 * 60);
    if (!allowed) {
      return NextResponse.json({ error: 'Trop de tentatives, réessaie dans quelques minutes.' }, { status: 429 });
    }

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

    // Garde double-annulation : un double-clic ou une requête rejouée ne doit
    // jamais redéclencher stripe.refunds.create sur un paiement déjà traité
    // (même pattern que refund-gesture/route.ts:60).
    if (member.status === 'cancelled') {
      return NextResponse.json({ success: true, alreadyCancelled: true });
    }

    if (member.status !== 'paid') {
      return NextResponse.json(
        { error: 'Seule une réservation payée et à venir peut être annulée ici.' },
        { status: 400 }
      );
    }

    // Un RDV déjà passé relève de refund-gesture (geste commercial), pas de
    // cette route — C15 couvre l'indisponibilité du pro sur un RDV à venir.
    const rdvDateTime = parseParisDatetime(booking.date, booking.time);
    if (rdvDateTime.getTime() <= Date.now()) {
      return NextResponse.json(
        { error: 'Ce rendez-vous est déjà passé — utilise le geste commercial (remboursement no-show) le cas échéant.' },
        { status: 400 }
      );
    }

    // Montant provisoire = CGU Art. 3 actuelle (remboursement intégral des
    // frais de réservation ; les frais de gestion ne sont jamais remboursés,
    // Art. 2). Fonction dédiée (lib/refunds.ts), pas le helper générique
    // partagé par les autres routes d'annulation — ajustable ici seul si le
    // RDV CCI du 30/07 change la règle spécifiquement pour les annulations
    // pro. Dans ce cas, mettre à jour aussi le texte CGU, pas seulement
    // cette fonction.
    const refundAmountCents = proCancellationRefundAmountCents(member.deposit);

    let refundDone = false;
    if (member.stripe_payment_intent_id) {
      try {
        const stripe = await getStripeClient(serviceSupabase);
        await stripe.refunds.create({
          payment_intent: member.stripe_payment_intent_id,
          amount: refundAmountCents,
          reason: 'requested_by_customer',
          // Cette route envoie son propre email d'annulation (ci-dessous) :
          // évite un second email depuis le webhook charge.refunded pour le
          // même remboursement (même flag que cancel/refund-gesture).
          metadata: { email_sent: 'true', reason: 'pro_cancellation' },
        });
        refundDone = true;
      } catch (stripeErr: any) {
        console.error('[ProCancelBooking] Erreur Stripe:', stripeErr.message);
        // Pas de cron ni de filet lazy qui repasse sur ce membre — le RDV
        // est annulé quoi qu'il arrive côté Stripe (le pro est indisponible,
        // la place doit se libérer), cette alerte est le SEUL filet en cas
        // d'échec du remboursement (même logique que bookings/cancel).
        await notifyAdminOnFailure('pro/cancel-booking:refund', {
          processed: 0,
          failed: 1,
          failedItems: [memberId],
          failedDescriptions: [
            `membre ${memberId} (booking ${bookingId}, ${member.deposit ?? 0}€) — annulation par le pro ${authData.user.email ?? authData.user.id} — ${stripeErr.message}`,
          ],
        });
      }
    }

    await serviceSupabase
      .from('booking_members')
      .update({
        status: 'cancelled',
        montant_rembourse: refundDone ? refundAmountCents / 100 : null,
      })
      .eq('id', memberId);

    // Sans ça le créneau reste occupé pour toujours (agenda pro + anti-
    // collision réelle) — voir lib/booking-lifecycle.ts.
    await cancelBookingIfNoActiveMembers(serviceSupabase, bookingId);

    await serviceSupabase.from('booking_logs').insert({
      booking_id: bookingId,
      message: `${LOG_PREFIX} | pro_id=${authData.user.id} | pro_email=${authData.user.email ?? 'inconnu'} | montant_rembourse=${(refundDone ? refundAmountCents / 100 : 0).toFixed(2)} | refund_status=${refundDone ? 'ok' : 'echec'}`,
    });

    // Email client — texte propre à cette route ("le pro a annulé"), pas
    // dérivé d'un statut générique : le client ne doit jamais recevoir le
    // message d'annulation client ou de no-show pour une annulation dont il
    // n'est pas à l'origine.
    const clientEmail = member.email || booking.client_email;
    if (clientEmail) {
      const dateFormatted = new Date(booking.date + 'T12:00:00').toLocaleDateString('fr-FR', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      });
      const refundLine = refundDone
        ? `✅ Remboursement intégral de vos frais de réservation (${(refundAmountCents / 100).toFixed(2)}€) initié — crédit sous 5 à 10 jours ouvrés selon votre banque.`
        : `⚠️ Remboursement de vos frais de réservation (${member.deposit ?? 0}€) initié mais une vérification manuelle peut être nécessaire — contactez-nous si vous ne le recevez pas.`;

      await sendEmail({
        to: clientEmail,
        subject: `Rendez-vous annulé par le professionnel — ${booking.biz_name}`,
        text: `Bonjour ${member.name || ''},

Nous sommes désolés de vous l'annoncer : le professionnel a dû annuler votre rendez-vous.

📍 Établissement : ${booking.biz_name}
💆 Prestation : ${booking.service_name}
📅 Date : ${dateFormatted}
🕐 Heure : ${formatTime(booking.time)}

${refundLine}

⚠️ Les frais de gestion Book'nPay ne sont jamais remboursés (CGV Art. 2).

Vous pouvez reprendre une réservation dès maintenant si vous le souhaitez.

Si vous avez des questions : contact@book-n-pay.com

L'équipe Book'nPay`,
      }).catch(() => {});
    }

    return NextResponse.json({
      success: true,
      refundDone,
      refundAmount: refundDone ? refundAmountCents / 100 : 0,
    });
  } catch (error: any) {
    return logAndRespond('[ProCancelBooking] Erreur:', error);
  }
}
