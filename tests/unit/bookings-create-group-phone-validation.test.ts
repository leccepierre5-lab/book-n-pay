// src/app/api/bookings/create-group/route.ts — même couverture manquante
// que bookings/create (Lot 2, 16/08) : validation téléphone organisateur +
// invités (mode B) jamais prouvée au niveau route, plus les cas propres au
// groupe (nombre d'invités, doublon de téléphone entre participants).
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/feature-flags', () => ({ GROUP_BOOKING_ENABLED: true }));
vi.mock('@/lib/queries/catalog', () => ({ isNonRealBusiness: () => false }));
vi.mock('@/lib/demo-mode', () => ({
  isDemoTesterEmail: () => false,
  getBookingBlockedRole: vi.fn(async () => null),
  bookingBlockedMessage: () => '',
}));
vi.mock('@/lib/staff-assignment', () => ({ assignStaffAndCreateBooking: vi.fn() }));
vi.mock('@/lib/booking-solo-overlap', () => ({ createSoloBookingWithOverlapCheck: vi.fn() }));

let bookingCounter = 0;
const mockCreateCapacityBooking = vi.fn(async (..._args: any[]) => ({ id: `booking-${++bookingCounter}` }));
vi.mock('@/lib/booking-capacity', () => ({
  createBookingWithCapacityCheck: (...args: any[]) => mockCreateCapacityBooking(...args),
}));

const mockGetUser = vi.fn();
let memberCounter = 0;
const insertedMembers: any[] = [];

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: mockGetUser } })),
  createServiceRoleClient: vi.fn(() => ({
    from: (table: string) => {
      if (table === 'businesses') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { frozen: false, owner_id: 'pro-1', slug: 'biz-test' }, error: null }) }) }) };
      }
      if (table === 'services') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { allow_group: true, duration_minutes: 60 }, error: null }) }) }) };
      }
      if (table === 'app_users') {
        return {
          upsert: vi.fn(async () => ({ error: null })),
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { referred_by: null }, error: null }) }) }),
        };
      }
      if (table === 'booking_members') {
        return {
          insert: (row: any) => {
            insertedMembers.push(row);
            return { select: () => ({ single: async () => ({ data: { id: `member-${++memberCounter}` }, error: null }) }) };
          },
          update: () => ({ in: async () => ({ error: null }) }),
          delete: () => ({ in: async () => ({ error: null }) }),
        };
      }
      if (table === 'bookings') {
        return { update: () => ({ in: async () => ({ error: null }) }), delete: () => ({ in: async () => ({ error: null }) }) };
      }
      throw new Error(`table inattendue: ${table}`);
    },
  })),
}));

import { POST } from '@/app/api/bookings/create-group/route';

const FUTURE_DATE = '2099-01-15';

function buildRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/bookings/create-group', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

function baseBody(overrides: Record<string, unknown> = {}) {
  return {
    bizId: 'biz-1', bizName: 'Biz', serviceId: 'svc-1', serviceName: 'Svc',
    date: FUTURE_DATE, mode: 'b', clientName: 'Organisateur',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  bookingCounter = 0;
  memberCounter = 0;
  insertedMembers.length = 0;
  mockGetUser.mockResolvedValue({ data: { user: { id: 'client-1', email: 'client@test.fr' } } });
});

describe('POST /api/bookings/create-group — validation téléphone (mode B)', () => {
  it('téléphone organisateur invalide → 400, aucune réservation créée', async () => {
    const res = await POST(buildRequest(baseBody({
      slots: ['10:00', '10:30'],
      clientPhone: 'okokokok',
      guests: [{ name: 'Invité 1', phone: '0611111111' }],
    })) as any);
    expect(res.status).toBe(400);
    expect(mockCreateCapacityBooking).not.toHaveBeenCalled();
  });

  it("invité sans téléphone (mode B) → 400, message dédié invités", async () => {
    const res = await POST(buildRequest(baseBody({
      slots: ['10:00', '10:30'],
      clientPhone: '0612345678',
      guests: [{ name: 'Invité 1' }], // pas de phone du tout
    })) as any);
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toContain('invité');
    expect(mockCreateCapacityBooking).not.toHaveBeenCalled();
  });

  it('téléphone invité au format invalide → 400', async () => {
    const res = await POST(buildRequest(baseBody({
      slots: ['10:00', '10:30'],
      clientPhone: '0612345678',
      guests: [{ name: 'Invité 1', phone: 'pasunphone' }],
    })) as any);
    expect(res.status).toBe(400);
  });

  it("nombre d'invités incorrect pour le mode B (3 slots, 1 seul invité fourni) → 400 avant toute validation téléphone", async () => {
    const res = await POST(buildRequest(baseBody({
      slots: ['10:00', '10:30', '11:00'],
      clientPhone: '0612345678',
      guests: [{ name: 'Invité 1', phone: '0611111111' }],
    })) as any);
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toContain("invités");
  });

  it(
    "FAILLE CORRIGÉE le 16/08 (Lot 3) : deux participants (organisateur + invité) avec le MÊME téléphone → 400, aucune réservation créée",
    async () => {
      const res = await POST(buildRequest(baseBody({
        slots: ['10:00', '10:30'],
        clientPhone: '0612345678',
        guests: [{ name: 'Invité 1', phone: '0612345678' }], // même numéro que l'organisateur
      })) as any);
      const json = await res.json();
      expect(res.status).toBe(400);
      expect(json.error).toContain('même numéro');
      expect(mockCreateCapacityBooking).not.toHaveBeenCalled();
    }
  );

  it(
    'deux invités entre eux au même numéro (organisateur distinct) → 400 aussi, pas seulement organisateur vs invité',
    async () => {
      const res = await POST(buildRequest(baseBody({
        slots: ['10:00', '10:30', '11:00'],
        clientPhone: '0612345678',
        guests: [
          { name: 'Invité 1', phone: '0611111111' },
          { name: 'Invité 2', phone: '06 11 11 11 11' }, // même numéro que Invité 1, saisi différemment
        ],
      })) as any);
      const json = await res.json();
      expect(res.status).toBe(400);
      expect(json.error).toContain('même numéro');
      expect(mockCreateCapacityBooking).not.toHaveBeenCalled();
    }
  );

  it('groupe complet valide (organisateur + 2 invités, téléphones distincts) → 200, tous normalisés en +33', async () => {
    const res = await POST(buildRequest(baseBody({
      slots: ['10:00', '10:30', '11:00'],
      clientPhone: '0612345678',
      guests: [
        { name: 'Invité 1', phone: '06 11 11 11 11' },
        { name: 'Invité 2', phone: '06.22.22.22.22' },
      ],
    })) as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.allMemberIds).toHaveLength(3);
    expect(json.guestMemberIds).toHaveLength(2);
    const phones = insertedMembers.map((m) => m.phone);
    expect(phones).toEqual(['+33612345678', '+33611111111', '+33622222222']);
  });

  it('mode A (guestNames, pas de téléphone requis pour les invités) → 200 sans validation téléphone sur les invités', async () => {
    const res = await POST(buildRequest(baseBody({
      mode: 'a',
      slots: ['10:00', '10:30'],
      clientPhone: '0612345678',
      guestNames: ['Ami 1'],
    })) as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.allMemberIds).toHaveLength(2);
  });
});
