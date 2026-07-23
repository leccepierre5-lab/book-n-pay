// src/app/api/group/pay-for-member/route.ts
// Permet à un membre déjà payé de créer une session Stripe pour payer
// la part d'un autre membre du MÊME groupe encore en attente.
import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { getStripeClientWithMode } from '@/lib/stripe/client';
import { withErrorHandling } from '@/lib/api-error';

export const POST = withErrorHandling('[PayForMember]', async (req: NextRequest) => {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user?.email) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const targetMemberId: string | undefined = body?.targetMemberId;
  if (!targetMemberId) {
    return NextResponse.json({ error: 'targetMemberId requis' }, { status: 400 });
  }

  const normalizedEmail = authData.user.email.trim().toLowerCase();
  const supabaseAdmin = createServiceRoleClient();

  // Récupérer le membre cible
  const { data: target } = await supabaseAdmin
    .from('booking_members')
    .select('id, name, status, deposit, booking_id, bookings!inner(id, status, group_ref, payment_deadline, biz_name, service_name, biz_id)')
    .eq('id', targetMemberId)
    .maybeSingle();

  if (!target) {
    return NextResponse.json({ error: 'Membre introuvable' }, { status: 404 });
  }

  const targetBooking = (target as any).bookings;
  const groupRef = targetBooking?.group_ref;

  if (!groupRef) {
    return NextResponse.json({ error: 'Réservation hors groupe' }, { status: 400 });
  }
  if (targetBooking?.status === 'cancelled') {
    return NextResponse.json({ error: 'Réservation non active' }, { status: 410 });
  }
  const deadline = targetBooking?.payment_deadline;
  if (!deadline || deadline <= new Date().toISOString()) {
    return NextResponse.json({ error: 'Délai expiré' }, { status: 410 });
  }
  if (target.status !== 'invite') {
    return NextResponse.json({ error: 'Ce membre a déjà payé ou a été annulé' }, { status: 409 });
  }

  // Vérifier que le caller est un membre PAYÉ du MÊME groupe (protection cross-group)
  const { data: callerRows } = await supabaseAdmin
    .from('booking_members')
    .select('id, status, booking_id, bookings!inner(group_ref)')
    .ilike('email', normalizedEmail)
    .in('status', ['paid', 'arrived']);

  const callerInGroup = (callerRows ?? []).find(
    (r) => (r as any).bookings?.group_ref === groupRef
  );

  if (!callerInGroup) {
    return NextResponse.json(
      { error: "Non autorisé — vous n'appartenez pas à ce groupe ou vous n'avez pas encore payé votre place" },
      { status: 403 }
    );
  }

  const deposit = target.deposit ?? 0;
  if (deposit <= 0) {
    return NextResponse.json({ error: 'Montant des frais de réservation invalide' }, { status: 400 });
  }

  // ── Mode test/live (même pattern que stripe/checkout et solde-checkout) ──
  const { stripe, isTestMode } = await getStripeClientWithMode(supabaseAdmin);

  // ── Compte Stripe Connect du pro — sans ça l'argent restait intégralement
  // chez Book'nPay, jamais reversé (même trou que d39f340/checkout, trouvé
  // en audit sécu du 20/07 sur cette route précisément).
  const bizId = targetBooking?.biz_id;
  let professionalStripeId: string | null = null;
  if (bizId) {
    const { data: settings } = await supabaseAdmin
      .from('business_settings')
      .select('stripe_account_id, stripe_onboarding_complete')
      .eq('biz_id', bizId)
      .maybeSingle();
    if (settings?.stripe_account_id && settings.stripe_onboarding_complete) {
      professionalStripeId = settings.stripe_account_id;
    }
  }

  if (!isTestMode && !professionalStripeId) {
    console.error(`[PayForMember] Paiement live refusé — compte Connect non finalisé — biz=${bizId || 'inconnu'}`);
    return NextResponse.json(
      { error: "Cet établissement n'est pas encore prêt à recevoir des paiements." },
      { status: 423 }
    );
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://www.book-n-pay.com';

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    mode: 'payment',
    line_items: [
      {
        price_data: {
          currency: 'eur',
          unit_amount: Math.round(deposit * 100),
          product_data: {
            name: `Place de ${target.name} — ${targetBooking.service_name}`,
            description: `Frais de réservation payés par un autre membre du groupe`,
          },
        },
        quantity: 1,
      },
    ],
    metadata: {
      mode: 'pay_for_member',
      bookingId: target.booking_id,
      memberId: targetMemberId,
      payerMemberId: callerInGroup.id,
      groupRef,
      depositAmount: String(deposit),
    },
    // Pas d'application_fee_amount : même logique que solde-checkout, 100%
    // du montant va au pro via Connect (le paiement initial du créateur du
    // groupe a déjà couvert les frais de gestion Book'nPay).
    ...(professionalStripeId && {
      payment_intent_data: { transfer_data: { destination: professionalStripeId } },
    }),
    success_url: `${baseUrl}/mes-reservations?pay_for_success=1`,
    cancel_url: `${baseUrl}/mes-reservations`,
  });

  return NextResponse.json({ checkoutUrl: session.url });
});
