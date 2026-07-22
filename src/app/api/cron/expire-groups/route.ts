// src/app/api/cron/expire-groups/route.ts
// Filet de sécurité nocturne (0 2 * * * — plan Hobby : 1x/jour).
// Traite les groupes expirés que personne n'a consultés pendant la journée.
// La logique réelle est dans src/lib/group/expireGroup.ts.
import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { expireGroupByRef } from '@/lib/group/expireGroup';
import { isValidBearerSecret } from '@/lib/constant-time';
import { getStripeClient } from '@/lib/stripe/client';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!isValidBearerSecret(authHeader, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const stripe = await getStripeClient(supabase);

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
  const failed: string[] = [];
  for (const ref of groupRefs) {
    try {
      await expireGroupByRef(ref, supabase, stripe);
      processed++;
    } catch (err: any) {
      // Un groupe en erreur ne doit pas bloquer les remboursements des
      // autres groupes de la nuit — voir audit du 22/07 (échec silencieux
      // constaté : la boucle s'arrêtait net sur la première exception).
      console.error(`[expire-groups] Échec sur le groupe ${ref}:`, err?.message ?? err);
      failed.push(ref);
    }
  }

  if (failed.length > 0) {
    console.error(`[expire-groups] ${failed.length} groupe(s) en échec sur ${groupRefs.length} :`, failed);
  }

  return NextResponse.json({ processed, failed: failed.length, failedRefs: failed });
}
