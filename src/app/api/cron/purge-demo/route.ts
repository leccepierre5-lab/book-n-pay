// src/app/api/cron/purge-demo/route.ts
// Purge quotidienne des réservations démo (is_demo=true, migration 0040) —
// le mode B en démo (create-group/route.ts) écrit réellement en base pour
// les testeurs whitelistés, ce cron nettoie ces lignes après 7 jours.
import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { isValidBearerSecret } from '@/lib/constant-time';

const DEMO_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!isValidBearerSecret(authHeader, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const cutoff = new Date(Date.now() - DEMO_RETENTION_MS).toISOString();

  const { data: rows } = await supabase
    .from('bookings')
    .select('id')
    .eq('is_demo', true)
    .lt('created_at', cutoff);

  const bookingIds = (rows ?? []).map((r) => r.id as string);

  if (bookingIds.length === 0) {
    return NextResponse.json({ deleted: 0, failed: 0 });
  }

  let deleted = 0;
  const failed: string[] = [];
  for (const id of bookingIds) {
    try {
      // booking_members supprimés explicitement AVANT bookings — la FK n'est
      // pas versionnée (table créée hors migrations, voir SECURITY_TODO.md
      // #1), impossible de confirmer ON DELETE CASCADE par lecture de code.
      // Même précaution que le rollback applicatif de create-group/route.ts.
      const { error: delMembersErr } = await supabase
        .from('booking_members')
        .delete()
        .eq('booking_id', id);
      if (delMembersErr) throw delMembersErr;

      const { error: delBookingErr } = await supabase.from('bookings').delete().eq('id', id);
      if (delBookingErr) throw delBookingErr;

      deleted++;
    } catch (err: any) {
      // Un échec sur une réservation ne doit pas bloquer la purge des
      // autres (voir expire-groups/route.ts, incident 22/07).
      console.error(`[purge-demo] Échec sur la réservation ${id}:`, err?.message ?? err);
      failed.push(id);
    }
  }

  if (failed.length > 0) {
    console.error(`[purge-demo] ${failed.length} réservation(s) en échec sur ${bookingIds.length} :`, failed);
  }

  return NextResponse.json({ deleted, failed: failed.length, failedIds: failed });
}
