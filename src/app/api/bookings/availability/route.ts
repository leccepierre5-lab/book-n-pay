// src/app/api/bookings/availability/route.ts
// Renvoie le nombre de personnes déjà inscrites par créneau pour un biz/date
// donné — équivalent de guestsAtSlot() mais calculé côté serveur avec des
// données fraîches (pas de risque de désync avec un state client périmé).
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const bizId = searchParams.get('bizId');
  const date = searchParams.get('date');

  if (!bizId || !date) {
    return NextResponse.json({ error: 'bizId et date requis' }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: bookings, error } = await supabase
    .from('bookings')
    .select('time, booking_members(status)')
    .eq('biz_id', bizId)
    .eq('date', date)
    .neq('status', 'cancelled');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const counts: Record<string, number> = {};
  for (const b of bookings || []) {
    const activeMembers = (b.booking_members || []).filter((m: any) => m.status !== 'cancelled');
    counts[b.time] = (counts[b.time] || 0) + activeMembers.length;
  }

  return NextResponse.json({ counts });
}
