// src/app/api/bookings/group/route.ts — action addMemberAndGetCheckout.
// Couverture manquante notée le 16/08 (Lot 2), même motif que
// bookings-create-phone-validation.test.ts : la validation téléphone
// (isValidPhoneFormat) n'était vérifiée qu'en unité, jamais au niveau route.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/feature-flags', () => ({ GROUP_BOOKING_ENABLED: true }));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true })),
  getClientIp: () => '127.0.0.1',
}));

let bookingRow: any;
let insertResult: any;
const mockInsert = vi.fn(() => ({ select: () => ({ single: async () => insertResult }) }));

vi.mock('@/lib/supabase/server', () => ({
  createServiceRoleClient: vi.fn(() => ({
    from: (table: string) => {
      if (table === 'bookings') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: bookingRow, error: null }) }) }) };
      }
      if (table === 'booking_members') {
        return { insert: mockInsert };
      }
      throw new Error(`table inattendue: ${table}`);
    },
  })),
}));

import { POST } from '@/app/api/bookings/group/route';

function buildRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/bookings/group', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

function baseBooking(members: any[] = []) {
  return {
    id: 'booking-1',
    booking_members: members,
    services: { max_persons: 10 },
    businesses: { phone: null },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  bookingRow = baseBooking();
  insertResult = { data: { id: 'member-new' }, error: null };
});

describe('POST /api/bookings/group — addMemberAndGetCheckout — validation téléphone', () => {
  it('téléphone invalide (aucun chiffre) → 400, aucun membre inséré', async () => {
    const res = await POST(buildRequest({
      action: 'addMemberAndGetCheckout',
      bookingId: 'booking-1',
      memberData: { name: 'Alice', phone: 'okokokok' },
    }) as any);
    expect(res.status).toBe(400);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('téléphone vide (chaîne explicite) → 400', async () => {
    const res = await POST(buildRequest({
      action: 'addMemberAndGetCheckout',
      bookingId: 'booking-1',
      memberData: { name: 'Alice', phone: '' },
    }) as any);
    expect(res.status).toBe(400);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it(
    "FAILLE CORRIGÉE le 16/08 (Lot 3) : clé phone OMISE (pas envoyée, différent d'un envoi vide) → 400, plus de contournement possible",
    async () => {
      const res = await POST(buildRequest({
        action: 'addMemberAndGetCheckout',
        bookingId: 'booking-1',
        memberData: { name: 'Alice' }, // pas de clé "phone" du tout
      }) as any);
      // Avant le correctif, `memberData?.phone !== undefined` était FALSE
      // quand la clé était absente (contrairement à phone:'' où la clé
      // existe) — la garde ne s'appliquait pas. La garde porte maintenant
      // sur la présence de `memberData` seul, jamais sur la présence de la
      // clé qu'il contient.
      expect(res.status).toBe(400);
      expect(mockInsert).not.toHaveBeenCalled();
    }
  );

  it('téléphone valide avec séparateurs → accepté, normalisé, membre inséré', async () => {
    const res = await POST(buildRequest({
      action: 'addMemberAndGetCheckout',
      bookingId: 'booking-1',
      memberData: { name: 'Alice', phone: '06 12 34 56 78' },
    }) as any);
    expect(res.status).toBe(200);
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({ phone: '+33612345678' }));
  });

  it('deux membres avec le même téléphone (déjà dans le groupe, actif) → alreadyJoined, pas de doublon inséré', async () => {
    bookingRow = baseBooking([{ id: 'm1', name: 'Bob', phone: '+33612345678', status: 'paid' }]);
    const res = await POST(buildRequest({
      action: 'addMemberAndGetCheckout',
      bookingId: 'booking-1',
      memberData: { name: 'Bob', phone: '0612345678' },
    }) as any);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.alreadyJoined).toBe(true);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("même téléphone qu'un membre ANNULÉ ('cancelled') → pas bloqué, nouvel insert autorisé (le membre annulé ne compte plus)", async () => {
    bookingRow = baseBooking([{ id: 'm1', name: 'Bob', phone: '+33612345678', status: 'cancelled' }]);
    const res = await POST(buildRequest({
      action: 'addMemberAndGetCheckout',
      bookingId: 'booking-1',
      memberData: { name: 'Charlie', phone: '0612345678' },
    }) as any);
    expect(res.status).toBe(200);
    expect(mockInsert).toHaveBeenCalled();
  });

  it('nom déjà pris par un autre téléphone dans le groupe → 400, duplicateName', async () => {
    bookingRow = baseBooking([{ id: 'm1', name: 'Bob', phone: '+33611111111', status: 'invite' }]);
    const res = await POST(buildRequest({
      action: 'addMemberAndGetCheckout',
      bookingId: 'booking-1',
      memberData: { name: 'Bob', phone: '0612345678' },
    }) as any);
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.duplicateName).toBe(true);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('groupe déjà complet (max_persons atteint) → 400, capacityFull', async () => {
    bookingRow = baseBooking([{ id: 'm1', name: 'A', phone: '+33611111111', status: 'paid' }]);
    bookingRow.services.max_persons = 1;
    const res = await POST(buildRequest({
      action: 'addMemberAndGetCheckout',
      bookingId: 'booking-1',
      memberData: { name: 'Nouveau', phone: '0612345678' },
    }) as any);
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.capacityFull).toBe(true);
  });
});
