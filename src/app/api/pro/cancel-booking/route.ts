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
import { buildIcs } from '@/lib/ics';
import { proCancellationRefundAmountCents } from '@/lib/refunds';
import { cancelBookingIfNoActiveMembers } from '@/lib/booking-lifecycle';
import { notifyAdminOnFailure } from '@/lib/notify-admin';
import { insertRefundFailure } from '@/lib/refund-failures';
import { checkRateLimit } from '@/lib/rate-limit';
import { sendEmail } from '@/lib/email/send';
import { logAndRespond } from '@/lib/api-error';
import { getStripeClient } from '@/lib/stripe/client';
import { attachProChargeToNextInvoice } from '@/lib/stripe/pro-charge-billing';

// Préfixe constant et parsable — devient la source de comptage des
// annulations pro (litige, stats, futur indicateur de fiabilité). Ne pas
// changer le format sans mettre à jour tout code qui le lira un jour.
// Forme : "ANNULATION_PRO | pro_id=<uuid> | pro_email=<email> |
// montant_rembourse=<X.XX> | refund_status=<ok|echec> |
// frais_gestion_impute=<X.XX> | charge_id=<uuid|none>"
// Les deux derniers champs ont été ajoutés avec la refacturation des frais
// de gestion au pro (pro_charges, migration 0041) — montant_rembourse inclut
// désormais les frais de gestion (remboursement intégral, CGU Art. 3),
// frais_gestion_impute est la part de ce remboursement refacturée au pro.
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
      // ⚠️ '*' et non une liste explicite : nommer ics_sequence ici ferait
      // échouer TOUT le select (colonne inconnue tant que la migration 0051
      // n'a pas tourné) — la route renverrait 404 sur chaque annulation.
      // '*' renvoie simplement les colonnes existantes ; nextIcsSequence lit
      // ensuite booking.ics_sequence avec un ?? 0 tolérant.
      .select('*, services(duration_minutes), businesses(business_locations(address))')
      .eq('id', bookingId)
      .maybeSingle();

    if (!booking) return NextResponse.json({ error: 'Réservation introuvable' }, { status: 404 });
    if (profile?.role !== 'admin' && profile?.biz_id !== booking.biz_id) {
      return NextResponse.json({ error: 'Non autorisé pour ce business' }, { status: 403 });
    }

    const { data: member } = await serviceSupabase
      .from('booking_members')
      .select('status, deposit, email, name, stripe_checkout_session_id, stripe_payment_intent_id')
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

    const stripe = await getStripeClient(serviceSupabase);

    // Montant des frais de gestion réellement facturés à l'origine (CGV
    // Art. 2). Nécessaire AVANT de calculer refundAmountCents ci-dessous : sur
    // une annulation pro, ces frais sont remboursés au client puis refacturés
    // au pro (pro_charges) — contrairement aux autres routes d'annulation où
    // ce montant ne sert qu'à l'afficher dans l'email. Stocké en metadata sur
    // la SESSION Checkout (stripe/checkout/route.ts), pas sur le PaymentIntent
    // — d'où stripe_checkout_session_id, pas stripe_payment_intent_id.
    // Best-effort : un échec ici ne doit jamais bloquer l'annulation — si le
    // montant reste inconnu, refundAmountCents retombe sur le dépôt seul
    // (voir proCancellationRefundAmountCents) et une alerte admin part plus
    // bas pour vérification manuelle.
    let managementFeeAmount: number | null = null;
    if (member.stripe_checkout_session_id) {
      try {
        const session = await stripe.checkout.sessions.retrieve(member.stripe_checkout_session_id);
        const raw = session.metadata?.fraisGestion;
        if (raw) managementFeeAmount = parseFloat(raw);
      } catch (e: any) {
        console.warn('[ProCancelBooking] Impossible de récupérer les frais de gestion pour l\'email:', e.message);
      }
    }

    // Remboursement INTÉGRAL (frais de réservation + frais de gestion) —
    // CGU Art. 3 : le client n'a commis aucune faute et n'a reçu aucune
    // prestation. Si managementFeeAmount est inconnu (session introuvable),
    // le calcul retombe sur le dépôt seul — impossible de rembourser/facturer
    // un montant qu'on ne connaît pas (voir alerte admin dédiée plus bas).
    const refundAmountCents = proCancellationRefundAmountCents(member.deposit, managementFeeAmount);

    let refundDone = false;
    if (member.stripe_payment_intent_id) {
      try {
        // reverse_transfer ne peut être posé QUE si la charge a réellement un
        // transfert associé (transfer_data.destination, stripe/checkout/
        // route.ts:325) — celui-ci n'existe que si le pro avait un compte
        // Connect actif au moment du paiement (stripe_account_id +
        // stripe_onboarding_complete). Sinon la réservation est quand même
        // acceptée (100% encaissé côté plateforme, fallback volontaire), et
        // reverse_transfer:true sur un refund sans transfert associé fait
        // échouer TOUT le refund côté Stripe ("Cannot reverse transfer on
        // charge ... because it does not have an associated transfer.") —
        // bug réel constaté le 14/08 (booking 3afbff0f). Même vérification
        // que reverseConnectedAccountTransfer (lib/refunds.ts) pour les 3
        // autres routes.
        const pi = await stripe.paymentIntents.retrieve(member.stripe_payment_intent_id, {
          expand: ['latest_charge'],
        });
        const charge = pi.latest_charge;
        const hasTransfer = Boolean(charge && typeof charge !== 'string' && charge.transfer);

        await stripe.refunds.create({
          payment_intent: member.stripe_payment_intent_id,
          amount: refundAmountCents,
          reason: 'requested_by_customer',
          // Ce remboursement couvre 100% de la charge (dépôt + frais de
          // gestion, proCancellationRefundAmountCents ci-dessus) : quand un
          // transfert existe, Stripe annule alors 100% du transfert
          // automatique fait au pro à la réservation. Sans transfert
          // (fallback checkout sans Connect actif), il n'y a rien à
          // récupérer — le flag est simplement omis, pas envoyé à `false`
          // (Stripe le rejette aussi si aucun transfert n'existe). Aucune
          // interaction avec pro_charges plus bas : ce flag ne touche que le
          // dépôt transféré, jamais les frais de gestion (qui ne sont jamais
          // transférés au pro, application_fee_amount reste sur la
          // plateforme) — donc pas de double récupération.
          ...(hasTransfer ? { reverse_transfer: true } : {}),
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
        }, 'action');
        await insertRefundFailure(serviceSupabase, {
          bookingId,
          stripeChargeId: member.stripe_payment_intent_id ?? null,
          amountCents: refundAmountCents,
          errorCode: stripeErr.code ?? null,
          errorMessage: stripeErr.message,
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

    // SEQUENCE RFC 5545 — pour que le .ics METHOD:CANCEL envoyé plus bas mette
    // à jour l'événement dans l'agenda du client au lieu d'en créer un doublon
    // (voir src/lib/ics.ts). Même UID que celui envoyé à la confirmation.
    const nextIcsSequence = (booking.ics_sequence ?? 0) + 1;
    await serviceSupabase
      .from('bookings')
      .update({ ics_sequence: nextIcsSequence })
      .eq('id', bookingId);

    // Sans ça le créneau reste occupé pour toujours (agenda pro + anti-
    // collision réelle) — voir lib/booking-lifecycle.ts.
    await cancelBookingIfNoActiveMembers(serviceSupabase, bookingId);

    // Refacturation des frais de gestion au pro (pro_charges, migration
    // 0041) — UNIQUEMENT si le refund Stripe a réussi (sinon on facturerait
    // un remboursement qui n'a jamais eu lieu) ET si le montant est connu
    // (impossible de facturer un montant qu'on n'a pas pu déterminer).
    // L'échec de CETTE insertion ne doit JAMAIS bloquer l'annulation ni le
    // remboursement, déjà actés au-dessus — best-effort avec alerte admin,
    // même logique que le reste de la route.
    let chargeId: string | null = null;
    if (refundDone && managementFeeAmount != null) {
      try {
        const { data: chargeRow, error: chargeErr } = await serviceSupabase
          .from('pro_charges')
          .insert({
            biz_id: booking.biz_id,
            booking_id: bookingId,
            type: 'management_fee_pro_cancellation',
            amount_cents: Math.round(managementFeeAmount * 100),
            currency: 'eur',
            status: 'pending',
          })
          .select('id')
          .single();

        if (chargeErr) {
          // Code Postgres 23505 = violation de la contrainte d'unicité
          // (booking_id, type) : rejeu de la même annulation, idempotence
          // normale — pas une erreur, pas d'alerte.
          if (chargeErr.code !== '23505') {
            throw chargeErr;
          }
        } else {
          chargeId = chargeRow?.id ?? null;
          // Rattache immédiatement la charge à la prochaine facture
          // d'abonnement du pro (invoice item en attente, jamais un
          // prélèvement immédiat) — voir pro-charge-billing.ts pour le
          // raisonnement complet. Best-effort : un échec ici laisse la
          // charge 'pending' (déjà alertée en interne par la fonction),
          // ne remet jamais en cause l'annulation/remboursement déjà actés.
          if (chargeId) {
            await attachProChargeToNextInvoice(stripe, serviceSupabase, chargeId, booking.biz_id, Math.round(managementFeeAmount * 100));
          }
        }
      } catch (chargeErr: any) {
        console.error('[ProCancelBooking] Insertion pro_charges échouée:', chargeErr.message);
        await serviceSupabase.from('booking_logs').insert({
          booking_id: bookingId,
          message: `ANNULATION_PRO_CHARGE_ECHEC | booking_id=${bookingId} | montant=${managementFeeAmount.toFixed(2)} | erreur=${chargeErr.message}`,
        });
        await notifyAdminOnFailure('pro/cancel-booking:pro_charge', {
          processed: 0,
          failed: 1,
          failedItems: [bookingId],
          failedDescriptions: [
            `booking ${bookingId} — frais de gestion ${managementFeeAmount.toFixed(2)}€ non facturés au pro (échec insertion pro_charges) — ${chargeErr.message}`,
          ],
        }, 'action');
      }
    } else if (refundDone && managementFeeAmount == null) {
      // Client remboursé du dépôt seul (montant total inconnu), le pro n'est
      // pas facturé faute de montant fiable — nécessite une vérification
      // manuelle (voir tests attendus : "booking sans frais de gestion
      // identifiable").
      console.warn('[ProCancelBooking] Frais de gestion non identifiables — pro non facturé, alerte admin');
      await serviceSupabase.from('booking_logs').insert({
        booking_id: bookingId,
        message: `ANNULATION_PRO_FRAIS_GESTION_INCONNU | booking_id=${bookingId} | pro_id=${authData.user.id}`,
      });
      await notifyAdminOnFailure('pro/cancel-booking:pro_charge', {
        processed: 0,
        failed: 1,
        failedItems: [bookingId],
        failedDescriptions: [
          `booking ${bookingId} — frais de gestion non identifiables (session Stripe introuvable ou metadata absente), pro NON facturé — vérification manuelle nécessaire`,
        ],
      }, 'action');
    }

    const fraisGestionImpute = refundDone && managementFeeAmount != null ? managementFeeAmount.toFixed(2) : '0.00';
    await serviceSupabase.from('booking_logs').insert({
      booking_id: bookingId,
      message: `${LOG_PREFIX} | pro_id=${authData.user.id} | pro_email=${authData.user.email ?? 'inconnu'} | montant_rembourse=${(refundDone ? refundAmountCents / 100 : 0).toFixed(2)} | refund_status=${refundDone ? 'ok' : 'echec'} | frais_gestion_impute=${fraisGestionImpute} | charge_id=${chargeId ?? 'none'}`,
    });

    const { data: biz } = await serviceSupabase
      .from('businesses')
      .select('slug, owner_id')
      .eq('id', booking.biz_id)
      .maybeSingle();

    // Email client — texte propre à cette route ("le pro a annulé"), pas
    // dérivé d'un statut générique : le client ne doit jamais recevoir le
    // message d'annulation client ou de no-show pour une annulation dont il
    // n'est pas à l'origine.
    const clientEmail = member.email || booking.client_email;
    if (clientEmail) {
      const dateFormatted = new Date(booking.date + 'T12:00:00').toLocaleDateString('fr-FR', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      });
      // Remboursement intégral (frais de réservation + frais de gestion,
      // CGU Art. 3) — un seul montant net, plus de ligne "conservé" : rien
      // n'est retenu au client sur ce chemin, contrairement aux autres
      // annulations (client, no-show, gel).
      const refundLine = refundDone
        ? `✅ Remboursé : ${(refundAmountCents / 100).toFixed(2)}€ (intégral — frais de réservation + frais de gestion)`
        : `⚠️ Remboursement de ${(refundAmountCents / 100).toFixed(2)}€ initié mais une vérification manuelle peut être nécessaire — contactez-nous si vous ne le recevez pas.`;

      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://book-n-pay-next.vercel.app';
      const rebookUrl = biz?.slug ? `${siteUrl}/etablissement/${biz.slug}` : `${siteUrl}/recherche`;

      // .ics METHOD:CANCEL — même UID que la confirmation, SEQUENCE incrémenté
      // ci-dessus, pour que l'agenda du client retire l'événement (best-effort,
      // voir src/lib/ics.ts).
      let icsCancelAttachment: { filename: string; content: string } | null = null;
      try {
        const svc = Array.isArray((booking as any).services) ? (booking as any).services[0] : (booking as any).services;
        const bizRel = Array.isArray((booking as any).businesses) ? (booking as any).businesses[0] : (booking as any).businesses;
        const loc = Array.isArray(bizRel?.business_locations) ? bizRel.business_locations[0] : bizRel?.business_locations;
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
        console.warn('[ProCancelBooking] Génération ICS CANCEL échouée (email envoyé sans pièce jointe calendrier):', e.message);
      }

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

Vous pouvez reprendre une réservation dès maintenant si vous le souhaitez : ${rebookUrl}

Si vous avez des questions : contact@book-n-pay.com

L'équipe Book'nPay`,
        ...(icsCancelAttachment ? { attachments: [icsCancelAttachment] } : {}),
      }).catch(() => {});
    }

    // Email pro — annonce le montant refacturé (uniquement si une charge a
    // effectivement été déterminée : mêmes conditions que la création de la
    // pro_charge ci-dessus). Envoyé au OWNER du business, pas forcément à
    // authData.user : un admin peut avoir déclenché cette annulation pour le
    // compte du pro (voir autorisation plus haut), c'est le pro qui doit être
    // informé qu'il sera facturé, pas l'admin. Best-effort, ne bloque jamais.
    if (refundDone && managementFeeAmount != null && biz?.owner_id) {
      try {
        const { data: ownerAuth } = await serviceSupabase.auth.admin.getUserById(biz.owner_id);
        const ownerEmail = ownerAuth.user?.email;
        if (ownerEmail) {
          const feeFormatted = managementFeeAmount.toFixed(2).replace('.', ',');
          await sendEmail({
            to: ownerEmail,
            subject: `Annulation confirmée — ${feeFormatted} € à refacturer`,
            text: `Bonjour,

Vous avez annulé le rendez-vous suivant :

💆 Prestation : ${booking.service_name}
📅 Date : ${new Date(booking.date + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
🕐 Heure : ${formatTime(booking.time)}

Votre client a été intégralement remboursé. Les frais de gestion de cette réservation (${feeFormatted} €) vous seront refacturés sur une prochaine facture.

L'équipe Book'nPay`,
          }).catch(() => {});
        }
      } catch (e: any) {
        console.warn('[ProCancelBooking] Impossible de notifier le pro par email:', e.message);
      }
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
