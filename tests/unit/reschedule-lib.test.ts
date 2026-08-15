// src/lib/reschedule.ts — logique pure du report de RDV (migration 0055).
// Couvre :
// 1. computeRescheduleExpiresAt : 48h par défaut, plafonné à la moitié du
//    temps restant, null si marge < 2h (règle actée 15/08).
// 2. generateRescheduleToken : jamais deux fois le même, haute entropie.
// 3. findNextAvailableSlot : boucle jour par jour, plafonnée à 14 jours,
//    préfère le praticien demandé, retombe sur solo si pas de staff.
// 4. isProposedSlotStillFree : même branchement staff/solo que
//    availability/route.ts, utilisé à l'acceptation.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockComputeStaffAvailabilityForDay = vi.fn();
const mockComputeSoloAvailabilityForDay = vi.fn();
vi.mock('@/lib/staff-assignment', () => ({
  computeStaffAvailabilityForDay: (...args: any[]) => mockComputeStaffAvailabilityForDay(...args),
  computeSoloAvailabilityForDay: (...args: any[]) => mockComputeSoloAvailabilityForDay(...args),
}));

import {
  computeRescheduleExpiresAt,
  generateRescheduleToken,
  findNextAvailableSlot,
  isProposedSlotStillFree,
  RESCHEDULE_SEARCH_HORIZON_DAYS,
} from '@/lib/reschedule';

describe('computeRescheduleExpiresAt', () => {
  const now = new Date('2026-08-15T10:00:00Z');

  it('RDV dans longtemps (>96h) : plafonné à 48h, jamais plus', () => {
    const rdv = new Date(now.getTime() + 200 * 60 * 60 * 1000); // 200h
    const expires = computeRescheduleExpiresAt(rdv, now);
    expect(expires).not.toBeNull();
    expect(expires!.getTime() - now.getTime()).toBe(48 * 60 * 60 * 1000);
  });

  it('RDV dans 20h : fenêtre = moitié du temps restant (10h), pas 48h', () => {
    const rdv = new Date(now.getTime() + 20 * 60 * 60 * 1000);
    const expires = computeRescheduleExpiresAt(rdv, now);
    expect(expires!.getTime() - now.getTime()).toBe(10 * 60 * 60 * 1000);
  });

  it('marge exactement à 2h : encore autorisé (limite incluse)', () => {
    const rdv = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    const expires = computeRescheduleExpiresAt(rdv, now);
    expect(expires).not.toBeNull();
    expect(expires!.getTime() - now.getTime()).toBe(1 * 60 * 60 * 1000);
  });

  it('marge < 2h : null — le report ne doit pas être proposé (annulation directe)', () => {
    const rdv = new Date(now.getTime() + 1.5 * 60 * 60 * 1000);
    expect(computeRescheduleExpiresAt(rdv, now)).toBeNull();
  });

  it('RDV déjà passé : null', () => {
    const rdv = new Date(now.getTime() - 60 * 60 * 1000);
    expect(computeRescheduleExpiresAt(rdv, now)).toBeNull();
  });
});

describe('generateRescheduleToken', () => {
  it('jamais deux fois le même token, jamais vide', () => {
    const a = generateRescheduleToken();
    const b = generateRescheduleToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(30);
  });
});

