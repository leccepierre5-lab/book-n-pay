// src/app/api/loyalty/use-joker/route.ts
// Port de base44/functions/tenterUtiliserJoker/entry.ts
//
// Tente d'utiliser un Joker pour rembourser les frais de réservation d'un
// membre. Exclut strictement les frais de gestion (non remboursables).
//
// ⚠️ CORRECTIF DE SÉCURITÉ (trouvé en audit, absent de la version initiale) :
// cette route acceptait `phone` directement depuis le body sans vérifier
// que l'appelant authentifié EST ce téléphone. N'importe qui pouvait
// appeler cette route avec le numéro de quelqu'un d'autre et déclencher un
// remboursement Stripe arbitraire sur sa réservation. Corrigé en exigeant
// une session authentifiée et en vérifiant que le `phone` fourni correspond
// au profil connecté (ou que l'appelant est admin).
import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { JOKERS_LIMITES, JOKERS_PCT, CANCEL_DEADLINE_HOURS, parseParisDatetime } from '@/lib/booking-utils';
import { cancelBookingIfNoActiveMembers } from '@/lib/booking-lifecycle';
import { notifyProBookingCancelled } from '@/lib/pro-notifications';
import { logAndRespond } from '@/lib/api-error';
import { getStripeClient } from '@/lib/stripe/client';
import { normalizePhone } from '@/lib/booking-utils';
import { reverseConnectedAccountTransfer } from '@/lib/refunds';
import { notifyAdminOnFailure } from '@/lib/notify-admin';
import { insertRefundFailure } from '@/lib/refund-failures';

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    // ⚠️ CORRECTIF SÉCURITÉ (audit) : fraisReservation et paymentIntentId
    // étaient auparavant lus directement du body — un appelant pouvait
    // gonfler le montant remboursé ou cibler le PaymentIntent de quelqu'un
    // d'autre. Les deux sont maintenant recalculés depuis targetMember
    // ci-dessous, jamais depuis une valeur transmise par le client.
    const { phone: rawPhone, bookingId, memberId } = await req.json();

    if (!rawPhone || !bookingId || !memberId) {
      return NextResponse.json(
        { error: 'Paramètres manquants: phone, bookingId, memberId requis' },
        { status: 400 }
      );
    }

    // Normalisation à la réception (chantier normalisation téléphone,
    // docs/plan-normalisation-telephone.md) : sans ça, un client dont le
    // numéro est stocké en +33 (base normalisée par migration 0059/0060)
    // mais qui soumet "06..." se verrait refuser son propre Joker aux
    // comparaisons ci-dessous — porte d'AUTORISATION, pas cosmétique.
    const phone = normalizePhone(rawPhone);

    // Vérifie que l'appelant authentifié correspond bien au téléphone fourni
    // (ou est admin) — sans ça, n'importe qui pourrait rembourser le Joker
    // de quelqu'un d'autre.
    const { data: callerProfile } = await supabase
      .from('app_users')
      .select('phone, role')
      .eq('id', authData.user.id)
      .single();

    if (callerProfile?.role !== 'admin' && callerProfile?.phone !== phone) {
      return NextResponse.json({ error: 'Non autorisé à utiliser le Joker de ce profil' }, { status: 403 });
    }

    const serviceSupabase = createServiceRoleClient();

    // Vérifie aussi que le memberId fourni appartient bien à ce téléphone
    // sur ce booking précis — empêche de cibler le membre de quelqu'un
    // d'autre dans le même booking de groupe.
    const { data: targetMember } = await serviceSupabase
      .from('booking_members')
      .select('phone, status, deposit, stripe_payment_intent_id')
      .eq('id', memberId)
      .eq('booking_id', bookingId)
      .maybeSingle();

    if (!targetMember || targetMember.phone !== phone) {
      return NextResponse.json({ error: 'Ce membre ne correspond pas au profil authentifié' }, { status: 403 });
    }

    // Empêche de rejouer un Joker sur un membre déjà annulé/remboursé (double
    // remboursement Stripe) ou dans un état où ça n'a pas de sens (jamais payé).
    if (targetMember.status !== 'paid') {
      return NextResponse.json(
        { error: "Ce membre n'est pas dans un état permettant un remboursement Joker" },
        { status: 400 }
      );
    }

    // ⚠️ CORRECTIF (trouvé le 21/08) : cette route ne vérifiait aucun délai —
    // un Joker était consommé même quand l'annulation était déjà gratuite
    // (>48h avant le RDV, cf. bookings/cancel). Le client perdait un Joker de
    // son quota annuel sans qu'il ne lui apporte rien. Un Joker n'a de valeur
    // QUE quand l'annulation serait sinon payante (<48h) — sinon on renvoie
    // jokerApplique:false et le front (MyBookingsList.handleCancel) retombe
    // automatiquement sur /api/bookings/cancel, qui rembourse gratuitement
    // sans toucher au Joker.
    const { data: booking } = await serviceSupabase
      .from('bookings')
      .select('date, time')
      .eq('id', bookingId)
      .maybeSingle();

    if (booking) {
      const hoursUntilRdv = (parseParisDatetime(booking.date, booking.time).getTime() - Date.now()) / (1000 * 60 * 60);
      if (hoursUntilRdv >= CANCEL_DEADLINE_HOURS) {
        return NextResponse.json({
          jokerApplique: false,
          raison: `Annulation déjà gratuite (plus de ${CANCEL_DEADLINE_HOURS}h avant le RDV) — aucun Joker consommé`,
        });
      }
    }

    const { data: user } = await serviceSupabase
      .from('app_users')
      .select('id, name, statut, jokers_disponibles, jokers_utilises')
      .eq('phone', phone)
      .maybeSingle();

    if (!user) {
      return NextResponse.json({ error: 'Utilisateur non trouvé', jokerApplique: false }, { status: 404 });
    }

    const statut = user.statut || 'Standard';
    const jokersDisponibles = user.jokers_disponibles ?? JOKERS_LIMITES[statut];
    const jokersUtilises = user.jokers_utilises || 0;
    const limite = JOKERS_LIMITES[statut];

    if (jokersUtilises >= limite || jokersDisponibles <= 0) {
      return NextResponse.json({
        jokerApplique: false,
        raison: `Aucun Joker disponible (${jokersUtilises}/${limite} utilisés cette année)`,
        statut,
        jokersDisponibles,
        jokersUtilises,
      });
    }

    const pct = JOKERS_PCT[statut];
    // Source unique du montant : le dépôt réellement enregistré en base,
    // jamais une valeur transmise par le client.
    const fraisReservation = targetMember.deposit || 0;
    const montantRembourse = Math.round(fraisReservation * pct * 100) / 100;

    let refundId: string | null = null;
    if (targetMember.stripe_payment_intent_id) {
      const stripe = await getStripeClient(serviceSupabase);
      const refund = await stripe.refunds.create({
        payment_intent: targetMember.stripe_payment_intent_id,
        amount: Math.round(montantRembourse * 100),
        reason: 'requested_by_customer',
        metadata: { joker: 'true', statut, phone, bookingId, memberId },
      });
      refundId = refund.id;

      // ⚠️ CORRECTIF (audit 22/08) : ce remboursement partiel (dépôt seul,
      // au pourcentage du palier fidélité) ne récupérait jamais le dépôt déjà
      // transféré au pro (transfer_data.destination, stripe/checkout/route.ts)
      // — même bug que reverse_transfer (d77eaa1), un point d'appel oublié
      // par ce correctif. Le pro gardait le dépôt ET le client était
      // remboursé : la différence restait à la charge de Book'nPay, en
      // silence. Best-effort strict comme les 3 autres routes de
      // remboursement qui font déjà cet appel (bookings/cancel,
      // pro/refund-gesture, admin/freeze-business) : un échec ici est une
      // alerte admin, jamais un blocage du remboursement client déjà acté.
      const reversal = await reverseConnectedAccountTransfer(
        stripe,
        targetMember.stripe_payment_intent_id,
        Math.round(montantRembourse * 100),
        'UseJoker'
      );
      if (reversal.error) {
        await notifyAdminOnFailure('loyalty/use-joker:reverse_transfer', {
          processed: 0,
          failed: 1,
          failedItems: [memberId],
          failedDescriptions: [
            `membre ${memberId} (booking ${bookingId}) — récupération du dépôt (${montantRembourse}€) auprès du pro échouée, à vérifier manuellement — ${reversal.error}`,
          ],
        }, 'action');
        await insertRefundFailure(serviceSupabase, {
          bookingId,
          stripeChargeId: targetMember.stripe_payment_intent_id ?? null,
          amountCents: Math.round(montantRembourse * 100),
          errorCode: null,
          errorMessage: `réversal du dépôt auprès du pro échouée (Joker) — ${reversal.error}`,
          failureType: 'reverse_transfer',
        });
      }
    }

    const newJokersDisponibles = jokersDisponibles - 1;
    const newJokersUtilises = jokersUtilises + 1;

    await serviceSupabase
      .from('app_users')
      .update({ jokers_disponibles: newJokersDisponibles, jokers_utilises: newJokersUtilises })
      .eq('id', user.id);

    await serviceSupabase
      .from('booking_members')
      .update({ status: 'cancelled', joker_applique: true, montant_rembourse: montantRembourse })
      .eq('id', memberId)
      .eq('booking_id', bookingId);

    // Voir lib/booking-lifecycle.ts — même trou que cancel/refund-gesture,
    // trouvé au même audit : sans ça le créneau restait bloqué pour toujours.
    await cancelBookingIfNoActiveMembers(serviceSupabase, bookingId);

    await notifyProBookingCancelled(serviceSupabase, bookingId, {
      memberName: user.name,
      refunded: !!refundId,
      refundAmount: montantRembourse,
    });

    return NextResponse.json({
      jokerApplique: true,
      montantRembourse,
      pourcentage: Math.round(pct * 100),
      refundId,
      statut,
      jokersDisponibles: newJokersDisponibles,
      jokersUtilises: newJokersUtilises,
    });
  } catch (error: any) {
    return logAndRespond('[Joker] Erreur:', error);
  }
}
