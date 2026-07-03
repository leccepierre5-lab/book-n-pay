// src/app/api/bookings/availability/route.ts
// Renvoie le nombre de personnes déjà inscrites par créneau pour un biz/date
// donné — équivalent de guestsAtSlot() mais calculé côté serveur avec des
// données fraîches (pas de risque de désync avec un state client périmé).
//
// `counts` (occupation par tête, tous praticiens confondus) reste inchangé —
// c'est toujours ce que consomme le flow de réservation aujourd'hui, y
// compris pour les services collectifs (allow_group === true), qui gardent
// ce mécanisme (un praticien/une salle sert plusieurs personnes à la fois).
//
// `staffAvailability` est un champ additif, calculé uniquement si `serviceId`
// est fourni ET que le service est individuel (allow_group === false).
// Le flow de réservation ne l'exploite pas encore (StepDateTime.tsx n'envoie
// pas serviceId) — câblage prévu côté UI dans une étape suivante. Absence de
// serviceId = comportement 100% identique à avant.
import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { computeStaffAvailability } from '@/lib/staff-availability';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const bizId = searchParams.get('bizId');
  const date = searchParams.get('date');
  const serviceId = searchParams.get('serviceId');

  if (!bizId || !date) {
    return NextResponse.json({ error: 'bizId et date requis' }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
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

  const responseBody: {
    counts: Record<string, number>;
    staffAvailability?: Record<string, { freeCount: number; freeStaffIds: string[] }>;
  } = { counts };

  if (serviceId) {
    const { data: service } = await supabase
      .from('services')
      .select('duration_minutes, allow_group')
      .eq('id', serviceId)
      .maybeSingle();

    if (service && service.allow_group === false) {
      const { data: business } = await supabase
        .from('businesses')
        .select('open_time, close_time, open_days')
        .eq('id', bizId)
        .maybeSingle();

      const { data: staffRows } = await supabase
        .from('staff')
        .select('id, name')
        .eq('biz_id', bizId)
        .eq('is_active', true);

      const staffIds = (staffRows || []).map((s) => s.id);

      const [{ data: scheduleRows }, { data: staffBookingRows }] = staffIds.length
        ? await Promise.all([
            supabase
              .from('staff_schedules')
              .select('staff_id, day_of_week, open_time, close_time')
              .in('staff_id', staffIds),
            supabase
              .from('bookings')
              .select('staff_id, time, services(duration_minutes)')
              .eq('biz_id', bizId)
              .eq('date', date)
              .neq('status', 'cancelled')
              .in('staff_id', staffIds),
          ])
        : [{ data: [] }, { data: [] }];

      const existingBookings = (staffBookingRows || []).map((b: any) => ({
        staff_id: b.staff_id as string,
        time: b.time as string,
        duration_minutes: b.services?.duration_minutes ?? 30,
      }));

      responseBody.staffAvailability = computeStaffAvailability({
        date,
        durationMinutes: service.duration_minutes,
        businessOpenTime: business?.open_time ?? null,
        businessCloseTime: business?.close_time ?? null,
        businessOpenDays: business?.open_days ?? [],
        staff: staffRows || [],
        schedules: scheduleRows || [],
        existingBookings,
      });
    }
  }

  return NextResponse.json(responseBody);
}
