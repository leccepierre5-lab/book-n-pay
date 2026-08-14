// src/app/api/pro/stripe/remediation/route.ts
// Bloc C — bouton du bandeau dashboard pro quand Stripe réclame des
// informations KYC supplémentaires sur le compte Express (échéance
// individuelle avant le 31/10/2026). Réutilise account_onboarding (comme
// stripe/connect-onboarding/route.ts) plutôt que account_update : le pro
// peut avoir aussi bien des currently_due que des future_requirements à
// couvrir, account_onboarding gère les deux dans le même flux Stripe hébergé.
import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { logAndRespond } from '@/lib/api-error';
import { getStripeClient } from '@/lib/stripe/client';

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const { data: profile } = await supabase
      .from('app_users')
      .select('biz_id, role')
      .eq('id', authData.user.id)
      .single();
    if (!profile?.biz_id) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 403 });
    }

    const serviceSupabase = createServiceRoleClient();
    const { data: settings } = await serviceSupabase
      .from('business_settings')
      .select('stripe_account_id')
      .eq('biz_id', profile.biz_id)
      .maybeSingle();
    if (!settings?.stripe_account_id) {
      return NextResponse.json({ error: 'Aucun compte Stripe Connect associé à cet établissement' }, { status: 400 });
    }

    const stripe = await getStripeClient(serviceSupabase);
    const origin = req.headers.get('origin') || process.env.NEXT_PUBLIC_SITE_URL || 'https://book-n-pay-next.vercel.app';

    const accountLink = await stripe.accountLinks.create({
      account: settings.stripe_account_id,
      type: 'account_onboarding',
      collection_options: { fields: 'currently_due', future_requirements: 'include' },
      refresh_url: `${origin}/pro`,
      return_url: `${origin}/pro?stripe_return=1`,
    });

    return NextResponse.json({ url: accountLink.url });
  } catch (error: any) {
    return logAndRespond('[StripeRemediation] Erreur:', error);
  }
}
