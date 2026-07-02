// src/app/api/cron/cleanup-expired-invites/route.ts
// ⚠️ Ce cron n'existe dans AUCUNE fonction Base44 d'origine. En auditant le
// code après plusieurs tours de migration, j'ai constaté que l'action
// `cancelExpiredBooking` de /api/bookings/group n'était appelée par RIEN —
// ni un cron, ni le front (qui n'a pas encore d'écran "JoinGroup" dédié).
// Sans déclenchement, les invitations de groupe expirées (30 min) restaient
// en statut 'invite' indéfiniment, sans jamais libérer la place dans le
// groupe ni annuler le booking si personne n'a payé. Ce cron corrige ce
// trou en parcourant tous les bookings actifs ayant des invites expirés.
import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { isValidBearerSecret } from '@/lib/constant-time';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!isValidBearerSecret(authHeader, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const now = new Date().toISOString();

  const { data: expiredMembers } = await supabase
    .from('booking_members')
    .select('id, booking_id, status, invite_expiry')
    .eq('status', 'invite')
    .lt('invite_expiry', now);

  if (!expiredMembers || expiredMembers.length === 0) {
    return NextResponse.json({ processed: 0, cancelledBookings: 0 });
  }

  const affectedBookingIds = [...new Set(expiredMembers.map((m) => m.booking_id))];
  let cancelledBookings = 0;

  for (const member of expiredMembers) {
    await supabase.from('booking_members').update({ status: 'cancelled' }).eq('id', member.id);
  }

  for (const bookingId of affectedBookingIds) {
    const { data: remaining } = await supabase
      .from('booking_members')
      .select('status')
      .eq('booking_id', bookingId)
      .in('status', ['paid', 'arrived']);

    if (!remaining || remaining.length === 0) {
      await supabase.from('bookings').update({ status: 'cancelled' }).eq('id', bookingId);
      cancelledBookings++;
    }
  }

  console.log(
    `[CleanupExpiredInvites] ${expiredMembers.length} invite(s) expirée(s) nettoyée(s), ${cancelledBookings} booking(s) annulé(s)`
  );

  return NextResponse.json({
    processed: expiredMembers.length,
    affectedBookings: affectedBookingIds.length,
    cancelledBookings,
  });
}
