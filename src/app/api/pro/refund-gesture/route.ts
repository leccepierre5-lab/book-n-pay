// src/app/api/pro/refund-gesture/route.ts
// Permet au pro de rembourser un no-show "à titre de geste commercial"
// (typiquement suggéré par FicheClientIntelligente.tsx pour un client fiable).
// Différent de /api/bookings/cancel : ici c'est le PRO qui choisit,
// indépendamment de la règle des 48h (qui ne s'applique qu'aux annulations
// initiées par le client avant le RDV).
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';

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
      .select('biz_id')
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

    const stripeKey = process.env.STRIPE_SECRET_KEY || process.env.STRIPE_TEST_SECRET_KEY!;
    const stripe = new Stripe(stripeKey);
    await stripe.refunds.create({
      payment_intent: member.stripe_payment_intent_id,
      reason: 'requested_by_customer',
    });

    await serviceSupabase.from('booking_members').update({ status: 'cancelled' }).eq('id', memberId);
    await serviceSupabase.from('booking_logs').insert({
      booking_id: bookingId,
      message: `Remboursement geste commercial accordé par le professionnel`,
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[RefundGesture] Erreur:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
