import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { getPlanConfig, getEngagementEndDate } from '@/lib/plans-config';
import { logAndRespond } from '@/lib/api-error';

function getFirstOfNextMonth(): number {
  const now = new Date();
  const anchor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0));
  return Math.floor(anchor.getTime() / 1000);
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { data: profile } = await supabase
    .from('app_users')
    .select('biz_id, role, name')
    .eq('id', authData.user.id)
    .maybeSingle();

  if (!profile?.biz_id || !['pro', 'admin'].includes(profile.role)) {
    return NextResponse.json({ error: 'Accès interdit' }, { status: 403 });
  }

  const { paymentMethodId, paymentMethodType } = await req.json();
  if (!paymentMethodId || !['card', 'sepa_debit'].includes(paymentMethodType)) {
    return NextResponse.json({ error: 'Paramètres invalides' }, { status: 400 });
  }

  const admin = createServiceRoleClient();
  const { data: settings } = await admin
    .from('business_settings')
    .select('stripe_customer_id, plan_key, subscription_status')
    .eq('biz_id', profile.biz_id)
    .maybeSingle();

  if (settings?.subscription_status !== 'pending') {
    return NextResponse.json({ error: 'Abonnement déjà actif' }, { status: 400 });
  }

  const planKey = settings?.plan_key ?? 'starter';
  const planConfig = getPlanConfig(planKey);
  if (!planConfig) return NextResponse.json({ error: 'Plan inconnu' }, { status: 400 });

  const priceId = process.env[planConfig.stripePriceEnvKey];
  if (!priceId) {
    return NextResponse.json(
      { error: `Variable d'env manquante : ${planConfig.stripePriceEnvKey}` },
      { status: 500 }
    );
  }

  const customerId = settings?.stripe_customer_id;
  if (!customerId) {
    return NextResponse.json(
      { error: 'Customer Stripe non initialisé, relancez la configuration depuis le début.' },
      { status: 400 }
    );
  }

  // ⚠️ CORRECTIF : cette route utilisait toujours STRIPE_SECRET_KEY (live),
  // sans jamais respecter mode_test_paiement comme stripe/checkout/route.ts.
  // Indispensable tant que STRIPE_PRICE_STARTER/BUSINESS/SCALE ne pointent
  // que vers des Price objects en mode test (aucun equivalent live cree).
  const { data: testModeConfig } = await admin
    .from('app_config')
    .select('value')
    .eq('key', 'mode_test_paiement')
    .maybeSingle();
  const isTestMode = testModeConfig?.value === 'true';
  const stripe = new Stripe(isTestMode ? process.env.STRIPE_TEST_SECRET_KEY! : process.env.STRIPE_SECRET_KEY!);

  try {
    // Attacher le PM au Customer et le définir par défaut
    await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });

    // Créer la Subscription avec ancrage au 1er du mois suivant
    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      default_payment_method: paymentMethodId,
      billing_cycle_anchor: getFirstOfNextMonth(),
      proration_behavior: 'create_prorations',
      expand: ['latest_invoice.payment_intent'],
    });

    const now = new Date();
    const startDate = now.toISOString().split('T')[0];
    const engagementEnd = getEngagementEndDate(now, planKey).toISOString().split('T')[0];
    const nextBilling = new Date(subscription.current_period_end * 1000).toISOString().split('T')[0];

    // ⚠️ CORRECTIF (audit — Élevé #5) : subscription_status restait auparavant
    // 'active' dès la création de la Subscription Stripe, sans attendre la
    // confirmation réelle du paiement. On laisse 'pending' ici — c'est le
    // webhook invoice.payment_succeeded qui passe le statut à 'active'.
    await admin.from('business_settings').update({
      stripe_payment_method_id: paymentMethodId,
      payment_method_type: paymentMethodType,
      stripe_subscription_id: subscription.id,
      subscription_start_date: startDate,
      engagement_end_date: engagementEnd,
      next_billing_date: nextBilling,
      monthly_bookings_count: 0,
      bookings_count_reset_at: startDate,
    }).eq('biz_id', profile.biz_id);

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return logAndRespond('[setup-billing]', err);
  }
}
