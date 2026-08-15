// src/app/api/cron/reschedule-expire/route.ts
// Filet de sécurité quotidien (voir vercel.json — plan Hobby : 1x/jour) pour
// les propositions de report jamais consultées : le lazy-check existe déjà
// à l'ouverture du lien (bookings/reschedule GET) et à l'acceptation, mais un
// client qui n'ouvre jamais le lien ne déclenche ni l'un ni l'autre — sans ce
// cron, sa proposition resterait 'pending' indéfiniment et le pro ne serait
// jamais notifié qu'il doit reproposer ou annuler.
import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { isValidBearerSecret } from '@/lib/constant-time';
import { processBatch } from '@/lib/cron-batch';
import { notifyAdminOnFailure } from '@/lib/notify-admin';
import { notifyProRescheduleOutcome } from '@/lib/pro-notifications';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!isValidBearerSecret(authHeader, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const now = new Date().toISOString();

  const { data: expiredProposals } = await supabase
    .from('reschedule_proposals')
    .select('id, booking_id, proposed_date, proposed_time')
    .eq('status', 'pending')
    .lt('expires_at', now);

  const result = await processBatch(
    expiredProposals ?? [],
    'reschedule-expire',
    (p) => `proposal ${p.id} (booking ${p.booking_id})`,
    async (p) => {
      const { data: updated } = await supabase
        .from('reschedule_proposals')
        .update({ status: 'expired' })
        .eq('id', p.id)
        .eq('status', 'pending')
        .select()
        .maybeSingle();
      if (!updated) return; // déjà tranchée entre-temps (accept/decline) — rien à faire

      await supabase.from('booking_logs').insert({
        booking_id: p.booking_id,
        message: `RESCHEDULE_EXPIRED | proposal_id=${p.id}`,
      });

      await notifyProRescheduleOutcome(supabase, p.booking_id, {
        outcome: 'expired',
        proposedDate: p.proposed_date,
        proposedTime: p.proposed_time,
      });
    }
  );

  await notifyAdminOnFailure('cron/reschedule-expire', result);

  return NextResponse.json({ processed: result.processed, failed: result.failed });
}
