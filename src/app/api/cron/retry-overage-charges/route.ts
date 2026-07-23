// src/app/api/cron/retry-overage-charges/route.ts
// Cron quotidien (voir vercel.json — plan Hobby Vercel limité à 1x/jour) —
// retente les charges hors-forfait dont le retry à +24h est arrivé à
// échéance (voir 0020_overage_charges.sql).
// pending → retry_scheduled (webhook, tentative immédiate) → ce cron tente
// une 2e et dernière fois : succès → paid, échec → failed (bandeau urgent pro).
import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { attemptOverageCharge, type OverageChargeRow } from '@/lib/stripe/overageCharge';
import { isValidBearerSecret } from '@/lib/constant-time';
import { processBatch } from '@/lib/cron-batch';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!isValidBearerSecret(authHeader, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceRoleClient();

  const { data: dueCharges } = await supabase
    .from('overage_charges')
    .select('id, biz_id, booking_id, amount_ht, status, attempt_count')
    .eq('status', 'retry_scheduled')
    .lte('next_retry_at', new Date().toISOString());

  let paid = 0;
  let failed = 0;

  // processBatch (lib/cron-batch.ts) isole chaque charge — attemptOverageCharge
  // catch déjà l'échec Stripe lui-même en interne, mais pas une exception en
  // amont (ex: getStripeClient) qui tuerait sinon le retry de toutes les
  // charges suivantes (même classe de bug qu'expire-groups, incident 22/07).
  // `result.failed` (exceptions) est distinct de la variable `failed`
  // ci-dessus (issue métier Stripe, ex. carte refusée).
  const result = await processBatch(
    dueCharges || [],
    'retry-overage-charges',
    (c) => `charge ${c.id} (biz ${c.biz_id})`,
    async (charge) => {
      const outcome = await attemptOverageCharge(supabase, charge as OverageChargeRow);
      if (outcome === 'paid') paid++;
      if (outcome === 'failed') failed++;
    }
  );

  console.log(`[retryOverageCharges] ${dueCharges?.length ?? 0} charge(s) retentée(s) — ${paid} payée(s), ${failed} échouée(s)`);
  return NextResponse.json({ success: true, retried: dueCharges?.length ?? 0, paid, failed, erred: result.failed });
}
