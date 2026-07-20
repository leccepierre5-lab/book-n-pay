// src/app/api/stripe/connect-onboarding/route.ts
// Port de base44/functions/stripeConnectOnboarding/entry.ts
// Crée (ou réutilise) un compte Stripe Express pour un pro, puis génère le
// lien d'onboarding KYC. Réservé aux pros authentifiés.
import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { logAndRespond } from '@/lib/api-error';
import { getStripeClient } from '@/lib/stripe/client';

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const { bizId, bizName, returnUrl } = await req.json();
    if (!bizId) return NextResponse.json({ error: 'bizId requis' }, { status: 400 });

    const { data: profile } = await supabase
      .from('app_users')
      .select('role, biz_id')
      .eq('id', authData.user.id)
      .single();
    if (profile?.role !== 'admin' && profile?.biz_id !== bizId) {
      return NextResponse.json({ error: 'Non autorisé pour ce business' }, { status: 403 });
    }

    const serviceSupabase = createServiceRoleClient();

    const stripe = await getStripeClient(serviceSupabase);

    const { data: existing } = await serviceSupabase
      .from('business_settings')
      .select('*')
      .eq('biz_id', bizId)
      .maybeSingle();

    let stripeAccountId = existing?.stripe_account_id;

    if (!stripeAccountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        country: 'FR',
        metadata: { bizId, bizName: bizName || bizId },
      });
      stripeAccountId = account.id;
      console.log('[Connect] Nouveau compte Stripe créé:', stripeAccountId, 'pour', bizId);

      await serviceSupabase
        .from('business_settings')
        .upsert({ biz_id: bizId, stripe_account_id: stripeAccountId, stripe_onboarding_complete: false });
    }

    const accountLink = await stripe.accountLinks.create({
      account: stripeAccountId,
      refresh_url: returnUrl || `${req.headers.get('origin')}/pro`,
      return_url: returnUrl || `${req.headers.get('origin')}/pro?stripe_return=1`,
      type: 'account_onboarding',
    });

    return NextResponse.json({ url: accountLink.url, stripeAccountId });
  } catch (error: any) {
    return logAndRespond('[Connect] Erreur:', error);
  }
}
