// src/app/api/stripe/checkout/route.ts — audit tarification 27/07 : le barème
// des frais de gestion (CGU Art. 2 / page /tarifs) est indexé sur le PRIX de
// la prestation, pas sur le dépôt (`amount`) — un dépôt est presque toujours
// inférieur au prix, donc le palier facturé tombait systématiquement
// en-dessous de celui affiché au client par StepPayment.tsx (qui, lui, appelle
// déjà calcFraisGestion(service.price)). Corrigé en réutilisant le même
// helper côté serveur. Ce test prouve l'égalité au centime entre le total
// AFFICHÉ (calcFraisGestion(service.price), calculé ici exactement comme le
// fait StepPayment.tsx) et le total réellement DÉBITÉ (unit_amount des
// line_items envoyés à Stripe), sur les 3 modes de paiement qui appellent
// cette route (Solo, Mode A organisateur-paie-tout, Mode B organisateur/
// invité-paie-sa-part) et sur les prix autour de chaque seuil du barème.
// Sans ce test, 180/180 ne prouvait rien sur cette logique — aucun test
// existant n'exerçait le calcul du palier par le PRIX plutôt que le dépôt.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { calcFraisGestion } from '@/lib/booking-utils';

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
let businessSettingsFixture: any = null;

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: null } })) },
  })),
  createServiceRoleClient: vi.fn(() => ({
    from: (table: string) => {
      if (table === 'bookings') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: bookingFixture }) }) }) };
      }
      if (table === 'services') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: serviceFixture }) }) }) };
      }
      if (table === 'app_config') {
        // Pas d'override admin — les 4 valeurs par défaut de calcFraisGestion
        // (booking-utils.ts) sont ce qui doit se retrouver dans unit_amount.
        return { select: () => ({ like: async () => ({ data: [] }) }) };
      }
      if (table === 'business_settings') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: businessSettingsFixture }) }) }) };
      }
      // businesses, booking_members, app_users — non pertinents ici (aucun
      // biz_id posé sur bookingFixture, aucun memberId envoyé).
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
  businessSettingsFixture = null;
});

const DEPOSIT = 15;

// Reproduit exactement les 3 formes de body envoyées par le front
// (StepPayment.tsx / PayGuestClient.tsx) — seule la forme du body change
// selon le mode, la route est strictement la même pour les 3.
function requestBodyForMode(mode: 'solo' | 'modeA' | 'modeB', participants: number) {
  const common = {
    amount: DEPOSIT,
    successUrl: 'http://localhost:3000/confirmation',
    cancelUrl: 'http://localhost:3000/annule',
  };
  if (mode === 'solo') {
    // SoloPayment — quantity implicite (1), pas de groupRef.
    return { ...common, bookingMeta: { bookingId: 'bk1' } };
  }
  if (mode === 'modeA') {
    // ModeAPayment — amount = dépôt PAR PERSONNE, quantity = participants,
    // frais de gestion à quantity 1 (un seul, pas par personne).
    return { ...common, quantity: participants, bookingMeta: { bookingId: 'bk1', groupRef: 'GRP1' } };
  }
  // modeB — organisateur ou invité (PayGuestClient), quantity 1, groupRef posé.
  return { ...common, quantity: 1, bookingMeta: { bookingId: 'bk1', groupRef: 'GRP1' } };
}

const PRICE_POINTS = [50, 50.01, 80, 80.01, 100, 100.01];
const MODES: Array<{ mode: 'solo' | 'modeA' | 'modeB'; participants: number }> = [
  { mode: 'solo', participants: 1 },
  { mode: 'modeA', participants: 3 },
  { mode: 'modeB', participants: 1 },
];

describe('POST /api/stripe/checkout — frais de gestion sur le PRIX, égalité affiché == débité', () => {
  for (const { mode, participants } of MODES) {
    for (const price of PRICE_POINTS) {
      it(`mode=${mode} — prix ${price}€ → frais de gestion débité = calcFraisGestion(prix) affiché par StepPayment`, async () => {
        bookingFixture = { service_id: 'srv1', biz_id: null, is_demo: false, status: 'active', payment_deadline: null };
        serviceFixture = { deposit: DEPOSIT, price };

        const { POST } = await import('@/app/api/stripe/checkout/route');
        const res = await POST(buildRequest(requestBodyForMode(mode, participants)) as any);

        expect(res.status).toBe(200);
        expect(mockSessionsCreate).toHaveBeenCalledTimes(1);

        const sessionParams = mockSessionsCreate.mock.calls[0][0];
        const [depositLine, feeLine] = sessionParams.line_items;

        // Ce que StepPayment.tsx affiche AVANT paiement, calculé avec le même
        // helper que le front (booking-utils.ts) — pas une valeur en dur.
        const fraisGestionAffiche = calcFraisGestion(price);

        // Ce que Stripe débite réellement.
        const fraisGestionDebite = feeLine.price_data.unit_amount / 100;

        expect(fraisGestionDebite).toBe(fraisGestionAffiche);
        expect(feeLine.quantity).toBe(1); // jamais multiplié par le nombre de participants

        // Total débité (dépôt × quantité + frais de gestion unique) == total
        // affiché par StepPayment (totalDeposit/totalNow ou total selon le mode).
        const totalDebite = (depositLine.price_data.unit_amount * depositLine.quantity + feeLine.price_data.unit_amount) / 100;
        const totalAffiche = DEPOSIT * participants + fraisGestionAffiche;
        expect(totalDebite).toBeCloseTo(totalAffiche, 2);
      });
    }
  }
});

