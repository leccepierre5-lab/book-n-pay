// src/app/api/stripe/webhook/route.ts — double secret de signature (14/08).
// Deux destinations Stripe pointent vers la même URL : le webhook plateforme
// historique (STRIPE_WEBHOOK_SECRET) et la nouvelle destination "Comptes
// connectés" pour account.updated (STRIPE_CONNECT_WEBHOOK_SECRET). Le
// handler doit essayer chaque secret connu jusqu'à ce qu'un HMAC valide.
//
// Spec donnée par Pierre :
// - secret A (plateforme) valide → traité normalement.
// - secret B (Connect) valide → traité normalement (pas seulement le premier
//   secret essayé qui doit pouvoir marcher).
// - aucun des deux ne valide → 400, console.error explicite ("signature
//   rejetée", pas seulement le message Stripe brut) — panne muette à éviter
//   absolument, c'est l'objet même du Bloc C.
// - STRIPE_CONNECT_WEBHOOK_SECRET absent → un seul secret tenté,
//   comportement identique à avant ce changement.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// Import statique plutôt que `await import(...)` par test (16/08) : la route
// lit process.env UNIQUEMENT à l'intérieur de POST(), jamais au chargement
// du module — un import dynamique par test n'apportait donc rien, sinon
// faire payer le coût de transform/résolution du module (789 lignes, 12
// imports transitifs) à l'intérieur du timeout de 5000ms d'un seul test, au
// lieu de la phase de collecte globale. Cause racine du flake "timeout au
// cold start" (voir [[project_bnp_dette_technique]]).
import { POST } from '@/app/api/stripe/webhook/route';

let eventFixture: any = null;
// Simule le vrai SDK : un secret donné ne valide QUE l'événement signé avec
// lui — pas un mock qui résout toujours, sinon le test ne prouve rien sur
// quel secret a réellement été utilisé.
const VALID_SECRETS = new Set(['whsec_platform', 'whsec_connect']);
const mockConstructEventAsync = vi.fn(async (_payload: string, _header: string, secret: string) => {
  if (!VALID_SECRETS.has(secret)) {
    throw new Error('No signatures found matching the expected signature for payload.');
  }
  return eventFixture;
});

vi.mock('stripe', () => ({
  default: function MockStripe(this: any) {
    this.webhooks = { constructEventAsync: mockConstructEventAsync };
    this.refunds = { list: vi.fn(), create: vi.fn() };
    this.paymentIntents = { retrieve: vi.fn() };
  },
}));

vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn(async () => ({ sent: true })) }));
vi.mock('@/lib/pro-notifications', () => ({ notifyProNewBooking: vi.fn(async () => {}) }));
vi.mock('@/lib/notify-admin', () => ({ notifyAdminOnFailure: vi.fn(async () => {}) }));
vi.mock('@/lib/stripe/pro-charge-billing', () => ({
  reconcileProChargesFromInvoice: vi.fn(async () => {}),
  invoicePendingChargesOnCancellation: vi.fn(async () => {}),
}));

function makeChain(listData: any[], singleData: any = listData[0] ?? null, error: any = null) {
  const chain: any = Promise.resolve({ data: listData, error });
  for (const m of ['select', 'eq', 'neq', 'gte', 'lte', 'in', 'order', 'limit', 'update', 'insert']) {
    chain[m] = vi.fn(() => chain);
  }
  chain.maybeSingle = vi.fn(async () => ({ data: singleData, error }));
  chain.single = vi.fn(async () => ({ data: singleData, error }));
  return chain;
}

let chains: Record<string, any> = {};
vi.mock('@/lib/supabase/server', () => ({
  createServiceRoleClient: vi.fn(() => ({ from: (t: string) => chains[t] })),
}));

function buildRequest(rawBody = '{"id":"evt_test_1","type":"account.updated"}') {
  return new Request('http://localhost/api/stripe/webhook', {
    method: 'POST',
    headers: { 'stripe-signature': 'sig_test' },
    body: rawBody,
  });
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_SECRET_KEY = 'sk_test_123';
  chains = {};
  chains.business_settings = makeChain([], null); // compte inconnu — hors du champ de ces tests
  eventFixture = { type: 'account.updated', data: { object: { id: 'acct_x', charges_enabled: true, payouts_enabled: true, requirements: {} } } };
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('stripe/webhook — double secret de signature', () => {
  it('secret plateforme (STRIPE_WEBHOOK_SECRET) valide → traité normalement', async () => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_platform';
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET = 'whsec_connect';

    const res = await POST(buildRequest() as any);

    expect(res.status).toBe(200);
    expect(mockConstructEventAsync).toHaveBeenCalledWith(expect.any(String), 'sig_test', 'whsec_platform');
  });

  it('secret Connect (STRIPE_CONNECT_WEBHOOK_SECRET) valide → traité normalement, même si essayé en second', async () => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_platform_WRONG'; // volontairement invalide
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET = 'whsec_connect';

    const res = await POST(buildRequest() as any);

    expect(res.status).toBe(200);
    // Les deux secrets ont été essayés — le premier a échoué, le second a validé.
    expect(mockConstructEventAsync).toHaveBeenCalledWith(expect.any(String), 'sig_test', 'whsec_platform_WRONG');
    expect(mockConstructEventAsync).toHaveBeenCalledWith(expect.any(String), 'sig_test', 'whsec_connect');
  });

  it("aucun des deux secrets ne valide → 400, console.error explicite (signature rejetée, pas seulement le message Stripe brut)", async () => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_platform_WRONG';
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET = 'whsec_connect_WRONG';
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await POST(buildRequest() as any);

    expect(res.status).toBe(400);
    expect(mockConstructEventAsync).toHaveBeenCalledTimes(2);
    const loggedMessage = errSpy.mock.calls.map((c) => String(c[0])).find((m) => m.includes('SIGNATURE STRIPE REJETÉE'));
    expect(loggedMessage).toBeTruthy();
    expect(loggedMessage).toContain('2 secret'); // nombre de secrets essayés, pas juste "erreur"
    errSpy.mockRestore();
  });

  it('STRIPE_CONNECT_WEBHOOK_SECRET absent : un seul secret tenté, comportement identique à avant ce changement', async () => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_platform';
    delete process.env.STRIPE_CONNECT_WEBHOOK_SECRET;

    const res = await POST(buildRequest() as any);

    expect(res.status).toBe(200);
    expect(mockConstructEventAsync).toHaveBeenCalledTimes(1);
    expect(mockConstructEventAsync).toHaveBeenCalledWith(expect.any(String), 'sig_test', 'whsec_platform');
  });

  it('signature rejetée : le message loggé mentionne le type/id du payload NON VÉRIFIÉ, pour corrélation dans les logs Vercel sans jamais s\'en servir pour traiter l\'événement', async () => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_platform_WRONG';
    delete process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await POST(buildRequest('{"id":"evt_abc","type":"account.updated"}') as any);

    const loggedMessage = errSpy.mock.calls.map((c) => String(c[0])).find((m) => m.includes('SIGNATURE STRIPE REJETÉE'));
    expect(loggedMessage).toContain('evt_abc');
    expect(loggedMessage).toContain('account.updated');
    expect(loggedMessage).toContain('NON VÉRIFIÉ');
    errSpy.mockRestore();
  });
});