describe('findNextAvailableSlot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('trouve le premier créneau libre du lendemain, préfère le praticien demandé', async () => {
    mockComputeStaffAvailabilityForDay.mockResolvedValueOnce({
      staffRows: [{ id: 'staff-1', name: 'Alice' }],
      availability: {
        '09:00': { freeCount: 0, freeStaffIds: [] },
        '10:00': { freeCount: 1, freeStaffIds: ['staff-2'] },
        '11:00': { freeCount: 1, freeStaffIds: ['staff-1'] },
      },
    });

    const slot = await findNextAvailableSlot({} as any, 'biz-1', '2026-08-15', 60, 'staff-1');

    expect(slot).toEqual({ date: '2026-08-16', time: '11:00', staffId: 'staff-1' });
    // Cherche à partir du lendemain de fromDate, pas fromDate lui-même.
    expect(mockComputeStaffAvailabilityForDay).toHaveBeenCalledWith(expect.anything(), 'biz-1', '2026-08-16', 60);
  });

  it('praticien préféré indisponible ce jour-là : retombe sur le premier créneau libre tout praticien confondu', async () => {
    mockComputeStaffAvailabilityForDay.mockResolvedValueOnce({
      staffRows: [{ id: 'staff-2', name: 'Bob' }],
      availability: { '10:00': { freeCount: 1, freeStaffIds: ['staff-2'] } },
    });

    const slot = await findNextAvailableSlot({} as any, 'biz-1', '2026-08-15', 60, 'staff-1');
    expect(slot).toEqual({ date: '2026-08-16', time: '10:00', staffId: 'staff-2' });
  });

  it('business sans staff actif : retombe sur computeSoloAvailabilityForDay', async () => {
    mockComputeStaffAvailabilityForDay.mockResolvedValue(null);
    mockComputeSoloAvailabilityForDay.mockResolvedValueOnce({
      '09:00': { freeCount: 0, freeStaffIds: [] },
      '14:00': { freeCount: 1, freeStaffIds: ['__solo__'] },
    });

    const slot = await findNextAvailableSlot({} as any, 'biz-1', '2026-08-15', 60);
    expect(slot).toEqual({ date: '2026-08-16', time: '14:00', staffId: null });
  });

  it('rien de libre sur 14 jours : null, pas de proposition automatique au-delà', async () => {
    mockComputeStaffAvailabilityForDay.mockResolvedValue(null);
    mockComputeSoloAvailabilityForDay.mockResolvedValue({});

    const slot = await findNextAvailableSlot({} as any, 'biz-1', '2026-08-15', 60);

    expect(slot).toBeNull();
    expect(mockComputeSoloAvailabilityForDay).toHaveBeenCalledTimes(RESCHEDULE_SEARCH_HORIZON_DAYS);
  });
});

describe('isProposedSlotStillFree', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('business avec staff : libre seulement si LE staff proposé est dans freeStaffIds', async () => {
    mockComputeStaffAvailabilityForDay.mockResolvedValueOnce({
      staffRows: [],
      availability: { '10:00': { freeCount: 1, freeStaffIds: ['staff-2'] } },
    });

    const free = await isProposedSlotStillFree({} as any, 'biz-1', '2026-08-16', '10:00:00', 60, 'staff-1');
    expect(free).toBe(false);
  });

  it('business avec staff : libre si le staff proposé est bien dans freeStaffIds (tronque HH:MM:SS)', async () => {
    mockComputeStaffAvailabilityForDay.mockResolvedValueOnce({
      staffRows: [],
      availability: { '10:00': { freeCount: 1, freeStaffIds: ['staff-1'] } },
    });

    const free = await isProposedSlotStillFree({} as any, 'biz-1', '2026-08-16', '10:00:00', 60, 'staff-1');
    expect(free).toBe(true);
  });

  it('business solo (staff_id null sur la proposition) : libre si freeCount > 0', async () => {
    mockComputeStaffAvailabilityForDay.mockResolvedValueOnce(null);
    mockComputeSoloAvailabilityForDay.mockResolvedValueOnce({
      '10:00': { freeCount: 1, freeStaffIds: ['__solo__'] },
    });

    const free = await isProposedSlotStillFree({} as any, 'biz-1', '2026-08-16', '10:00:00', 60, null);
    expect(free).toBe(true);
  });

  it('créneau déjà pris entre-temps : false', async () => {
    mockComputeStaffAvailabilityForDay.mockResolvedValueOnce(null);
    mockComputeSoloAvailabilityForDay.mockResolvedValueOnce({
      '10:00': { freeCount: 0, freeStaffIds: [] },
    });

    const free = await isProposedSlotStillFree({} as any, 'biz-1', '2026-08-16', '10:00:00', 60, null);
    expect(free).toBe(false);
  });
});
