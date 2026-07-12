// src/app/api/bookings/solde-checkout/route.ts
// Crée (ou réutilise) une Checkout Session Stripe Connect pour le paiement en
// ligne du solde de prestation (mode "App" de CaisseEncaissement). Le montant
// est calculé et verrouillé côté serveur — jamais transmis par le client (le
// body n'accepte que bookingId/memberId, voir src/lib/solde-checkout.ts pour
// la logique de calcul/garde-fous/idempotence, testée unitairement).
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { logAndRespond, logAndRespondStripeError } from '@/lib/api-error';
import {
  computeSolde,
  isProAuthorizedForBiz,
  checkMemberEligibleForSoldeCheckout,
  checkSoldeIsPositive,
  isStripeAccountConfigured,
  decideSoldeIdempotency,
} from '@/lib/solde-checkout';

// Le client paie sur place, pas besoin des 24h par défaut de Stripe — mais on
// garde une marge au-dessus du minimum autorisé par Stripe (30 min) pour ne
// jamais risquer un rejet lié à la latence entre le calcul de ce timestamp et
// la création effective de la session côté Stripe.
const SESSION_LIFETIME_SECONDS = 35 * 60;

export async function POST(req: NextRequest) {
  try {
    const { allowed } = await checkRateLimit(`solde-checkout:${getClientIp(req)}`, 20, 10 * 60);
    if (!allowed) {
      return NextResponse.json({ error: 'Trop de tentatives, réessaie dans quelques minutes.' }, { status: 429 });
    }

    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    // ⚠️ Anti-triche : seuls bookingId/memberId sont lus du body. Un éventuel
    // `amount` injecté par un appelant malveillant est ignoré — le solde est
    // recalculé plus bas depuis le prix du service + le dépôt en base, il n'y
    // a littéralement aucun paramètre client qui pourrait l'influencer.
    const { bookingId, memberId } = await req.json();
    if (!bookingId || !memberId) {
      return NextResponse.json({ error: 'bookingId et memberId requis' }, { status: 400 });
    }

    const serviceSupabase = createServiceRoleClient();

    const { data: booking } = await serviceSupabase
      .from('bookings')
      .select('id, biz_id, biz_name, service_id, service_name, client_email')
      .eq('id', bookingId)
      .maybeSingle();
    if (!booking) return NextResponse.json({ error: 'Réservation introuvable' }, { status: 404 });

    const { data: profile } = await supabase
      .from('app_users')
      .select('role, biz_id')
      .eq('id', authData.user.id)
      .single();
    if (!isProAuthorizedForBiz(profile, booking.biz_id)) {
      return NextResponse.json({ error: 'Non autorisé pour ce business' }, { status: 403 });
    }

    const { data: member } = await serviceSupabase
      .from('booking_members')
      .select('*')
      .eq('id', memberId)
      .eq('booking_id', bookingId)
      .maybeSingle();
    if (!member) return NextResponse.json({ error: 'Membre introuvable' }, { status: 404 });

    const eligibility = checkMemberEligibleForSoldeCheckout(member);
    if (!eligibility.ok) {
      return NextResponse.json({ error: eligibility.error }, { status: eligibility.status });
    }

    // ── Mode test/live — même bascule que les frais de réservation ─────────
    const { data: testModeConfig } = await serviceSupabase
      .from('app_config')
      .select('value')
      .eq('key', 'mode_test_paiement')
      .maybeSingle();
    const isTestMode = testModeConfig?.value === 'true';
    const stripe = new Stripe(isTestMode ? process.env.STRIPE_TEST_SECRET_KEY! : process.env.STRIPE_SECRET_KEY!);

    // ── Idempotence : double-clic ou re-render ne doivent jamais créer une
    // deuxième session pour le même solde ────────────────────────────────
    if (member.balance_payment_status === 'pending' && member.solde_checkout_session_id) {
      try {
        const existing = await stripe.checkout.sessions.retrieve(member.solde_checkout_session_id);
        const decision = decideSoldeIdempotency({ status: existing.status, url: existing.url, id: existing.id });

        if (decision.action === 'reuse') {
          return NextResponse.json({ url: decision.url, sessionId: decision.sessionId });
        }
        if (decision.action === 'pendingConfirmation') {
          // Paiement déjà encaissé côté Stripe — le webhook n'a peut-être pas
          // encore tourné. On ne crée pas de nouvelle session ; l'UI doit
          // rester sur "en attente de confirmation" (le realtime/webhook
          // finira par faire passer status='arrived').
          return NextResponse.json({ pendingConfirmation: true });
        }
        // decision.action === 'regenerate' → on tombe dans la création ci-dessous.
        await serviceSupabase
          .from('booking_members')
          .update({ balance_payment_status: 'expired' })
          .eq('id', memberId)
          .eq('booking_id', bookingId);
      } catch (e: any) {
        console.warn('[SoldeCheckout] Session existante illisible, régénération:', e.message);
      }
    }

    // ── Calcul du solde — verrouillé côté serveur, jamais transmis par le client ──
    const { data: service } = await serviceSupabase
      .from('services')
      .select('price')
      .eq('id', booking.service_id)
      .maybeSingle();
    if (!service) return NextResponse.json({ error: 'Service introuvable' }, { status: 404 });

    const solde = computeSolde(service.price, member.deposit || 0, member.referral_discount_pct || 0);

    const soldeCheck = checkSoldeIsPositive(solde);
    if (!soldeCheck.ok) {
      return NextResponse.json({ error: soldeCheck.error }, { status: soldeCheck.status });
    }

    // ── Compte Stripe Connect du pro ────────────────────────────────────────
    const { data: settings } = await serviceSupabase
      .from('business_settings')
      .select('stripe_account_id, stripe_onboarding_complete')
      .eq('biz_id', booking.biz_id)
      .maybeSingle();
    if (!isStripeAccountConfigured(settings)) {
      return NextResponse.json({ error: 'Compte Stripe du professionnel non configuré' }, { status: 400 });
    }

    const successUrl = `${process.env.NEXT_PUBLIC_SITE_URL}/solde-regle?booking=${bookingId}`;
    const cancelUrl = `${process.env.NEXT_PUBLIC_SITE_URL}/solde-regle?booking=${bookingId}&cancelled=1`;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'eur',
            product_data: {
              name: `Solde — ${booking.service_name}`,
              description: booking.biz_name,
            },
            unit_amount: Math.round(solde * 100),
          },
          quantity: 1,
        },
      ],
      customer_email: member.email || booking.client_email || undefined,
      success_url: successUrl,
      cancel_url: cancelUrl,
      expires_at: Math.floor(Date.now() / 1000) + SESSION_LIFETIME_SECONDS,
      payment_intent_data: {
        // Pas d'application_fee_amount : 100% du solde va au pro via Connect,
        // zéro commission Book'nPay (déjà rémunérée sur les frais de
        // réservation + l'abonnement pro).
        transfer_data: { destination: settings!.stripe_account_id! },
      },
      metadata: {
        payment_type: 'balance',
        bookingId,
        memberId,
        bizId: booking.biz_id,
      },
    });

    await serviceSupabase
      .from('booking_members')
      .update({
        solde_checkout_session_id: session.id,
        balance_payment_status: 'pending',
      })
      .eq('id', memberId)
      .eq('booking_id', bookingId);

    return NextResponse.json({ url: session.url, sessionId: session.id });
  } catch (error: any) {
    if (typeof error?.type === 'string' && error.type.startsWith('Stripe')) {
      return logAndRespondStripeError('[SoldeCheckout] Erreur Stripe:', error);
    }
    return logAndRespond('[SoldeCheckout] Erreur:', error);
  }
}
