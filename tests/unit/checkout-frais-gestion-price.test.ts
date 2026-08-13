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
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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
    // Requis depuis le garde-fou rétractation (a01a366, 13/08) dès que
    // bookingMeta.bookingId est fourni — sinon 400 avant même d'atteindre le
    // calcul de frais de gestion que ces tests visent réellement.
    retractionConsent: true,
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
      // Requis depuis le garde-fou rétractation (a01a366, 13/08).
      retractionConsent: true,
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
      // Requis depuis le garde-fou rétractation (a01a366, 13/08).
      retractionConsent: true,
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
      // Requis depuis le garde-fou rétractation (a01a366, 13/08).
      retractionConsent: true,
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

// Question posée en revue (28/07) : `calcFraisGestion(servicePrice ?? amount)`
// retombe sur `amount` (le dépôt) si `servicePrice` est null — exactement le
// bug corrigé plus haut. Deux garanties DISTINCTES à distinguer :
// 1. Que ce chemin est INATTEIGNABLE par un client réel — vit côté
//    APPELANTS (StepPayment.tsx/PayGuestClient.tsx), pas dans cette route ;
//    verrouillé par le test source-scan ci-dessous, pas celui-ci.
// 2. Que SI ce chemin se déclenche (parcours démo testeur whitelisté
//    uniquement, voir bookings/create/route.ts), le calcul reste
//    déterministe plutôt que silencieusement incohérent. C'EST la seule
//    garantie que ce test-ci verrouille.
describe('POST /api/stripe/checkout — fallback servicePrice→amount SI déclenché (comportement, pas atteignabilité)', () => {
  it('sans bookingMeta.bookingId (parcours démo) → fraisGestion calculé sur amount, pas sur un prix inconnu', async () => {
    bookingFixture = null;
    serviceFixture = null;

    const { POST } = await import('@/app/api/stripe/checkout/route');
    const res = await POST(buildRequest({
      amount: 15, // ici, faute de service à relire, `amount` tient lieu de "prix" pour le barème
      successUrl: 'http://localhost:3000/confirmation',
      cancelUrl: 'http://localhost:3000/annule',
      // Pas de bookingMeta du tout — reproduit le cas démo (bookingId: '' est
      // également falsy et produit le même comportement).
    }) as any);

    expect(res.status).toBe(200);
    const sessionParams = mockSessionsCreate.mock.calls[0][0];
    const feeLine = sessionParams.line_items[1];

    expect(feeLine.price_data.unit_amount / 100).toBe(calcFraisGestion(15));
  });
});

// Garantie #1 (celle qui compte, cf. commentaire ci-dessus) : que le fallback
// servicePrice→amount reste INATTEIGNABLE par un client réel. Cette garantie
// vit dans le code des 4 sites d'appel à /api/stripe/checkout (pas dans la
// route), donc un test de la route seule ne peut pas la prouver — audit
// source à la place : bookingId n'est vide QUE sous le ternaire `isDemo`
// explicite (SoloPayment + ModeAPayment, StepPayment.tsx:266/817), jamais de
// façon inconditionnelle, et jamais sur ModeBPayment/PayGuestClient (aucun
// des deux ne connaît de parcours démo — ModeB est d'ailleurs masqué
// entièrement sur une fiche non réelle, hideModeB={isNonRealBusiness(...)}).
// Échoue si un futur call site envoie bookingId vide hors de ce ternaire.
describe('StepPayment.tsx / PayGuestClient.tsx — garde de non-régression : bookingId jamais vide hors du parcours démo testeur explicite', () => {
  const stepPaymentSource = readFileSync(
    fileURLToPath(new URL('../../src/components/booking/StepPayment.tsx', import.meta.url)),
    'utf-8'
  );
  const payGuestSource = readFileSync(
    fileURLToPath(new URL('../../src/components/group/PayGuestClient.tsx', import.meta.url)),
    'utf-8'
  );

  it("StepPayment.tsx — aucune occurrence de bookingId vide EN DEHORS du ternaire isDemo connu (Solo + Mode A, 2 exactement)", () => {
    expect(stepPaymentSource).not.toMatch(/bookingId:\s*''\s*,/);
    const demoTernaryOccurrences = stepPaymentSource.match(/bookingId:\s*isDemo\s*\?\s*''\s*:/g) || [];
    expect(demoTernaryOccurrences.length).toBe(2);
  });

  it('StepPayment.tsx (Mode B organisateur) — bookingId toujours un vrai id, jamais conditionné à isDemo', () => {
    expect(stepPaymentSource).toMatch(/bookingId:\s*primaryBookingId,/);
  });

  it("PayGuestClient.tsx — bookingId toujours un vrai booking.id, aucun parcours démo sur ce flux (invité qui paie sa part)", () => {
    expect(payGuestSource).toMatch(/bookingId:\s*booking\.id,/);
    expect(payGuestSource).not.toMatch(/isDemo/);
  });
});
