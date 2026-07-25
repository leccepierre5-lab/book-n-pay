// src/app/api/pro/bookings-month/route.ts
// Alimente ProCalendar.tsx quand le pro change de mois.
//
// CORRECTIF (audit sécurité 25/07) : cette route acceptait `bizId` en query
// param sans aucun check applicatif, en s'appuyant entièrement sur la policy
// RLS `owns_biz()` — laquelle n'est PAS versionnée dans ce repo (migration
// 0038 en pause, config Supabase Dashboard uniquement, invérifiable par le
// code). Même pattern que `pro/overage-status` : on authentifie, on dérive
// `biz_id` du PROFIL serveur, et on ignore purement et simplement tout
// `bizId` fourni par l'appelant — ProCalendar.tsx n'a jamais eu besoin de
// passer autre chose que le biz_id du pro connecté, donc aucune régression
// pour l'usage légitime.
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getProBookingsForMonth } from '@/lib/queries/pro';
import { withErrorHandling } from '@/lib/api-error';

export const GET = withErrorHandling('[BookingsMonth]', async (req: NextRequest) => {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { data: profile } = await supabase
    .from('app_users')
    .select('biz_id, role')
    .eq('id', authData.user.id)
    .maybeSingle();

  if (!profile?.biz_id || !['pro', 'admin'].includes(profile.role)) {
    return NextResponse.json({ error: 'Accès interdit' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const year = searchParams.get('year');
  const month = searchParams.get('month'); // 0-indexé (janvier = 0)

  if (year === null || month === null) {
    return NextResponse.json({ error: 'year, month requis' }, { status: 400 });
  }

  const bookings = await getProBookingsForMonth(profile.biz_id, Number(year), Number(month));
  return NextResponse.json({ bookings });
});
