// src/app/api/bookings/reschedule/route.ts
// Consultation publique d'une proposition de report par token (lien email) —
// migration 0055. Route publique : le seul contrôle d'accès est de connaître
// le token (haute entropie, voir generateRescheduleToken). Ne renvoie donc
// que les champs affichés par la page cliente — jamais de données sur
// d'autres réservations/membres (même précaution IDOR que bookings/group,
// voir SECURITY_TODO.md #2).
import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get('token');
  if (!token) return NextResponse.json({ error: 'token requis' }, { status: 400 });

  const supabase = createServiceRoleClient();
  const { data: proposal } = await supabase
    .from('reschedule_proposals')
    .select('id, booking_id, original_date, original_time, proposed_date, proposed_time, status, reason, expires_at')
    .eq('token', token)
    .maybeSingle();

  if (!proposal) return NextResponse.json({ error: 'Lien invalide' }, { status: 404 });

  let status = proposal.status;
  // Lazy-check : le cron (filet de sécurité quotidien) n'est peut-être pas
  // encore passé — on ne veut jamais afficher "en attente" sur un lien
  // objectivement expiré. Conditionné sur status='pending' pour ne jamais
  // écraser un accepted/declined/slot_taken déjà acté.
  if (status === 'pending' && new Date(proposal.expires_at) < new Date()) {
    await supabase
      .from('reschedule_proposals')
      .update({ status: 'expired' })
      .eq('id', proposal.id)
      .eq('status', 'pending');
    status = 'expired';
  }

  const { data: booking } = await supabase
    .from('bookings')
    .select('biz_name, service_name')
    .eq('id', proposal.booking_id)
    .maybeSingle();

  return NextResponse.json({
    status,
    bizName: booking?.biz_name ?? null,
    serviceName: booking?.service_name ?? null,
    originalDate: proposal.original_date,
    originalTime: proposal.original_time,
    proposedDate: proposal.proposed_date,
    proposedTime: proposal.proposed_time,
    reason: proposal.reason,
    expiresAt: proposal.expires_at,
  });
}
