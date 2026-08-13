// src/app/api/stripe/checkout/route.ts — audit 26/07 : cette route (partagée
// solo + groupe) ne vérifiait jamais payment_deadline ni bookings.status
// avant de créer une session Stripe, contrairement à
// group/pay-for-member/route.ts qui, lui, le fait (410 si délai dépassé).
// Un invité pouvait donc obtenir une session de paiement Stripe valide pour
// un groupe déjà expiré/dissous en base — le seul filet réel dépendait de
// l'expiration effective (cron 1x/jour ou polling lazy), pas d'un blocage à
// la source. Ces tests prouvent le nouveau garde-fou : booking cancelled ou
// payment_deadline dépassé → 410, aucune session Stripe créée.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true })),
  getClientIp: vi.fn(() => '127.0.0.1'),
}));

const mockSessionsCreate = vi.fn(async () => ({ url: 'https://checkout.stripe.test/session', id: 'cs_test_1' }));
vi.mock('@/lib/stripe/client', () => ({
  getStripeClientWithMode: vi.fn(async () => ({
    stripe: { checkout: { sessions: { create: mockSessionsCreate } } },
    isTestMode: true,
  })),
}));

vi.mock('@/lib/queries/catalog', () => ({
  isNonRealBusiness: vi.fn(() => false),
}));

let bookingFixture: any = null;

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: null } })) },
  })),
  createServiceRoleClient: vi.fn(() => ({
    from: (table: string) => {
      if (table === 'bookings') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: bookingFixture }) }) }) };
      }
      if (table === 'app_config') {
        return { select: () => ({ like: async () => ({ data: [] }) }) };
      }
      // businesses, services, booking_members, business_settings, app_users —
      // non pertinents pour ces 3 tests (le garde-fou coupe avant ou les
      // champs bookingMeta correspondants ne sont pas fournis).
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) };
    },
  })),
}));

function buildRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/stripe/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
    body: JSON.stringify(body),
  });
}

const baseBody = {
  amount: 10,
  successUrl: 'http://localhost:3000/confirmation',
  cancelUrl: 'http://localhost:3000/annule',
  bookingMeta: { bookingId: 'bk1' },
  // Requis depuis le garde-fou rétractation (a01a366, 13/08) dès que
  // bookingMeta.bookingId est fourni — sinon 400 avant même d'atteindre le
  // garde-fou payment_deadline/status que ces tests visent réellement.
  retractionConsent: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockSessionsCreate.mockClear();
  bookingFixture = null;
});

describe('POST /api/stripe/checkout — garde-fou payment_deadline / status', () => {
  it("booking.status === 'cancelled' → 410, aucune session Stripe créée", async () => {
    bookingFixture = { service_id: null, biz_id: null, is_demo: false, status: 'cancelled', payment_deadline: null };

    const { POST } = await import('@/app/api/stripe/checkout/route');
    const res = await POST(buildRequest(baseBody) as any);

    expect(res.status).toBe(410);
    expect(mockSessionsCreate).not.toHaveBeenCalled();
  });

  it('payment_deadline dépassé → 410, aucune session Stripe créée', async () => {
    bookingFixture = {
      service_id: null,
      biz_id: null,
      is_demo: false,
      status: 'active',
      payment_deadline: new Date(Date.now() - 60_000).toISOString(),
    };

    const { POST } = await import('@/app/api/stripe/checkout/route');
    const res = await POST(buildRequest(baseBody) as any);

    expect(res.status).toBe(410);
    expect(mockSessionsCreate).not.toHaveBeenCalled();
  });

  it('payment_deadline encore dans le futur → la session Stripe est créée normalement', async () => {
    bookingFixture = {
      service_id: null,
      biz_id: null,
      is_demo: false,
      status: 'active',
      payment_deadline: new Date(Date.now() + 10 * 60_000).toISOString(),
    };

    const { POST } = await import('@/app/api/stripe/checkout/route');
    const res = await POST(buildRequest(baseBody) as any);

    expect(res.status).toBe(200);
    expect(mockSessionsCreate).toHaveBeenCalledTimes(1);
  });

  it('réservation solo (pas de bookingId dans bookingMeta) → garde-fou non applicable, comportement inchangé', async () => {
    const { POST } = await import('@/app/api/stripe/checkout/route');
    const res = await POST(buildRequest({ ...baseBody, bookingMeta: undefined }) as any);

    expect(res.status).toBe(200);
    expect(mockSessionsCreate).toHaveBeenCalledTimes(1);
  });
});
