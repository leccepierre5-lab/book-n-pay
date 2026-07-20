// src/app/api/stripe/transactions/route.ts
// Port de base44/functions/stripeTransactions/entry.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { logAndRespond } from '@/lib/api-error';
import { getStripeClient } from '@/lib/stripe/client';

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const { bizId, limit = 50 } = await req.json();
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
    const { data: settings } = await serviceSupabase
      .from('business_settings')
      .select('stripe_account_id, stripe_onboarding_complete')
      .eq('biz_id', bizId)
      .maybeSingle();

    const stripeAccountId = settings?.stripe_account_id;
    let charges: any[] = [];

    if (stripeAccountId && settings?.stripe_onboarding_complete) {
      const result = await stripe.charges.list(
        { limit, expand: ['data.payment_intent'] },
        { stripeAccount: stripeAccountId }
      );
      charges = result.data;
    } else {
      const sessions = await stripe.checkout.sessions.list({ limit, expand: ['data.payment_intent'] });
      charges = sessions.data
        .filter((s) => s.metadata?.bizId === bizId && s.payment_status === 'paid')
        .map((s) => ({
          id: s.id,
          amount: s.amount_total,
          currency: s.currency,
          status: 'succeeded',
          created: s.created,
          metadata: s.metadata,
          billing_details: { name: s.customer_details?.name || s.metadata?.clientName || 'Client' },
          customer_email: s.customer_details?.email || s.metadata?.clientEmail || '',
        }));
    }

    const transactions = charges.map((c: any) => ({
      id: c.id,
      amount: c.amount / 100,
      currency: (c.currency || 'eur').toUpperCase(),
      status: c.status,
      created: c.created,
      clientName: c.billing_details?.name || c.metadata?.clientName || 'Client',
      clientEmail: c.customer_email || c.metadata?.clientEmail || '',
      serviceName: c.metadata?.serviceName || '',
      date: c.metadata?.date || '',
      time: c.metadata?.time || '',
      bizName: c.metadata?.bizName || '',
    }));

    return NextResponse.json({ transactions, stripeAccountId: stripeAccountId || null });
  } catch (error: any) {
    return logAndRespond('[Transactions] Erreur:', error);
  }
}
