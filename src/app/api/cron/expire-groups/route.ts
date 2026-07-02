// src/app/api/cron/expire-groups/route.ts
// Filet de sécurité nocturne (0 2 * * * — plan Hobby : 1x/jour).
// Traite les groupes expirés que personne n'a consultés pendant la journée.
// La logique réelle est dans src/lib/group/expireGroup.ts.
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { expireGroupByRef } from '@/lib/group/expireGroup';
import { isValidBearerSecret } from '@/lib/constant-time';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!isValidBearerSecret(authHeader, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceRoleClient();

  // ⚠️ CORRECTIF SÉCURITÉ (audit) : utilisait toujours la clé live, même
  // en mode_test_paiement. Même bascule que stripe/checkout/route.ts.
  const { data: testModeConfig } = await supabase
    .from('app_config')
    .select('value')
    .eq('key', 'mode_test_paiement')
    .maybeSingle();
  const isTestMode = testModeConfig?.value === 'true';
  const stripe = new Stripe(isTestMode ? process.env.STRIPE_TEST_SECRET_KEY! : process.env.STRIPE_SECRET_KEY!);

  const now = new Date().toISOString();

  const { data: expiredRows } = await supabase
    .from('bookings')
    .select('group_ref')
    .not('payment_deadline', 'is', null)
    .lt('payment_deadline', now)
    .eq('status', 'active')
    .not('group_ref', 'is', null);

  const groupRefs = [...new Set((expiredRows ?? []).map((r) => r.group_ref as string))];

  if (groupRefs.length === 0) {
    return NextResponse.json({ processed: 0 });
  }

  let processed = 0;
  for (const ref of groupRefs) {
    await expireGroupByRef(ref, supabase, stripe);
    processed++;
  }

  return NextResponse.json({ processed });
}
