// Disponibilité par praticien (planning par praticien) — src/lib/staff-availability.ts.
// Couvre le fallback horaires business, une plage simple, puis le cœur du
// changement de la migration 0031 : plusieurs plages par jour pour un même
// praticien (horaires coupés), et surtout des pauses déjeuner DÉCALÉES entre
// praticiens d'un même salon — c'est le scénario métier réel qui justifie une
// dispo calculée par praticien plutôt qu'un horaire global d'établissement
// (pendant que l'un mange, un autre continue de travailler).
import { describe, it, expect } from 'vitest';
import { computeStaffAvailability, type StaffScheduleRow, type StaffAvailabilityParams } from '@/lib/staff-availability';

const DATE = '2026-07-13';
const DAY_OF_WEEK = new Date(DATE + 'T12:00:00').getDay();
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]; // business ouvert tous les jours — évite toute dépendance au jour de semaine réel

function baseParams(overrides: Partial<StaffAvailabilityParams> = {}): StaffAvailabilityParams {
  return {
    date: DATE,
    durationMinutes: 60,
    businessOpenTime: '09:00',
    businessCloseTime: '18:00',
    businessOpenDays: ALL_DAYS,
    staff: [],
    schedules: [],
    existingBookings: [],
    ...overrides,
  };
}

describe('computeStaffAvailability — fallback et plage simple', () => {
  it('praticien sans aucun horaire configuré → fallback horaires business intégral', () => {
    const result = computeStaffAvailability(baseParams({ staff: [{ id: 'a', name: 'A' }] }));
    expect(result['09:00'].freeStaffIds).toEqual(['a']);
    expect(result['17:00'].freeStaffIds).toEqual(['a']); // 17:00 + 60min = 18:00, pile dans les horaires business
  });

  it('praticien avec une seule plage, créneau dans la plage → disponible', () => {
    const schedules: StaffScheduleRow[] = [{ staff_id: 'a', day_of_week: DAY_OF_WEEK, open_time: '10:00', close_time: '16:00' }];
    const result = computeStaffAvailability(baseParams({ staff: [{ id: 'a', name: 'A' }], schedules }));
    expect(result['10:00'].freeStaffIds).toEqual(['a']);
    expect(result['15:00'].freeStaffIds).toEqual(['a']); // 15:00 + 60min = 16:00, pile dans la plage
  });

  it('praticien avec une seule plage, créneau hors plage (mais dans les horaires business) → indisponible', () => {
    const schedules: StaffScheduleRow[] = [{ staff_id: 'a', day_of_week: DAY_OF_WEEK, open_time: '10:00', close_time: '16:00' }];
    const result = computeStaffAvailability(baseParams({ staff: [{ id: 'a', name: 'A' }], schedules }));
    expect(result['09:00'].freeStaffIds).toEqual([]);
    expect(result['16:00'].freeStaffIds).toEqual([]); // 16:00+60=17:00, déborde la plage (close 16:00)
  });

  it('praticien configuré mais sans ligne pour ce jour → jour off, indisponible même dans les horaires business', () => {
    const autreJour = (DAY_OF_WEEK + 1) % 7;
    const schedules: StaffScheduleRow[] = [{ staff_id: 'a', day_of_week: autreJour, open_time: '09:00', close_time: '18:00' }];
    const result = computeStaffAvailability(baseParams({ staff: [{ id: 'a', name: 'A' }], schedules }));
    expect(result['10:00'].freeStaffIds).toEqual([]);
  });
});