describe("POST /api/stripe/checkout — impact sur application_fee_amount (commission Book'nPay)", () => {
  it('un prix plus élevé (palier supérieur) augmente mécaniquement application_fee_amount — cohérent avec le barème /tarifs annoncé aux pros', async () => {
    bookingFixture = { service_id: 'srv1', biz_id: null, is_demo: false, status: 'active', payment_deadline: null };
    businessSettingsFixture = { stripe_account_id: 'acct_test_1', stripe_onboarding_complete: true };

    serviceFixture = { deposit: DEPOSIT, price: 40 }; // palier 1 → 1,99€
    const { POST: POST1 } = await import('@/app/api/stripe/checkout/route');
    await POST1(buildRequest({
      ...requestBodyForMode('solo', 1),
      bookingMeta: { bookingId: 'bk1', bizId: 'biz1' },
    }) as any);
    const lowTierFee = mockSessionsCreate.mock.calls[0][0].payment_intent_data.application_fee_amount;

    mockSessionsCreate.mockClear();
    serviceFixture = { deposit: DEPOSIT, price: 150 }; // palier 4 → 2,50€
    const { POST: POST2 } = await import('@/app/api/stripe/checkout/route');
    await POST2(buildRequest({
      ...requestBodyForMode('solo', 1),
      bookingMeta: { bookingId: 'bk1', bizId: 'biz1' },
    }) as any);
    const highTierFee = mockSessionsCreate.mock.calls[0][0].payment_intent_data.application_fee_amount;

    expect(lowTierFee).toBe(199); // 1,99€ en centimes
    expect(highTierFee).toBe(250); // 2,50€ en centimes
    expect(highTierFee).toBeGreaterThan(lowTierFee);
  });
});

// LOT 2 #1 (audit tarification 27/07) — pro/services bloque désormais la
// création/édition d'un service avec un dépôt sous 1€, mais un service créé
// AVANT ce correctif peut encore porter un dépôt à 0€ (ou moins d'1€) en
// base. Ce test prouve le message clair dédié (pas la générique "Montant
// invalide") pour ce cas résiduel.
describe('POST /api/stripe/checkout — service legacy avec dépôt < 1€ → message clair, pas la générique "Montant invalide"', () => {
  it('service.deposit = 0 → 422 avec message explicite, aucune session Stripe créée', async () => {
    bookingFixture = { service_id: 'srv1', biz_id: null, is_demo: false, status: 'active', payment_deadline: null };
    serviceFixture = { deposit: 0, price: 40 };

    const { POST } = await import('@/app/api/stripe/checkout/route');
    const res = await POST(buildRequest({
      amount: 0,
      successUrl: 'http://localhost:3000/confirmation',
      cancelUrl: 'http://localhost:3000/annule',
      bookingMeta: { bookingId: 'bk1' },
    }) as any);

    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.error).not.toBe('Montant invalide');
    expect(data.error).toMatch(/pas disponible à la réservation en ligne/);
    expect(mockSessionsCreate).not.toHaveBeenCalled();
  });

  it('service.deposit = 0.5 (sous 1€, mais > 0) → 422 même message clair', async () => {
    bookingFixture = { service_id: 'srv1', biz_id: null, is_demo: false, status: 'active', payment_deadline: null };
    serviceFixture = { deposit: 0.5, price: 40 };

    const { POST } = await import('@/app/api/stripe/checkout/route');
    const res = await POST(buildRequest({
      amount: 0.5,
      successUrl: 'http://localhost:3000/confirmation',
      cancelUrl: 'http://localhost:3000/annule',
      bookingMeta: { bookingId: 'bk1' },
    }) as any);

    expect(res.status).toBe(422);
    expect(mockSessionsCreate).not.toHaveBeenCalled();
  });

  it('service.deposit = 1 (plancher exact) → passe normalement (pas bloqué par le nouveau check)', async () => {
    bookingFixture = { service_id: 'srv1', biz_id: null, is_demo: false, status: 'active', payment_deadline: null };
    serviceFixture = { deposit: 1, price: 40 };

    const { POST } = await import('@/app/api/stripe/checkout/route');
    const res = await POST(buildRequest({
      amount: 1,
      successUrl: 'http://localhost:3000/confirmation',
      cancelUrl: 'http://localhost:3000/annule',
      bookingMeta: { bookingId: 'bk1' },
    }) as any);

    expect(res.status).toBe(200);
    expect(mockSessionsCreate).toHaveBeenCalledTimes(1);
  });

  it('amount=0 sans bookingId/service (filet générique) → toujours 400 "Montant invalide"', async () => {
    bookingFixture = null;
    serviceFixture = null;

    const { POST } = await import('@/app/api/stripe/checkout/route');
    const res = await POST(buildRequest({
      amount: 0,
      successUrl: 'http://localhost:3000/confirmation',
      cancelUrl: 'http://localhost:3000/annule',
    }) as any);

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Montant invalide');
    expect(mockSessionsCreate).not.toHaveBeenCalled();
  });
});
