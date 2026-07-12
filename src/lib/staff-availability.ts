// src/lib/staff-availability.ts
// Calcul de disponibilité par praticien pour les services individuels
// (allow_group === false) — un créneau est libre pour N personnes si au moins
// N praticiens actifs n'ont ni jour off, ni absence déclarée (staff_absences,
// migration 0032), ni chevauchement de réservation à ce créneau. Logique
// pure, sans accès réseau : les données sont déjà chargées par l'appelant
// (route API, ou routes de création côté serveur).
//
// Ne concerne pas les services collectifs (cours, allow_group === true), qui
// gardent le calcul d'occupation par tête existant (guestsAtSlot / counts
// dans availability/route.ts) — un praticien/une salle y sert plusieurs
// personnes en même temps, ce n'est pas le même mécanisme.
import { generateSlots, isSlotClosed, parseParisDatetime } from './booking-utils';

export interface StaffRow {
  id: string;
  name: string;
}

export interface StaffScheduleRow {
  staff_id: string;
  day_of_week: number; // 0=Dim..6=Sam (JS getDay())
  open_time: string;
  close_time: string;
}

// Réservation existante d'un praticien ce jour-là, avec la durée du SERVICE
// DE CETTE RÉSERVATION (pas celui qu'on est en train de calculer) — nécessaire
// pour détecter un chevauchement, pas juste une collision à l'heure exacte.
export interface StaffBookingRow {
  staff_id: string;
  time: string;
  duration_minutes: number;
}

// Congé/absence ponctuelle d'un praticien (staff_absences, migration 0032).
// start_at/end_at sont des instants absolus (TIMESTAMPTZ, chaînes ISO) — pas
// des minutes locales comme StaffScheduleRow/StaffBookingRow, car une absence
// peut chevaucher minuit ou s'étendre sur plusieurs jours. `reason` n'est pas
// repris ici : sans impact sur le calcul de disponibilité, seulement affiché
// dans la future vue planning (voir StaffAbsences côté API pour la valeur).
export interface StaffAbsenceRow {
  staff_id: string;
  start_at: string;
  end_at: string;
}

export interface StaffAvailabilityParams {
  date: string; // "YYYY-MM-DD"
  durationMinutes: number; // durée du service demandé
  businessOpenTime: string | null;
  businessCloseTime: string | null;
  businessOpenDays: number[];
  staff: StaffRow[]; // déjà filtré is_active = true par l'appelant
  schedules: StaffScheduleRow[]; // toutes les lignes staff_schedules des praticiens ci-dessus
  existingBookings: StaffBookingRow[]; // réservations actives (status != cancelled) du jour, staff_id non nul
  absences: StaffAbsenceRow[]; // congés/absences des praticiens ci-dessus chevauchant la journée demandée
}

