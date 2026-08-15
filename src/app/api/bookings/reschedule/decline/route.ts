// src/app/api/bookings/reschedule/decline/route.ts
// Le client refuse le créneau proposé (migration 0055) — public, token
// uniquement. Ne touche jamais à la réservation elle-même : elle reste sur
// son créneau d'origine, au pro de décider la suite (reproposer, annuler,
// appeler).
import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { logAndRespond } from '@/lib/api-error';
import { notifyProRescheduleOutcome } from '@/lib/pro-notifications';

export async function POST(req: NextRequest) {
  try {
    const { allowed } = await checkRateLimit(`reschedule-decline:${getClientIp(req)}`, 10, 10 * 60);
    if (!allowed) {
      return NextResponse.json({ error: 'Trop de tentatives, réessaie dans quelques minutes.' }, { status: 429 });
    }

    const { token } = await req.json();
    if (!token) return NextResponse.json({ error: 'token requis' }, { status: 400 });

    const supabase = createServiceRoleClient();
    const { data: proposal } = await supabase
      .from('reschedule_proposals')
      .select('*')
      .eq('token', token)
      .maybeSingle();
    if (!proposal) return NextResponse.json({ error: 'Lien invalide' }, { status: 404 });

    if (proposal.status === 'declined') {
      return NextResponse.json({ success: true, alreadyDeclined: true });
    }
    if (proposal.status !== 'pending') {
      return NextResponse.json({ error: 'Cette proposition n\'est plus valide', status: proposal.status }, { status: 409 });
    }

    const { data: updated } = await supabase
      .from('reschedule_proposals')
      .update({ status: 'declined', responded_at: new Date().toISOString() })
      .eq('id', proposal.id)
      .eq('status', 'pending')
      .select()
      .maybeSingle();

    if (!updated) {
      // Course avec une acceptation/expiration concurrente entre notre
      // lecture et cet UPDATE — état déjà tranché ailleurs, rien à faire ici.
      return NextResponse.json({ error: 'Cette proposition n\'est plus valide' }, { status: 409 });
    }

    await supabase.from('booking_logs').insert({
      booking_id: proposal.booking_id,
      message: `RESCHEDULE_DECLINED | proposal_id=${proposal.id}`,
    });

    await notifyProRescheduleOutcome(supabase, proposal.booking_id, {
      outcome: 'declined',
      proposedDate: proposal.proposed_date,
      proposedTime: proposal.proposed_time,
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return logAndRespond('[RescheduleDecline] Erreur:', error);
  }
}
