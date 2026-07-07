// src/lib/staff-assignment.ts
// Chargement des données de dispo par praticien (I/O Supabase) + appel de la
// fonction Postgres atomique assign_staff_and_create_booking (voir
// supabase/migrations/0024_assign_staff_booking.sql). computeStaffAvailability
// (staff-availability.ts) reste pur — utilisé ici uniquement pour donner une
// liste de candidats plausibles au client ; la fonction SQL re-vérifie tout
// sous verrou avant d'insérer, donc une donnée légèrement périmée ici (entre
// le chargement et l'appel RPC) n'est jamais une faille — juste, au pire, un
// candidat proposé en premier qui s'avère occupé et sera resauté par la RPC
// si plusieurs candidats sont passés.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Booking } from './database.types';
import { computeStaffAvailability } from './staff-availability';

export interface StaffAvailabilityForDay {
  staffRows: { id: string; name: string }[];
  availability: Record<string, { freeCount: number; freeStaffIds: string[] }>;
}

// Charge staff actif + horaires + réservations du jour pour un business, et
// calcule la dispo par créneau — factorise le bloc dupliqué entre
// availability/route.ts et create/route.ts.
export async function computeStaffAvailabilityForDay(
  supabase: SupabaseClient,
  bizId: string,
  date: string,
  durationMinutes: number
): Promise<StaffAvailabilityForDay | null> {
  const { data: staffRows, error: staffError } = await supabase
    .from('staff')
    .select('id, name')
    .eq('biz_id', bizId)
    .eq('is_active', true);

  // Distingue explicitement "erreur de requête" de "aucun staff actif" — sans
  // ça, un échec réseau/RLS transitoire retournerait null exactement comme un
  // business sans staff, et create/route.ts tomberait silencieusement sur le
  // chemin non protégé (insert direct sans passer par la RPC anti-collision).
  if (staffError) throw staffError;

  const staffIds = (staffRows || []).map((s) => s.id);
  if (staffIds.length === 0) return null;

  const [{ data: bizHours }, { data: scheduleRows }, { data: staffBookingRows }] = await Promise.all([
    supabase
      .from('businesses')
      .select('open_time, close_time, open_days')
      .eq('id', bizId)
      .maybeSingle(),
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
  ]);

  const existingBookings = (staffBookingRows || []).map((b: any) => ({
    staff_id: b.staff_id as string,
    time: b.time as string,
    duration_minutes: b.services?.duration_minutes ?? 30,
  }));

  const availability = computeStaffAvailability({
    date,
    durationMinutes,
    businessOpenTime: bizHours?.open_time ?? null,
    businessCloseTime: bizHours?.close_time ?? null,
    businessOpenDays: bizHours?.open_days ?? [],
    staff: staffRows || [],
    schedules: scheduleRows || [],
    existingBookings,
  });

  return { staffRows: staffRows || [], availability };
}

export interface AssignStaffParams {
  bizId: string;
  bizName: string;
  serviceId: string;
  serviceName: string;
  date: string;
  time: string;
  durationMinutes: number;
  candidateStaffIds: string[]; // ordre de préférence — [staffId] si choisi par le client
  clientId: string | null;
  clientPhone: string | null;
  clientName: string | null;
  clientEmail: string | null;
  groupRef?: string | null; // NULL pour une réservation individuelle (create/route.ts)
  paymentDeadline?: string | null;
}

// Verrouille les candidats, re-vérifie leur dispo sous verrou et insère la
// réservation, le tout dans une seule transaction côté Postgres (voir la
// migration pour le détail du verrouillage). Renvoie null si aucun candidat
// n'est réellement libre — l'appelant traduit ça en 409.
export async function assignStaffAndCreateBooking(
  supabase: SupabaseClient,
  params: AssignStaffParams
): Promise<Booking | null> {
  const { data, error } = await supabase.rpc('assign_staff_and_create_booking', {
    p_biz_id: params.bizId,
    p_biz_name: params.bizName,
    p_service_id: params.serviceId,
    p_service_name: params.serviceName,
    p_date: params.date,
    p_time: params.time,
    p_duration_minutes: params.durationMinutes,
    p_candidate_staff_ids: params.candidateStaffIds,
    p_client_id: params.clientId,
    p_client_phone: params.clientPhone,
    p_client_name: params.clientName,
    p_client_email: params.clientEmail,
    p_group_ref: params.groupRef ?? null,
    p_payment_deadline: params.paymentDeadline ?? null,
  });

  if (error) throw error;

  const rows = (data ?? []) as Booking[];
  return rows[0] ?? null;
}
