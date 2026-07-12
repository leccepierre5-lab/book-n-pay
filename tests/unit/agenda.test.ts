// Agrégation du planning par praticien (AgendaView.tsx, /api/pro/agenda) —
// voir src/lib/agenda.ts. Couvre les cas limites explicitement demandés :
// mono-praticien, journée sans RDV, praticien absent toute la journée, et le
// point découvert en diagnostiquant l'endpoint (04 réservations staff_id NULL
// en prod, toutes des cours allow_group=true) : "Non assigné" ne doit
// afficher QUE les vraies anomalies (service individuel sans praticien), pas
// les cours qui sont staff-less par design.
import { describe, it, expect } from 'vitest';
import { buildAgendaColumns, type AgendaBookingRow, type AgendaAbsenceRow, type AgendaStaffRow } from '@/lib/agenda';
import type { StaffScheduleRow } from '@/lib/staff-availability';

const DATE = '2026-08-17'; // lundi
const DAY_OF_WEEK = new Date(DATE + 'T12:00:00').getDay();

function booking(overrides: Partial<AgendaBookingRow> = {}): AgendaBookingRow {
  return {
    id: 'b1',
    staff_id: null,
    time: '10:00',
    duration_minutes: 30,
    service_name: 'Coupe',
    client_name: 'Client Test',
    allow_group: false,
    ...overrides,
  };
}

describe('buildAgendaColumns — cas de base', () => {
  it('établissement mono-praticien → une seule colonne', () => {
    const staff: AgendaStaffRow[] = [{ id: 'a', name: 'Julien', emoji: '✂️', role: 'Coiffeur' }];
    const columns = buildAgendaColumns({
      date: DATE,
      businessOpenTime: '09:00',
      businessCloseTime: '18:00',
      staff,
      schedules: [],
      absences: [],
      bookings: [],
    });
    expect(columns).toHaveLength(1);
    expect(columns[0].staffId).toBe('a');
    expect(columns[0].name).toBe('Julien');
  });

  it('journée sans aucun RDV → plages de travail présentes, bookings vide', () => {
    const staff: AgendaStaffRow[] = [{ id: 'a', name: 'Julien', emoji: null, role: null }];
    const columns = buildAgendaColumns({
      date: DATE,
      businessOpenTime: '09:00',
      businessCloseTime: '18:00',
      staff,
      schedules: [],
      absences: [],
      bookings: [],
    });
    expect(columns[0].workingRanges).toEqual([{ start_time: '09:00', end_time: '18:00' }]);
    expect(columns[0].bookings).toEqual([]);
  });

  it('praticien sans staff_schedules → fallback horaires business (mêmes plages)', () => {
    const staff: AgendaStaffRow[] = [{ id: 'a', name: 'Julien', emoji: null, role: null }];
    const columns = buildAgendaColumns({
      date: DATE,
      businessOpenTime: '09:00',
      businessCloseTime: '18:00',
      staff,
      schedules: [],
      absences: [],
      bookings: [],
    });
    expect(columns[0].workingRanges).toEqual([{ start_time: '09:00', end_time: '18:00' }]);
  });

  it('praticien avec des horaires coupés → les deux plages sont reprises telles quelles', () => {
    const staff: AgendaStaffRow[] = [{ id: 'a', name: 'Julien', emoji: null, role: null }];
    const schedules: StaffScheduleRow[] = [
      { staff_id: 'a', day_of_week: DAY_OF_WEEK, open_time: '09:00', close_time: '12:00' },
      { staff_id: 'a', day_of_week: DAY_OF_WEEK, open_time: '14:00', close_time: '18:00' },
    ];
    const columns = buildAgendaColumns({
      date: DATE,
      businessOpenTime: '09:00',
      businessCloseTime: '18:00',
      staff,
      schedules,
      absences: [],
      bookings: [],
    });
    expect(columns[0].workingRanges).toEqual([
      { start_time: '09:00', end_time: '12:00' },
      { start_time: '14:00', end_time: '18:00' },
    ]);
  });
});

describe('buildAgendaColumns — absences', () => {
  it('praticien absent toute la journée → workingRanges toujours présent, absences non vide', () => {
    // Le rendu (fond hachuré) se base sur `absences`, pas sur workingRanges —
    // volontaire : le praticien reste "en horaire" ce jour-là, simplement
    // couvert par une absence par-dessus (cohérent avec computeStaffAvailability
    // qui applique les deux exclusions indépendamment).
    const staff: AgendaStaffRow[] = [{ id: 'a', name: 'Julien', emoji: null, role: null }];
    const absences: AgendaAbsenceRow[] = [
      { staff_id: 'a', start_at: `${DATE}T00:00:00.000Z`, end_at: `${DATE}T23:59:00.000Z`, reason: 'Congé' },
    ];
    const columns = buildAgendaColumns({
      date: DATE,
      businessOpenTime: '09:00',
      businessCloseTime: '18:00',
      staff,
      schedules: [],
      absences,
      bookings: [],
    });
    expect(columns[0].workingRanges).toEqual([{ start_time: '09:00', end_time: '18:00' }]);
    expect(columns[0].absences).toEqual([{ start_at: `${DATE}T00:00:00.000Z`, end_at: `${DATE}T23:59:00.000Z`, reason: 'Congé' }]);
  });

  it('absence d\'un autre praticien n\'apparaît pas dans une colonne qui n\'est pas la sienne', () => {
    const staff: AgendaStaffRow[] = [
      { id: 'a', name: 'Julien', emoji: null, role: null },
      { id: 'b', name: 'Marie', emoji: null, role: null },
    ];
    const absences: AgendaAbsenceRow[] = [{ staff_id: 'a', start_at: `${DATE}T00:00:00.000Z`, end_at: `${DATE}T23:59:00.000Z`, reason: null }];
    const columns = buildAgendaColumns({
      date: DATE,
      businessOpenTime: '09:00',
      businessCloseTime: '18:00',
      staff,
      schedules: [],
      absences,
      bookings: [],
    });
    const colA = columns.find((c) => c.staffId === 'a')!;
    const colB = columns.find((c) => c.staffId === 'b')!;
    expect(colA.absences).toHaveLength(1);
    expect(colB.absences).toHaveLength(0);
  });
});