export interface SlotAvailability {
  freeCount: number;
  freeStaffIds: string[];
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function overlaps(startA: number, endA: number, startB: number, endB: number): boolean {
  return startA < endB && startB < endA;
}

export interface WorkingRange {
  start_time: string;
  end_time: string;
}

// Résout les plages travaillées d'un praticien pour un jour donné — extrait
// de computeStaffAvailability pour être réutilisable telle quelle par
// l'endpoint agenda (AgendaView a besoin des plages elles-mêmes, pas
// seulement d'un booléen "couvert"). Toute divergence entre les deux appelants
// serait un bug silencieux (l'agenda afficherait des horaires différents de
// ceux réellement appliqués à la réservation) — une seule implémentation.
export function resolveWorkingRanges(
  staffSchedules: StaffScheduleRow[], // déjà filtré sur le staff_id concerné
  dayOfWeek: number,
  businessOpenTime: string,
  businessCloseTime: string
): WorkingRange[] {
  if (staffSchedules.length === 0) {
    // Aucun horaire configuré pour ce praticien → fallback horaires business (décision actée)
    return [{ start_time: businessOpenTime, end_time: businessCloseTime }];
  }
  // [] = a des horaires configurés, mais pas ce jour-là → jour off.
  // Plusieurs entrées possibles (horaires coupés, migration 0031).
  return staffSchedules
    .filter((s) => s.day_of_week === dayOfWeek)
    .map((s) => ({ start_time: s.open_time, end_time: s.close_time }));
}

export function computeStaffAvailability(
  params: StaffAvailabilityParams
): Record<string, SlotAvailability> {
  const {
    date,
    durationMinutes,
    businessOpenTime,
    businessCloseTime,
    businessOpenDays,
    staff,
    schedules,
    existingBookings,
    absences,
  } = params;

  const result: Record<string, SlotAvailability> = {};
  if (!businessOpenTime || !businessCloseTime) return result;

  const dayOfWeek = new Date(date + 'T12:00:00').getDay();
  const slots = generateSlots(businessOpenTime, businessCloseTime);

  const schedulesByStaff = new Map<string, StaffScheduleRow[]>();
  for (const s of schedules) {
    const list = schedulesByStaff.get(s.staff_id) ?? [];
    list.push(s);
    schedulesByStaff.set(s.staff_id, list);
  }

  const bookingsByStaff = new Map<string, StaffBookingRow[]>();
  for (const b of existingBookings) {
    const list = bookingsByStaff.get(b.staff_id) ?? [];
    list.push(b);
    bookingsByStaff.set(b.staff_id, list);
  }

  const absencesByStaff = new Map<string, StaffAbsenceRow[]>();
  for (const a of absences) {
    const list = absencesByStaff.get(a.staff_id) ?? [];
    list.push(a);
    absencesByStaff.set(a.staff_id, list);
  }

  const bizHoraires = { open_time: businessOpenTime, close_time: businessCloseTime, open_days: businessOpenDays };

  for (const slot of slots) {
    const freeStaffIds: string[] = [];

    if (!isSlotClosed(bizHoraires, date, slot)) {
      const slotStart = toMinutes(slot);
      const slotEnd = slotStart + durationMinutes;
      // Instants absolus du créneau (pas des minutes locales) pour comparer
      // avec start_at/end_at (TIMESTAMPTZ) — nécessaire pour une absence qui
      // chevauche minuit ou s'étend sur plusieurs jours, ce que des minutes
      // "depuis minuit sur `date`" seules ne peuvent pas représenter.
      const slotStartAt = parseParisDatetime(date, slot).getTime();
      const slotEndAt = slotStartAt + durationMinutes * 60_000;

      for (const st of staff) {
        const staffSchedules = schedulesByStaff.get(st.id) ?? [];
        const workingRanges = resolveWorkingRanges(staffSchedules, dayOfWeek, businessOpenTime, businessCloseTime);
        if (workingRanges.length === 0) continue; // jour off

        // Horaires coupés (ex. 9h-12h / 14h-18h) : le créneau doit tenir
        // entièrement dans AU MOINS UNE des plages du jour, pas à cheval sur
        // deux (ex. 11h30-12h30 sur une pause déjeuner 12h-14h n'est couvert
        // par aucune des deux plages prise isolément).
        const covered = workingRanges.some(
          (r) => slotStart >= toMinutes(r.start_time) && slotEnd <= toMinutes(r.end_time)
        );
        if (!covered) continue;

        const staffAbsences = absencesByStaff.get(st.id) ?? [];
        const isAbsent = staffAbsences.some((a) => {
          const abStart = new Date(a.start_at).getTime();
          const abEnd = new Date(a.end_at).getTime();
          return slotStartAt < abEnd && slotEndAt > abStart;
        });
        if (isAbsent) continue;

        const staffBookings = bookingsByStaff.get(st.id) ?? [];
        const isBusy = staffBookings.some((b) => {
          const bStart = toMinutes(b.time);
          const bEnd = bStart + b.duration_minutes;
          return overlaps(slotStart, slotEnd, bStart, bEnd);
        });

        if (!isBusy) freeStaffIds.push(st.id);
      }
    }

    result[slot] = { freeCount: freeStaffIds.length, freeStaffIds };
  }

  return result;
}
