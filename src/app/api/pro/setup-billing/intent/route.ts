import { NextResponse } from 'next/server';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { getStripeClient } from '@/lib/stripe/client';
import { withErrorHandling } from '@/lib/api-error';

export const GET = withErrorHandling('[SetupBillingIntent]', async () => {
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

  const admin = createServiceRoleClient();

  // Les Price objects Starter/Business/Scale (STRIPE_PRICE_*) n'existent
  // aujourd'hui qu'en mode test — indispensable tant qu'aucun equivalent
  // live n'a ete cree dans Stripe.
  const stripe = await getStripeClient(admin);

  const { data: settings } = await admin
    .from('business_settings')
    .select('stripe_customer_id, plan_key')
    .eq('biz_id', profile.biz_id)
    .maybeSingle();

  let customerId = settings?.stripe_customer_id ?? null;

  // Créer le Customer s'il n'existe pas encore
  if (!customerId) {
    const { data: biz } = await admin
      .from('businesses')
      .select('name')
      .eq('id', profile.biz_id)
      .maybeSingle();

    const customer = await stripe.customers.create({
      email: authData.user.email,
      name: biz?.name ?? profile.name ?? undefined,
      metadata: { biz_id: profile.biz_id },
    });
    customerId = customer.id;

    await admin.from('business_settings').upsert({
      biz_id: profile.biz_id,
      stripe_customer_id: customerId,
    });
  }

  // SetupIntent off-session supportant CB et SEPA
  const intent = await stripe.setupIntents.create({
    customer: customerId,
    payment_method_types: ['card', 'sepa_debit'],
    usage: 'off_session',
  });

  return NextResponse.json({
    clientSecret: intent.client_secret,
    planKey: settings?.plan_key ?? 'starter',
  });
});
