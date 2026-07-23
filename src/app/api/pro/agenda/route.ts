import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { logAndRespond, withErrorHandling } from '@/lib/api-error';
import { parseParisDatetime } from '@/lib/booking-utils';
import { buildAgendaColumns } from '@/lib/agenda';

async function getProBizId(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return null;
  const { data: profile } = await supabase
    .from('app_users')
    .select('biz_id, role')
    .eq('id', authData.user.id)
    .maybeSingle();
  if (!profile?.biz_id || !['pro', 'admin'].includes(profile.role)) return null;
  return profile.biz_id as string;
}

// GET /api/pro/agenda?date=YYYY-MM-DD — planning par praticien pour une journée
// (RDV + horaires de travail + absences), agrégé colonne par colonne.
// bizId résolu depuis la session pro, jamais depuis un paramètre client.
export const GET = withErrorHandling('[Agenda]', async (req: NextRequest) => {
  const supabase = await createClient();
  const bizId = await getProBizId(supabase);
  if (!bizId) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const date = searchParams.get('date');
  if (!date) return NextResponse.json({ error: 'date requis' }, { status: 400 });

  const admin = createServiceRoleClient();

  const [{ data: staffRows, error: staffError }, { data: bizRow }] = await Promise.all([
    admin
      .from('staff')
      .select('id, name, emoji, role')
      .eq('biz_id', bizId)
      .eq('is_active', true)
      .order('created_at', { ascending: true }),
    admin.from('businesses').select('open_time, close_time').eq('id', bizId).maybeSingle(),
  ]);

  if (staffError) return logAndRespond('[Agenda] Erreur staff:', staffError);

  const staffIds = (staffRows ?? []).map((s) => s.id);

  // Bornes de la journée demandée en instants absolus (heure Paris) — même
  // pattern que computeStaffAvailabilityForDay (staff-assignment.ts) pour
  // filtrer staff_absences (TIMESTAMPTZ, peut chevaucher minuit).
  const dayStartAt = parseParisDatetime(date, '00:00');
  const dayEndAt = new Date(dayStartAt.getTime() + 24 * 60 * 60 * 1000);

  const [{ data: scheduleRows, error: scheduleError }, { data: absenceRows, error: absenceError }, { data: bookingRows, error: bookingError }] =
    await Promise.all([
      staffIds.length > 0
        ? admin.from('staff_schedules').select('staff_id, day_of_week, open_time, close_time').in('staff_id', staffIds)
        : Promise.resolve({ data: [], error: null }),
      staffIds.length > 0
        ? admin
            .from('staff_absences')
            .select('staff_id, start_at, end_at, reason')
            .in('staff_id', staffIds)
            .lt('start_at', dayEndAt.toISOString())
            .gt('end_at', dayStartAt.toISOString())
        : Promise.resolve({ data: [], error: null }),
      admin
        .from('bookings')
        .select('id, staff_id, time, client_name, service_name, services(duration_minutes, allow_group)')
        .eq('biz_id', bizId)
        .eq('date', date)
        .neq('status', 'cancelled'),
    ]);

  if (scheduleError) return logAndRespond('[Agenda] Erreur horaires:', scheduleError);
  if (absenceError) return logAndRespond('[Agenda] Erreur absences:', absenceError);
  if (bookingError) return logAndRespond('[Agenda] Erreur réservations:', bookingError);

  const bookings = (bookingRows ?? []).map((b: any) => ({
    id: b.id as string,
    staff_id: b.staff_id as string | null,
    // PostgREST renvoie "HH:MM:SS" pour une colonne `time` — tronqué pour
    // matcher le format "HH:MM" utilisé partout ailleurs (voir pitfall projet).
    time: (b.time as string).slice(0, 5),
    duration_minutes: b.services?.duration_minutes ?? 30,
    service_name: (b.service_name as string) ?? '',
    client_name: (b.client_name as string) ?? null,
    allow_group: b.services?.allow_group ?? false,
  }));

  const columns = buildAgendaColumns({
    date,
    businessOpenTime: bizRow?.open_time ?? null,
    businessCloseTime: bizRow?.close_time ?? null,
    staff: staffRows ?? [],
    schedules: scheduleRows ?? [],
    absences: absenceRows ?? [],
    bookings,
  });

  return NextResponse.json({
    date,
    businessHours: bizRow ? { open_time: bizRow.open_time, close_time: bizRow.close_time } : null,
    columns,
  });
});
