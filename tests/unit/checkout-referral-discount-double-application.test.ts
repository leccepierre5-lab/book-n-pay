// src/app/api/stripe/checkout/route.ts — régression réelle trouvée en audit
// le 22/08/2026 : le montant du dépôt (`amount`) reçu du client est DÉJÀ
// réduit du pourcentage de parrainage — StepPayment.tsx calcule
// `effectiveDeposit = service.deposit * (1 - discountPct/100)` et envoie CE
// montant (StepPayment.tsx:271/571/814). Le serveur revalide correctement ce
// montant contre `expectedDeposit = service.deposit * (1 - referralDiscountPct/100)`
// (checkout/route.ts:198-200) — mais réapplique ENSUITE le même ratio une
// seconde fois sur ce montant déjà réduit (route.ts:239-240,
// `effectiveDeposit = amount * ratio`), avant de l'utiliser comme
// `unit_amount` réellement facturé (ligne 364). Un client avec le stock
// parrain (-20%) sur un dépôt de 10€ est donc réellement facturé 6,40€ (une
// réduction de 36%) au lieu des 8€ annoncés (-20%) — perte silencieuse à
// chaque réservation avec parrainage actif, sans alerte ni test existant.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true })),
  getClientIp: vi.fn(() => '127.0.0.1'),
}));

const mockSessionsCreate = vi.fn(async (_params: any) => ({ url: 'https://checkout.stripe.test/session', id: 'cs_test_1' }));
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
let serviceFixture: any = null;
let appUserFixture: any = null;

vi.mock('@/lib/supabase/server', () => ({
  // Client authentifié — indispensable ici : `referralDiscountPct` n'est lu
  // que si `clientUserId` est non vide (route.ts:100), un appel invité
  // (createClient renvoyant user:null, comme dans les autres fichiers de
  // test de cette route) ne peut jamais déclencher ce bug.
  createClient: vi.fn(async () => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'client1' } } })) },
  })),
  createServiceRoleClient: vi.fn(() => ({
    from: (table: string) => {
      if (table === 'bookings') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: bookingFixture }) }) }) };
      }
      if (table === 'services') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: serviceFixture }) }) }) };
      }
      if (table === 'app_users') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: appUserFixture }) }) }) };
      }
      if (table === 'app_config') {
        return { select: () => ({ like: async () => ({ data: [] }) }) };
      }
      // businesses, business_settings, booking_members — non pertinents ici
      // (aucun biz_id posé sur bookingFixture, aucun memberId envoyé).
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

beforeEach(() => {
  vi.clearAllMocks();
  mockSessionsCreate.mockClear();
  bookingFixture = null;
  serviceFixture = null;
  appUserFixture = null;
});

describe("POST /api/stripe/checkout — la réduction de parrainage ne doit s'appliquer qu'UNE fois", () => {
  it('stock parrain -20% : dépôt 10€ → facturé 8€, jamais 6,40€ (double application)', async () => {
    bookingFixture = { service_id: 'srv1', biz_id: null, is_demo: false, status: 'active', payment_deadline: null };
    serviceFixture = { deposit: 10, price: 40 };
    // Stock parrain disponible → referralDiscountPct = 20 (route.ts:107-109).
    appUserFixture = { referral_discounts_available: 1, pending_referral_discount_pct: 0, free_management_fees_available: 0 };

    const { POST } = await import('@/app/api/stripe/checkout/route');
    const res = await POST(buildRequest({
      // Exactement ce qu'envoie StepPayment.tsx:283/577/850 — le dépôt DÉJÀ
      // réduit de 20% (10 × 0.8 = 8), jamais le dépôt brut.
      amount: 8,
      successUrl: 'http://localhost:3000/confirmation',
      cancelUrl: 'http://localhost:3000/annule',
      bookingMeta: { bookingId: 'bk1' },
      retractionConsent: true,
    }) as any);

    expect(res.status).toBe(200);
    expect(mockSessionsCreate).toHaveBeenCalledTimes(1);

    const sessionParams = mockSessionsCreate.mock.calls[0][0];
    const [depositLine] = sessionParams.line_items;
    const depositFacture = depositLine.price_data.unit_amount / 100;

    // Le bug produirait 6.4 (8 × 0.8, ratio réappliqué une 2e fois).
    expect(depositFacture).toBe(8);
  });

  it('filleul -10% (pending_referral_discount_pct) : dépôt 20€ → facturé 18€, jamais 16,20€', async () => {
    bookingFixture = { service_id: 'srv1', biz_id: null, is_demo: false, status: 'active', payment_deadline: null };
    serviceFixture = { deposit: 20, price: 60 };
    appUserFixture = { referral_discounts_available: 0, pending_referral_discount_pct: 10, free_management_fees_available: 0 };

    const { POST } = await import('@/app/api/stripe/checkout/route');
    const res = await POST(buildRequest({
      amount: 18,
      successUrl: 'http://localhost:3000/confirmation',
      cancelUrl: 'http://localhost:3000/annule',
      bookingMeta: { bookingId: 'bk1' },
      retractionConsent: true,
    }) as any);

    expect(res.status).toBe(200);
    const sessionParams = mockSessionsCreate.mock.calls[0][0];
    const [depositLine] = sessionParams.line_items;
    expect(depositLine.price_data.unit_amount / 100).toBe(18);
  });

  it('aucune réduction disponible : dépôt facturé au montant reçu, sans altération', async () => {
    bookingFixture = { service_id: 'srv1', biz_id: null, is_demo: false, status: 'active', payment_deadline: null };
    serviceFixture = { deposit: 15, price: 40 };
    appUserFixture = { referral_discounts_available: 0, pending_referral_discount_pct: 0, free_management_fees_available: 0 };

    const { POST } = await import('@/app/api/stripe/checkout/route');
    const res = await POST(buildRequest({
      amount: 15,
      successUrl: 'http://localhost:3000/confirmation',
      cancelUrl: 'http://localhost:3000/annule',
      bookingMeta: { bookingId: 'bk1' },
      retractionConsent: true,
    }) as any);

    expect(res.status).toBe(200);
    const sessionParams = mockSessionsCreate.mock.calls[0][0];
    const [depositLine] = sessionParams.line_items;
    expect(depositLine.price_data.unit_amount / 100).toBe(15);
  });
});
