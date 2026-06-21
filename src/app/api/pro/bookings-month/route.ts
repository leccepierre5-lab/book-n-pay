// src/app/api/pro/bookings-month/route.ts
// Alimente ProCalendar.tsx quand le pro change de mois. RLS (owns_biz)
// garantit qu'un pro ne voit que les bookings de son propre business.
import { NextRequest, NextResponse } from 'next/server';
import { getProBookingsForMonth } from '@/lib/queries/pro';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const bizId = searchParams.get('bizId');
  const year = searchParams.get('year');
  const month = searchParams.get('month'); // 0-indexé (janvier = 0)

  if (!bizId || year === null || month === null) {
    return NextResponse.json({ error: 'bizId, year, month requis' }, { status: 400 });
  }

  const bookings = await getProBookingsForMonth(bizId, Number(year), Number(month));
  return NextResponse.json({ bookings });
}
