// src/lib/agenda.ts
// Agrégation pure des données du planning par praticien (AgendaView.tsx,
// /api/pro/agenda) — une colonne par praticien actif + une colonne "Non
// assigné" si nécessaire. Logique pure, sans accès réseau : les données sont
// déjà chargées par l'appelant (route API).
import { resolveWorkingRanges, type StaffScheduleRow, type WorkingRange } from './staff-availability';

export interface AgendaStaffRow {
  id: string;
  name: string;
  emoji: string | null;
  role: string | null;
}

export interface AgendaAbsenceRow {
  staff_id: string;
  start_at: string;
  end_at: string;
  reason: string | null;
}

// allow_group distingue un cours (service collectif) d'un service individuel
// — un cours n'a structurellement jamais de staff_id (voir
// availability/route.ts) et n'a donc pas sa place dans "Non assigné", qui ne
// doit repérer que de vraies anomalies (service individuel sans praticien).
export interface AgendaBookingRow {
  id: string;
  staff_id: string | null;
  time: string; // "HH:MM"
  duration_minutes: number;
  service_name: string;
  client_name: string | null;
  allow_group: boolean;
}

export interface AgendaBooking {
  id: string;
  time: string;
  duration_minutes: number;
  service_name: string;
  client_name: string | null;
}

export interface AgendaAbsence {
  start_at: string;
  end_at: string;
  reason: string | null;
}

export interface AgendaColumn {
  staffId: string | null; // null = colonne "Non assigné"
  name: string;
  emoji: string | null;
  role: string | null;
  workingRanges: WorkingRange[]; // [] pour "Non assigné"
  absences: AgendaAbsence[]; // [] pour "Non assigné"
  bookings: AgendaBooking[];
}

export interface BuildAgendaColumnsParams {
  date: string; // "YYYY-MM-DD"
  businessOpenTime: string | null;
  businessCloseTime: string | null;
  staff: AgendaStaffRow[]; // déjà filtré is_active = true par l'appelant
  schedules: StaffScheduleRow[];
  absences: AgendaAbsenceRow[];
  bookings: AgendaBookingRow[];
}

function stripBooking({ id, time, duration_minutes, service_name, client_name }: AgendaBookingRow): AgendaBooking {
  return { id, time, duration_minutes, service_name, client_name };
}

export function buildAgendaColumns(params: BuildAgendaColumnsParams): AgendaColumn[] {
  const { date, businessOpenTime, businessCloseTime, staff, schedules, absences, bookings } = params;
  const dayOfWeek = new Date(date + 'T12:00:00').getDay();

  const schedulesByStaff = new Map<string, StaffScheduleRow[]>();
  for (const s of schedules) {
    const list = schedulesByStaff.get(s.staff_id) ?? [];
    list.push(s);
    schedulesByStaff.set(s.staff_id, list);
  }

  const absencesByStaff = new Map<string, AgendaAbsence[]>();
  for (const a of absences) {
    const list = absencesByStaff.get(a.staff_id) ?? [];
    list.push({ start_at: a.start_at, end_at: a.end_at, reason: a.reason });
    absencesByStaff.set(a.staff_id, list);
  }

  const bookingsByStaff = new Map<string, AgendaBookingRow[]>();
  const unassigned: AgendaBookingRow[] = [];
  for (const b of bookings) {
    if (b.allow_group) continue; // cours/service collectif — hors scope du planning par praticien
    if (b.staff_id) {
      const list = bookingsByStaff.get(b.staff_id) ?? [];
      list.push(b);
      bookingsByStaff.set(b.staff_id, list);
    } else {
      unassigned.push(b); // vraie anomalie : service individuel sans praticien
    }
  }

  const columns: AgendaColumn[] = staff.map((st) => {
    const staffSchedules = schedulesByStaff.get(st.id) ?? [];
    const workingRanges =
      businessOpenTime && businessCloseTime
        ? resolveWorkingRanges(staffSchedules, dayOfWeek, businessOpenTime, businessCloseTime)
        : [];

    return {
      staffId: st.id,
      name: st.name,
      emoji: st.emoji,
      role: st.role,
      workingRanges,
      absences: absencesByStaff.get(st.id) ?? [],
      bookings: (bookingsByStaff.get(st.id) ?? []).map(stripBooking).sort((a, b) => a.time.localeCompare(b.time)),
    };
  });

  if (unassigned.length > 0) {
    columns.push({
      staffId: null,
      name: 'Non assigné',
      emoji: null,
      role: null,
      workingRanges: [],
      absences: [],
      bookings: unassigned.map(stripBooking).sort((a, b) => a.time.localeCompare(b.time)),
    });
  }

  return columns;
}