describe('computeStaffAvailability — horaires coupés (plusieurs plages/jour, migration 0031)', () => {
  const schedulesCoupes: StaffScheduleRow[] = [
    { staff_id: 'a', day_of_week: DAY_OF_WEEK, open_time: '09:00', close_time: '12:00' },
    { staff_id: 'a', day_of_week: DAY_OF_WEEK, open_time: '14:00', close_time: '18:00' },
  ];

  it('créneau dans la 1ère plage → disponible', () => {
    const result = computeStaffAvailability(baseParams({ staff: [{ id: 'a', name: 'A' }], schedules: schedulesCoupes, durationMinutes: 30 }));
    expect(result['10:00'].freeStaffIds).toEqual(['a']);
  });

  it('créneau dans la 2e plage → disponible', () => {
    const result = computeStaffAvailability(baseParams({ staff: [{ id: 'a', name: 'A' }], schedules: schedulesCoupes, durationMinutes: 30 }));
    expect(result['15:00'].freeStaffIds).toEqual(['a']);
  });

  it('créneau dans le trou entre les deux plages (pause déjeuner) → indisponible', () => {
    const result = computeStaffAvailability(baseParams({ staff: [{ id: 'a', name: 'A' }], schedules: schedulesCoupes, durationMinutes: 30 }));
    expect(result['12:30'].freeStaffIds).toEqual([]);
    expect(result['13:00'].freeStaffIds).toEqual([]);
  });

  it('créneau à cheval sur la pause (déborde la 1ère plage, ne tient dans aucune des deux isolément) → indisponible', () => {
    // Service de 60 min démarrant à 11h30 → finirait à 12h30 : déborde la 1ère
    // plage (close 12:00) et n'est contenu dans aucune des deux plages prise
    // isolément — pas de "somme" des plages, chacune doit couvrir le créneau entier.
    const result = computeStaffAvailability(baseParams({ staff: [{ id: 'a', name: 'A' }], schedules: schedulesCoupes, durationMinutes: 60 }));
    expect(result['11:30'].freeStaffIds).toEqual([]);
  });
});

describe('computeStaffAvailability — pauses décalées entre praticiens (scénario salon multi-praticiens)', () => {
  // Praticien A : 9h-12h puis 13h-18h (pause déjeuner 12h-13h)
  // Praticien B : 9h-14h puis 15h-18h (pause déjeuner 14h-15h)
  // C'est tout l'intérêt d'une dispo par praticien plutôt qu'un horaire
  // d'établissement global : pendant que A mange, B travaille encore, et
  // inversement.
  const staff = [{ id: 'A', name: 'A' }, { id: 'B', name: 'B' }];
  const schedules: StaffScheduleRow[] = [
    { staff_id: 'A', day_of_week: DAY_OF_WEEK, open_time: '09:00', close_time: '12:00' },
    { staff_id: 'A', day_of_week: DAY_OF_WEEK, open_time: '13:00', close_time: '18:00' },
    { staff_id: 'B', day_of_week: DAY_OF_WEEK, open_time: '09:00', close_time: '14:00' },
    { staff_id: 'B', day_of_week: DAY_OF_WEEK, open_time: '15:00', close_time: '18:00' },
  ];

  it('12h30 : A en pause, B travaille → créneau disponible (1 personne), seul B est libre', () => {
    const result = computeStaffAvailability(baseParams({ staff, schedules, durationMinutes: 30 }));
    expect(result['12:30'].freeStaffIds).toEqual(['B']);
    expect(result['12:30'].freeCount).toBe(1);
  });

  it('14h30 : B en pause, A travaille → créneau disponible (1 personne), seul A est libre', () => {
    const result = computeStaffAvailability(baseParams({ staff, schedules, durationMinutes: 30 }));
    expect(result['14:30'].freeStaffIds).toEqual(['A']);
    expect(result['14:30'].freeCount).toBe(1);
  });

  it('12h30 pour 2 personnes → un seul praticien libre, insuffisant (freeCount < 2)', () => {
    const result = computeStaffAvailability(baseParams({ staff, schedules, durationMinutes: 30 }));
    expect(result['12:30'].freeCount).toBeLessThan(2);
  });

  it('10h00, les deux travaillent → disponible pour 1 ET pour 2 personnes', () => {
    const result = computeStaffAvailability(baseParams({ staff, schedules, durationMinutes: 30 }));
    expect(result['10:00'].freeCount).toBe(2);
    expect([...result['10:00'].freeStaffIds].sort()).toEqual(['A', 'B']);
  });
});
