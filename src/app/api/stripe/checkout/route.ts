// src/app/api/stripe/checkout/route.ts
// Port de base44/functions/stripeCheckout/entry.ts
//
// Crée une session Stripe Checkout pour les frais de réservation + frais de
// gestion. Active le transfert Stripe Connect (application_fee_amount) si le
// pro a terminé son onboarding. Accessible sans authentification : les
// invités non connectés doivent pouvoir payer leur place dans une résa de groupe.
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { calcFraisGestion } from '@/lib/booking-utils';

export async function POST(req: NextRequest) {
  try {
    const supabase = createServiceRoleClient();
    const body = await req.json();
    const {
      amount,
      currency = 'eur',
      bookingMeta,
      successUrl,
      cancelUrl,
      fraisGestion: fraisGestionInput,
      groupSize = 1,
    } = body;

    if (!amount || amount < 1) {
      return NextResponse.json({ error: 'Montant invalide' }, { status: 400 });
    }

    if (parseInt(groupSize, 10) > 23) {
      return NextResponse.json(
        { error: 'Les groupes sont limités à 23 personnes maximum' },
        { status: 400 }
      );
    }

    // Mode test/live dynamique — lit app_config (équivalent AppConfig Base44)
    const { data: testModeConfig } = await supabase
      .from('app_config')
      .select('value')
      .eq('key', 'mode_test_paiement')
      .maybeSingle();
    const isTestMode = testModeConfig?.value === 'true';

    const stripeKey = isTestMode
      ? process.env.STRIPE_TEST_SECRET_KEY!
      : process.env.STRIPE_SECRET_KEY!;
    const stripe = new Stripe(stripeKey);

    // Barème dynamique des frais de gestion (avec fallback local si AppConfig absent)
    let fraisGestion = fraisGestionInput;
    if (!fraisGestion || fraisGestion < 1.99 || fraisGestion > 9.99) {
      const { data: configs } = await supabase
        .from('app_config')
        .select('key, value')
        .like('key', 'frais_gestion_palier_%');

      const cfg: Record<string, number> = {};
      (configs || []).forEach((row) => {
        const n = parseFloat(row.value);
        if (!isNaN(n)) cfg[row.key] = n;
      });

      if (amount >= 100) fraisGestion = cfg.frais_gestion_palier_4 ?? 2.5;
      else if (amount >= 80) fraisGestion = cfg.frais_gestion_palier_3 ?? 2.3;
      else if (amount >= 50) fraisGestion = cfg.frais_gestion_palier_2 ?? 2.1;
      else fraisGestion = cfg.frais_gestion_palier_1 ?? calcFraisGestion(amount);
    }

    // Compte Stripe Connect du pro, si onboarding terminé
    let professionalStripeId: string | null = null;
    if (bookingMeta?.bizId) {
      const { data: settings } = await supabase
        .from('business_settings')
        .select('stripe_account_id, stripe_onboarding_complete')
        .eq('biz_id', bookingMeta.bizId)
        .maybeSingle();

      if (settings?.stripe_account_id && settings.stripe_onboarding_complete) {
        professionalStripeId = settings.stripe_account_id;
      }
    }

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency,
            product_data: {
              name: `Frais de réservation — ${bookingMeta?.serviceName || "Book'nPay"}`,
              description: `${bookingMeta?.bizName || ''} — ${bookingMeta?.date || ''} à ${bookingMeta?.time || ''}`,
            },
            unit_amount: Math.round(amount * 100),
          },
          quantity: 1,
        },
        {
          price_data: {
            currency,
            product_data: {
              name: "Frais de gestion Book'nPay",
              description: 'Frais de réservation sécurisée',
            },
            unit_amount: Math.round(fraisGestion * 100),
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: successUrl,
      cancel_url: cancelUrl,
      customer_email: bookingMeta?.clientEmail || undefined,
      metadata: {
        bookingId: bookingMeta?.bookingId || '',
        memberId: bookingMeta?.memberId || '',
        groupRef: bookingMeta?.groupRef || '',
        bizId: bookingMeta?.bizId || '',
        bizName: bookingMeta?.bizName || '',
        serviceName: bookingMeta?.serviceName || '',
        date: bookingMeta?.date || '',
        time: bookingMeta?.time || '',
        clientName: bookingMeta?.clientName || '',
        clientPhone: bookingMeta?.clientPhone || '',
        clientEmail: bookingMeta?.clientEmail || '',
        depositAmount: String(amount),
      },
    };

    if (professionalStripeId) {
      sessionParams.payment_intent_data = {
        application_fee_amount: Math.round(fraisGestion * 100),
        transfer_data: { destination: professionalStripeId },
      };
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    return NextResponse.json({ url: session.url, sessionId: session.id });
  } catch (error: any) {
    console.error('[Checkout] Erreur:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
