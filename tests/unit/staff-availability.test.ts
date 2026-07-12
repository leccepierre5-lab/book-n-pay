// Disponibilité par praticien (planning par praticien) — src/lib/staff-availability.ts.
// Couvre le fallback horaires business, une plage simple, puis le cœur du
// changement de la migration 0031 : plusieurs plages par jour pour un même
// praticien (horaires coupés), et surtout des pauses déjeuner DÉCALÉES entre
// praticiens d'un même salon — c'est le scénario métier réel qui justifie une
// dispo calculée par praticien plutôt qu'un horaire global d'établissement
// (pendant que l'un mange, un autre continue de travailler).
import { describe, it, expect } from 'vitest';
import { computeStaffAvailability, type StaffScheduleRow, type StaffAbsenceRow, type StaffAvailabilityParams } from '@/lib/staff-availability';
import { parseParisDatetime } from '@/lib/booking-utils';

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
    absences: [],
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

describe('computeStaffAvailability — congés/absences ponctuelles (staff_absences, migration 0032)', () => {
  // Praticien 'a' sans staff_schedules configuré → fallback horaires business
  // (09:00-18:00, voir describe précédent). Absence plage horaire précise :
  // 13h00 → 15h00 Paris sur DATE. Construite via parseParisDatetime (le même
  // helper que computeStaffAvailability utilise en interne) plutôt qu'un ISO
  // écrit à la main, pour ne pas dépendre d'un décalage UTC/Paris supposé
  // (CEST l'été, CET l'hiver).
  const absenceApresMidi: StaffAbsenceRow[] = [
    {
      staff_id: 'a',
      start_at: parseParisDatetime(DATE, '13:00').toISOString(),
      end_at: parseParisDatetime(DATE, '15:00').toISOString(),
    },
  ];

  it('créneau avant l\'absence → disponible', () => {
    const result = computeStaffAvailability(
      baseParams({ staff: [{ id: 'a', name: 'A' }], absences: absenceApresMidi, durationMinutes: 30 })
    );
    expect(result['12:00'].freeStaffIds).toEqual(['a']);
  });

  it('créneau pendant l\'absence → indisponible', () => {
    const result = computeStaffAvailability(
      baseParams({ staff: [{ id: 'a', name: 'A' }], absences: absenceApresMidi, durationMinutes: 30 })
    );
    expect(result['13:00'].freeStaffIds).toEqual([]);
  });

  it('créneau après l\'absence (démarre pile à la fin) → disponible', () => {
    const result = computeStaffAvailability(
      baseParams({ staff: [{ id: 'a', name: 'A' }], absences: absenceApresMidi, durationMinutes: 30 })
    );
    expect(result['15:00'].freeStaffIds).toEqual(['a']);
  });

  it('créneau à cheval sur le DÉBUT de l\'absence (démarre avant, déborde dedans) → indisponible', () => {
    // 60 min à partir de 12h30 → 12h30-13h30, chevauche le début (13h00) de l'absence.
    const result = computeStaffAvailability(
      baseParams({ staff: [{ id: 'a', name: 'A' }], absences: absenceApresMidi, durationMinutes: 60 })
    );
    expect(result['12:30'].freeStaffIds).toEqual([]);
  });

  it('créneau à cheval sur la FIN de l\'absence (démarre dedans, déborde après) → indisponible', () => {
    // 60 min à partir de 14h30 → 14h30-15h30, chevauche la fin (15h00) de l'absence.
    const result = computeStaffAvailability(
      baseParams({ staff: [{ id: 'a', name: 'A' }], absences: absenceApresMidi, durationMinutes: 60 })
    );
    expect(result['14:30'].freeStaffIds).toEqual([]);
  });

  it('absence "journée entière" (00:00 → 23:59 Paris) → tous les créneaux du jour indisponibles', () => {
    const absenceJourneeEntiere: StaffAbsenceRow[] = [
      {
        staff_id: 'a',
        start_at: parseParisDatetime(DATE, '00:00').toISOString(),
        end_at: parseParisDatetime(DATE, '23:59').toISOString(),
      },
    ];
    const result = computeStaffAvailability(
      baseParams({ staff: [{ id: 'a', name: 'A' }], absences: absenceJourneeEntiere, durationMinutes: 30 })
    );
    expect(result['09:00'].freeStaffIds).toEqual([]);
    expect(result['17:00'].freeStaffIds).toEqual([]);
  });

  it('absence multi-jours qui chevauche minuit (commence la veille, finit le lendemain) → jour intermédiaire entièrement indisponible', () => {
    // Valide la raison d'être de start_at/end_at en TIMESTAMPTZ plutôt qu'en
    // minutes locales : une période qui traverse minuit doit rester détectée.
    const veille = parseParisDatetime(DATE, '00:00');
    veille.setUTCDate(veille.getUTCDate() - 1);
    const lendemain = parseParisDatetime(DATE, '00:00');
    lendemain.setUTCDate(lendemain.getUTCDate() + 2);
    const absenceMultiJours: StaffAbsenceRow[] = [
      { staff_id: 'a', start_at: veille.toISOString(), end_at: lendemain.toISOString() },
    ];
    const result = computeStaffAvailability(
      baseParams({ staff: [{ id: 'a', name: 'A' }], absences: absenceMultiJours, durationMinutes: 30 })
    );
    expect(result['09:00'].freeStaffIds).toEqual([]);
  });

  it('un seul praticien absent parmi deux → l\'autre reste proposé (au moins 1 libre suffit)', () => {
    const staff = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
    const result = computeStaffAvailability(
      baseParams({ staff, absences: absenceApresMidi, durationMinutes: 30 })
    );
    expect(result['13:00'].freeStaffIds).toEqual(['b']);
    expect(result['13:00'].freeCount).toBe(1);
  });

  it('verrou anti-débordement de fuseau : "journée entière le 15 août" (Paris, été → UTC+2) ne déborde ni sur le 14 ni sur le 16', () => {
    // Reproduit exactement la saisie du pro dans EquipeManager.tsx : le
    // toggle "Journée entière" pré-remplit 00:00 → 23:59 en heure de Paris,
    // converti en UTC via parseParisDatetime avant stockage. En août (CEST,
    // UTC+2), ça donne 14/08 22:00 UTC → 15/08 21:59 UTC — si le code
    // comparait par erreur en UTC naïf (sans repasser par parseParisDatetime
    // côté créneau), ce test détecterait un débordement d'1h de part et
    // d'autre.
    const absence15Aout: StaffAbsenceRow[] = [
      {
        staff_id: 'a',
        start_at: parseParisDatetime('2026-08-15', '00:00').toISOString(),
        end_at: parseParisDatetime('2026-08-15', '23:59').toISOString(),
      },
    ];
    const staff = [{ id: 'a', name: 'A' }];
    const paramsFor = (date: string) =>
      baseParams({ date, staff, absences: absence15Aout, durationMinutes: 30 });

    const veille = computeStaffAvailability(paramsFor('2026-08-14'));
    const jourJ = computeStaffAvailability(paramsFor('2026-08-15'));
    const lendemain = computeStaffAvailability(paramsFor('2026-08-16'));

    expect(veille['10:00'].freeStaffIds).toEqual(['a']); // 14 août 10h Paris → disponible
    expect(jourJ['10:00'].freeStaffIds).toEqual([]); // 15 août 10h Paris → indisponible
    expect(lendemain['10:00'].freeStaffIds).toEqual(['a']); // 16 août 10h Paris → disponible
  });
});
