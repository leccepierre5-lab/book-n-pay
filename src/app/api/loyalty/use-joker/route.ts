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
import Stripe from 'stripe';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { JOKERS_LIMITES, JOKERS_PCT } from '@/lib/booking-utils';
import { logAndRespond } from '@/lib/api-error';

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const { phone, bookingId, memberId, fraisReservation, paymentIntentId } = await req.json();

    if (!phone || !bookingId || !memberId || !fraisReservation) {
      return NextResponse.json(
        { error: 'Paramètres manquants: phone, bookingId, memberId, fraisReservation requis' },
        { status: 400 }
      );
    }

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
      .select('phone')
      .eq('id', memberId)
      .eq('booking_id', bookingId)
      .maybeSingle();

    if (!targetMember || targetMember.phone !== phone) {
      return NextResponse.json({ error: 'Ce membre ne correspond pas au profil authentifié' }, { status: 403 });
    }

    const { data: user } = await serviceSupabase
      .from('app_users')
      .select('*')
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
    const montantRembourse = Math.round(fraisReservation * pct * 100) / 100;

    let refundId: string | null = null;
    if (paymentIntentId) {
      const stripeKey = process.env.STRIPE_SECRET_KEY || process.env.STRIPE_TEST_SECRET_KEY!;
      const stripe = new Stripe(stripeKey);
      const refund = await stripe.refunds.create({
        payment_intent: paymentIntentId,
        amount: Math.round(montantRembourse * 100),
        reason: 'requested_by_customer',
        metadata: { joker: 'true', statut, phone, bookingId, memberId },
      });
      refundId = refund.id;
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
