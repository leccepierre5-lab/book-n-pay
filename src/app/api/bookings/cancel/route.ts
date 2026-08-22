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
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { parseParisDatetime, phonesMatch, formatTime, CANCEL_DEADLINE_HOURS } from '@/lib/booking-utils';
import { buildIcs } from '@/lib/ics';
import { depositRefundAmountCents, retrieveManagementFeeAmount, reverseConnectedAccountTransfer, withRefundClaim, RefundAlreadyClaimedError } from '@/lib/refunds';
import { cancelBookingIfNoActiveMembers } from '@/lib/booking-lifecycle';
import { notifyProBookingCancelled } from '@/lib/pro-notifications';
import { notifyAdminOnFailure } from '@/lib/notify-admin';
import { insertRefundFailure } from '@/lib/refund-failures';
import { sendEmail } from '@/lib/email/send';
import { logAndRespond } from '@/lib/api-error';
import { getStripeClient } from '@/lib/stripe/client';

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
      .select('client_id, date, time, ics_sequence, biz_name, service_name, services(duration_minutes), businesses(business_locations(address))')
      .eq('id', bookingId)
      .maybeSingle();
    if (!booking) return NextResponse.json({ error: 'Réservation introuvable' }, { status: 404 });

    const { data: member } = await serviceSupabase
      .from('booking_members')
      .select('deposit, name, phone, status, stripe_checkout_session_id, stripe_payment_intent_id')
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

    // Créé ici (pas seulement dans le if refund) pour être réutilisable par
    // la récupération best-effort des frais de gestion sur l'email plus bas,
    // même si le client n'est pas éligible au remboursement.
    const stripe = await getStripeClient(serviceSupabase);

    let refundDone = false;
    if (eligibleForRefund && member.stripe_payment_intent_id) {
      try {
        // Verrou anti-double-remboursement (audit 22/08, migration 0063) —
        // voir lib/refunds.ts withRefundClaim(). Un double-clic ou deux
        // onglets sur la même annulation ne doivent jamais déclencher deux
        // appels stripe.refunds.create pour ce membre.
        await withRefundClaim(serviceSupabase, memberId, () => stripe.refunds.create({
          payment_intent: member.stripe_payment_intent_id!,
          // Ne rembourse que les frais de réservation — les frais de gestion
          // Book'nPay restent acquis (CGV Art. 2, déjà annoncé dans l'email
          // ci-dessous ; sans `amount` explicite Stripe rembourse tout le
          // PaymentIntent par défaut, gestion incluse).
          amount: depositRefundAmountCents(member.deposit),
          reason: 'requested_by_customer',
          // Cette route envoie déjà son propre email d'annulation
          // (ci-dessous) : ce flag dit au webhook charge.refunded de ne
          // pas en renvoyer un second pour le même remboursement. Un
          // remboursement déclenché ailleurs (dashboard Stripe, admin
          // freeze) n'a pas ce flag et le webhook reste le filet normal.
          metadata: { email_sent: 'true' },
        }));
        refundDone = true;
        console.log(`[CancelClient] ✅ Remboursement OK — booking=${bookingId} membre=${memberId}`);
      } catch (stripeErr: any) {
        if (stripeErr instanceof RefundAlreadyClaimedError) {
          // Pas un échec Stripe — une requête concurrente traite déjà ce
          // même membre (double-clic, deux onglets). Elle mènera l'annulation
          // à son terme ; celle-ci s'arrête ici, sans alerte admin ni email
          // dupliqué.
          console.warn(`[CancelClient] ${stripeErr.message}`);
          return NextResponse.json({ error: stripeErr.message }, { status: 409 });
        }
        console.error('[CancelClient] Erreur Stripe:', stripeErr.message);
        // ⚠️ CORRECTIF (audit 26/07, même classe que le BLOQUANT expireGroup) —
        // NUANCE : contrairement au groupe, il n'existe ICI aucun cron ni
        // filet lazy qui repasse sur un membre 'cancelled' non remboursé —
        // le client a explicitement demandé l'annulation, la place doit se
        // libérer (ci-dessous) quoi qu'il arrive côté Stripe. Cette alerte
        // admin est donc le SEUL filet : sans elle, un refund en échec ne
        // remonte à personne, le client attend un remboursement qui ne
        // viendra jamais tant qu'un humain n'a pas traité manuellement le
        // remboursement Stripe (dashboard) après lecture de cette alerte.
        await notifyAdminOnFailure('bookings/cancel:refund', {
          processed: 0,
          failed: 1,
          failedItems: [memberId],
          failedDescriptions: [`membre ${memberId} (booking ${bookingId}, ${member.deposit ?? 0}€) — ${stripeErr.message}`],
        }, 'action');
        await insertRefundFailure(serviceSupabase, {
          bookingId,
          stripeChargeId: member.stripe_payment_intent_id ?? null,
          amountCents: depositRefundAmountCents(member.deposit),
          errorCode: stripeErr.code ?? null,
          errorMessage: stripeErr.message,
          failureType: 'refund',
        });
      }
    }

    // Récupération du dépôt déjà transféré au pro (transfer_data.destination,
    // stripe/checkout/route.ts) — UNIQUEMENT si le client a bien été remboursé
    // (refundDone) : pas de raison de réclamer au pro tant que l'argent n'est
    // pas reparti côté client. Ordre volontaire : refund client D'ABORD
    // (ci-dessus), réversal ENSUITE — voir lib/refunds.ts pour le détail de
    // pourquoi `reverse_transfer` sur le refund lui-même ne suffit pas ici
    // (remboursement partiel, dépôt seul). Best-effort strict : un échec ne
    // doit jamais bloquer la libération du créneau ci-dessous — c'est une
    // alerte admin, pas un blocage.
    let transferReversed = false;
    if (refundDone) {
      const reversal = await reverseConnectedAccountTransfer(
        stripe,
        member.stripe_payment_intent_id,
        depositRefundAmountCents(member.deposit),
        'CancelClient'
      );
      transferReversed = reversal.done;
      if (reversal.error) {
        await notifyAdminOnFailure('bookings/cancel:reverse_transfer', {
          processed: 0,
          failed: 1,
          failedItems: [memberId],
          failedDescriptions: [
            `membre ${memberId} (booking ${bookingId}) — récupération du dépôt (${member.deposit ?? 0}€) auprès du pro échouée, à vérifier manuellement — ${reversal.error}`,
          ],
        }, 'action');
        await insertRefundFailure(serviceSupabase, {
          bookingId,
          stripeChargeId: member.stripe_payment_intent_id ?? null,
          amountCents: depositRefundAmountCents(member.deposit),
          errorCode: null,
          errorMessage: `réversal du dépôt auprès du pro échouée — ${reversal.error}`,
          failureType: 'reverse_transfer',
        });
      }
    }

    await serviceSupabase
      .from('booking_members')
      .update({ status: 'cancelled' })
      .eq('id', memberId);

    // SEQUENCE RFC 5545 — pour que le .ics METHOD:CANCEL envoyé plus bas mette
    // à jour l'événement dans l'agenda du client au lieu d'en créer un doublon
    // (voir src/lib/ics.ts). Même UID que celui envoyé à la confirmation.
    const nextIcsSequence = (booking.ics_sequence ?? 0) + 1;
    await serviceSupabase
      .from('bookings')
      .update({ ics_sequence: nextIcsSequence })
      .eq('id', bookingId);

    // Sans ça, le créneau restait occupé pour toujours (agenda pro ET
    // anti-collision réelle — ni /api/pro/agenda, ni la RPC Postgres
    // assign_staff_and_create_booking ne regardent booking_members, les
    // deux filtrent uniquement bookings.status). Voir lib/booking-lifecycle.ts.
    await cancelBookingIfNoActiveMembers(serviceSupabase, bookingId);

    await notifyProBookingCancelled(serviceSupabase, bookingId, {
      memberName: member.name,
      refunded: refundDone,
      refundAmount: member.deposit ?? 0,
    });

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
      // ⚠️ CORRECTIF (audit 26/07) : le montant n'était jamais mentionné ici
      // (contrairement à expireGroup.ts et au webhook charge.refunded) — le
      // client savait qu'il serait remboursé, jamais combien.
      const refundLine = eligibleForRefund
        ? refundDone
          ? `✅ Remboursement de vos frais de réservation (${member.deposit ?? 0}€) initié — crédit sous 5 à 10 jours ouvrés selon votre banque.`
          : `⚠️ Remboursement de vos frais de réservation (${member.deposit ?? 0}€) initié mais une vérification manuelle peut être nécessaire — contactez-nous si vous ne le recevez pas.`
        : `❌ Annulation à moins de 48h du RDV — les frais de réservation sont conservés par le professionnel (CGV Art. 2).`;

      // ⚠️ CORRECTIF (audit email 27/07, même classe que C15 `e7cfe60`) : le
      // rappel générique ne donnait aucun montant — un client qui a payé en
      // une seule fois (ex. 11,99€) ne devinait pas de lui-même la part
      // conservée. Best-effort, n'a jamais bloqué l'envoi de l'email.
      const managementFeeAmount = await retrieveManagementFeeAmount(
        stripe,
        member.stripe_checkout_session_id,
        'CancelClient'
      );
      const managementFeeLine = managementFeeAmount != null
        ? `❌ Conservé : ${managementFeeAmount.toFixed(2)}€ (frais de gestion Book'nPay, CGV Art. 2 — jamais remboursés)`
        : `⚠️ Les frais de gestion Book'nPay ne sont jamais remboursés (CGV Art. 2).`;

      // .ics METHOD:CANCEL — même UID que la confirmation, SEQUENCE incrémenté
      // ci-dessus, pour que l'agenda du client retire l'événement (best-effort,
      // voir src/lib/ics.ts).
      let icsCancelAttachment: { filename: string; content: string } | null = null;
      try {
        const svc = Array.isArray((booking as any).services) ? (booking as any).services[0] : (booking as any).services;
        const biz = Array.isArray((booking as any).businesses) ? (booking as any).businesses[0] : (booking as any).businesses;
        const loc = Array.isArray(biz?.business_locations) ? biz.business_locations[0] : biz?.business_locations;
        const ics = buildIcs({
          uid: `${bookingId}@book-n-pay.com`,
          start: parseParisDatetime(booking.date, booking.time),
          durationMin: svc?.duration_minutes ?? 60,
          summary: `RDV — ${booking.service_name}`,
          location: loc?.address,
          organizerName: booking.biz_name,
          organizerEmail: 'contact@book-n-pay.com',
          attendeeEmail: clientEmail,
          sequence: nextIcsSequence,
          method: 'CANCEL',
        });
        icsCancelAttachment = { filename: 'annulation.ics', content: Buffer.from(ics, 'utf8').toString('base64') };
      } catch (e: any) {
        console.warn('[CancelClient] Génération ICS CANCEL échouée (email envoyé sans pièce jointe calendrier):', e.message);
      }

      await sendEmail({
        to: clientEmail,
        subject: `❌ Réservation annulée — ${booking.biz_name}`,
        text: `Bonjour ${member.name},

Votre réservation a bien été annulée.

📍 Établissement : ${booking.biz_name}
💆 Prestation : ${booking.service_name}
📅 Date : ${dateFormatted}
🕐 Heure : ${formatTime(booking.time)}

${refundLine}
${managementFeeLine}

Si vous avez des questions : contact@book-n-pay.com

À bientôt,
L'équipe Book'nPay`,
        ...(icsCancelAttachment ? { attachments: [icsCancelAttachment] } : {}),
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
