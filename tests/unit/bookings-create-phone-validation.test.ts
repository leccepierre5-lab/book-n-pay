// src/app/api/bookings/create/route.ts — couverture manquante notée le
// 16/08 (Lot 2) : phonesMatch()/isValidPhoneFormat() sont testées en unité
// (booking-utils-phone-format.test.ts, booking-utils-phones-match.test.ts)
// mais aucun test ne prouvait que LA ROUTE appelle réellement cette
// validation — exactement le trou qui a permis à la faille phonesMatch()
// (deux téléphones invalides normalisés en '' qui matchaient entre eux,
// corrigée en 0056) de passer inaperçue. Import statique de la route (pas
// de `await import` par test — voir [[feedback_bnp_root_cause_over_timeout]]) :
// process.env n'est lu nulle part dans ce fichier au chargement du module.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true })),
  getClientIp: () => '127.0.0.1',
}));

vi.mock('@/lib/queries/catalog', () => ({
  isNonRealBusiness: () => false,
}));

vi.mock('@/lib/demo-mode', () => ({
  isDemoTesterEmail: () => false,
  getBookingBlockedRole: vi.fn(async () => null),
  bookingBlockedMessage: () => '',
}));

// Service allow_group=true → route vers createBookingWithCapacityCheck
// (branche la plus simple), staff-assignment/solo-overlap non sollicités.
const mockCreateCapacityBooking = vi.fn(async (..._args: any[]) => {
  const args = _args[1];
  return { id: 'booking-1', biz_id: args.bizId, service_id: args.serviceId, date: args.date, time: args.time };
});
vi.mock('@/lib/booking-capacity', () => ({
  createBookingWithCapacityCheck: (...args: any[]) => mockCreateCapacityBooking(...args),
}));
vi.mock('@/lib/booking-solo-overlap', () => ({
  createSoloBookingWithOverlapCheck: vi.fn(),
}));
vi.mock('@/lib/staff-assignment', () => ({
  computeStaffAvailabilityForDay: vi.fn(),
  assignStaffAndCreateBooking: vi.fn(),
}));

const mockGetUser = vi.fn();
let appUsersUpsertError: { message: string } | null = null;
const mockUpsert = vi.fn(async () => ({ error: appUsersUpsertError }));
let memberInsertResult: any;

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
    from: (table: string) => {
      if (table === 'businesses') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { frozen: false, owner_id: 'pro-1', slug: 'biz-test' }, error: null }),
            }),
          }),
        };
      }
      throw new Error(`table inattendue sur createClient: ${table}`);
    },
  })),
  createServiceRoleClient: vi.fn(() => ({
    from: (table: string) => {
      if (table === 'services') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { allow_group: true, duration_minutes: 60 }, error: null }),
            }),
          }),
        };
      }
      if (table === 'app_users') {
        return {
          upsert: mockUpsert,
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { referred_by: null }, error: null }),
            }),
          }),
        };
      }
      if (table === 'booking_members') {
        return { insert: () => ({ select: () => ({ single: async () => memberInsertResult }) }) };
      }
      throw new Error(`table inattendue sur createServiceRoleClient: ${table}`);
    },
  })),
}));

import { POST } from '@/app/api/bookings/create/route';

const FUTURE_DATE = '2099-01-15';

function buildRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/bookings/create', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

function baseBody(overrides: Record<string, unknown> = {}) {
  return {
    bizId: 'biz-1',
    bizName: 'Biz',
    serviceId: 'svc-1',
    serviceName: 'Svc',
    date: FUTURE_DATE,
    time: '10:00',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: 'client-1', email: 'client@test.fr' } } });
  appUsersUpsertError = null;
  memberInsertResult = { data: { id: 'member-1', booking_id: 'booking-1', status: 'invite' }, error: null };
});

describe('POST /api/bookings/create — validation téléphone', () => {
  it('téléphone invalide (aucun chiffre) → 400, aucune réservation créée', async () => {
    const res = await POST(buildRequest(baseBody({ clientPhone: 'okokokok' })) as any);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('invalide');
    expect(mockCreateCapacityBooking).not.toHaveBeenCalled();
  });

  it('téléphone étranger (indicatif non couvert) → 400', async () => {
    const res = await POST(buildRequest(baseBody({ clientPhone: '+14155552671' })) as any);
    expect(res.status).toBe(400);
    expect(mockCreateCapacityBooking).not.toHaveBeenCalled();
  });

  it('téléphone avec longueur incorrecte → 400', async () => {
    const res = await POST(buildRequest(baseBody({ clientPhone: '061234567' })) as any);
    expect(res.status).toBe(400);
  });

  it('téléphone avec séparateurs (points) — chiffres valides → accepté, normalisé en +33', async () => {
    const res = await POST(buildRequest(baseBody({ clientPhone: '06.12.34.56.78' })) as any);
    expect(res.status).toBe(200);
    expect(mockCreateCapacityBooking).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ clientPhone: '+33612345678' }));
  });

  it('téléphone absent → accepté (champ optionnel), réservation créée avec clientPhone=null', async () => {
    const res = await POST(buildRequest(baseBody()) as any);
    expect(res.status).toBe(200);
    expect(mockCreateCapacityBooking).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ clientPhone: null }));
  });

  it('téléphone valide métropolitain (saisie 0X) → accepté, stocké normalisé +33', async () => {
    const res = await POST(buildRequest(baseBody({ clientPhone: '0612345678' })) as any);
    expect(res.status).toBe(200);
    expect(mockCreateCapacityBooking).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ clientPhone: '+33612345678' }));
  });

  it('téléphone DOM-TOM valide (+590) → accepté', async () => {
    const res = await POST(buildRequest(baseBody({ clientPhone: '+590690123456' })) as any);
    expect(res.status).toBe(200);
    expect(mockCreateCapacityBooking).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ clientPhone: '+590690123456' }));
  });

  it(
    "doublon app_users.phone (collision UNIQUE à l'upsert) → NON bloquant, réservation créée quand même, échec rendu visible en log",
    async () => {
      appUsersUpsertError = { message: 'duplicate key value violates unique constraint "users_phone_key"' };
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const res = await POST(buildRequest(baseBody({ clientPhone: '0612345678' })) as any);

      expect(res.status).toBe(200);
      expect(mockCreateCapacityBooking).toHaveBeenCalled();
      expect(errSpy).toHaveBeenCalledWith(
        expect.stringContaining('Upsert app_users échoué'),
        expect.stringContaining('users_phone_key')
      );
      errSpy.mockRestore();
    }
  );
});
