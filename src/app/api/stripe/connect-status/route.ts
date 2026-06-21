// src/app/api/stripe/connect-status/route.ts
// Port de base44/functions/stripeConnectStatus/entry.ts
//
// ⚠️ CORRECTIF DE SÉCURITÉ (trouvé en audit) : cette route n'avait aucune
// vérification d'authentification ni d'autorisation — n'importe qui
// connaissant un bizId pouvait interroger le statut Stripe Connect d'un
// pro (stripeAccountId, état KYC). Corrigé en exigeant une session
// authentifiée appartenant au pro propriétaire (ou admin).
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const { bizId } = await req.json();
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
    const { data: settings } = await serviceSupabase
      .from('business_settings')
      .select('*')
      .eq('biz_id', bizId)
      .maybeSingle();

    if (!settings?.stripe_account_id) {
      return NextResponse.json({ connected: false, onboardingComplete: false });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
    const account = await stripe.accounts.retrieve(settings.stripe_account_id);
    const onboardingComplete = !!(account.details_submitted && account.charges_enabled);

    if (onboardingComplete && !settings.stripe_onboarding_complete) {
      await serviceSupabase
        .from('business_settings')
        .update({ stripe_onboarding_complete: true })
        .eq('biz_id', bizId);
    }

    return NextResponse.json({
      connected: true,
      onboardingComplete,
      stripeAccountId: settings.stripe_account_id,
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
    });
  } catch (error: any) {
    console.error('[ConnectStatus] Erreur:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