describe('buildAgendaColumns — RDV et colonne "Non assigné"', () => {
  it('RDV avec staff_id → rangeé dans la bonne colonne', () => {
    const staff: AgendaStaffRow[] = [
      { id: 'a', name: 'Julien', emoji: null, role: null },
      { id: 'b', name: 'Marie', emoji: null, role: null },
    ];
    const bookings: AgendaBookingRow[] = [booking({ id: 'b1', staff_id: 'a', time: '10:00' })];
    const columns = buildAgendaColumns({
      date: DATE,
      businessOpenTime: '09:00',
      businessCloseTime: '18:00',
      staff,
      schedules: [],
      absences: [],
      bookings,
    });
    const colA = columns.find((c) => c.staffId === 'a')!;
    const colB = columns.find((c) => c.staffId === 'b')!;
    expect(colA.bookings).toHaveLength(1);
    expect(colB.bookings).toHaveLength(0);
    expect(columns).toHaveLength(2); // pas de colonne "Non assigné"
  });

  it('RDV service individuel SANS staff_id → colonne "Non assigné" créée (vraie anomalie)', () => {
    const staff: AgendaStaffRow[] = [{ id: 'a', name: 'Julien', emoji: null, role: null }];
    const bookings: AgendaBookingRow[] = [booking({ id: 'b1', staff_id: null, allow_group: false })];
    const columns = buildAgendaColumns({
      date: DATE,
      businessOpenTime: '09:00',
      businessCloseTime: '18:00',
      staff,
      schedules: [],
      absences: [],
      bookings,
    });
    const nonAssigne = columns.find((c) => c.staffId === null);
    expect(nonAssigne).toBeDefined();
    expect(nonAssigne!.name).toBe('Non assigné');
    expect(nonAssigne!.bookings).toHaveLength(1);
  });

  it('cours (allow_group=true) sans staff_id → PAS dans "Non assigné", ni dans aucune colonne (hors scope planning par praticien)', () => {
    // Reproduit exactement l'état réel constaté en prod : 4 réservations
    // staff_id NULL, toutes des cours. Le filet "Non assigné" ne doit pas se
    // déclencher dessus, sinon il ne serait jamais vide en pratique alors
    // qu'aucune vraie anomalie n'existe.
    const staff: AgendaStaffRow[] = [{ id: 'a', name: 'Julien', emoji: null, role: null }];
    const bookings: AgendaBookingRow[] = [booking({ id: 'cours1', staff_id: null, allow_group: true, service_name: 'Yoga' })];
    const columns = buildAgendaColumns({
      date: DATE,
      businessOpenTime: '09:00',
      businessCloseTime: '18:00',
      staff,
      schedules: [],
      absences: [],
      bookings,
    });
    expect(columns.find((c) => c.staffId === null)).toBeUndefined();
    expect(columns).toHaveLength(1);
    expect(columns[0].bookings).toHaveLength(0);
  });

  it('plusieurs RDV pour un même praticien → triés par heure croissante', () => {
    const staff: AgendaStaffRow[] = [{ id: 'a', name: 'Julien', emoji: null, role: null }];
    const bookings: AgendaBookingRow[] = [
      booking({ id: 'b2', staff_id: 'a', time: '15:00' }),
      booking({ id: 'b1', staff_id: 'a', time: '09:30' }),
      booking({ id: 'b3', staff_id: 'a', time: '11:00' }),
    ];
    const columns = buildAgendaColumns({
      date: DATE,
      businessOpenTime: '09:00',
      businessCloseTime: '18:00',
      staff,
      schedules: [],
      absences: [],
      bookings,
    });
    expect(columns[0].bookings.map((b) => b.id)).toEqual(['b1', 'b3', 'b2']);
  });

  it('aucun staff actif, aucun RDV non assigné → tableau de colonnes vide', () => {
    const columns = buildAgendaColumns({
      date: DATE,
      businessOpenTime: '09:00',
      businessCloseTime: '18:00',
      staff: [],
      schedules: [],
      absences: [],
      bookings: [],
    });
    expect(columns).toEqual([]);
  });
});
