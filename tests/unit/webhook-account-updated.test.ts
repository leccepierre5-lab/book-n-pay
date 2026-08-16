// src/app/api/stripe/webhook/route.ts — event account.updated (Bloc C).
// Spec donnée par Pierre :
// - sans future_requirements → pas de crash, colonnes future_* vides/null.
// - timestamps Unix convertis en ISO.
// - stripe_account_id inconnu (pas de business_settings correspondante) →
//   pas d'erreur, juste ignoré.
import { describe, it, expect, vi, beforeEach } from 'vitest';
// Import statique plutôt que `await import(...)` par test (16/08) : voir
// webhook-dual-secret-signature.test.ts pour le raisonnement complet.
import { POST } from '@/app/api/stripe/webhook/route';

const mockConstructEventAsync = vi.fn(async () => eventFixture);
let eventFixture: any = null;

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

function buildRequest() {
  return new Request('http://localhost/api/stripe/webhook', {
    method: 'POST',
    headers: { 'stripe-signature': 'sig_test' },
    body: 'raw-body',
  });
}

function accountEvent(overrides: Record<string, any>) {
  return {
    type: 'account.updated',
    data: {
      object: {
        id: 'acct_test_1',
        charges_enabled: true,
        payouts_enabled: true,
        requirements: {
          disabled_reason: null,
          currently_due: [],
          past_due: [],
          current_deadline: null,
        },
        ...overrides,
      },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_SECRET_KEY = 'sk_test_123';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
  chains = {};
  chains.business_settings = makeChain([], { biz_id: 'biz-1' });
});

describe('stripe/webhook — account.updated', () => {
  it('sans future_requirements dans le payload : update appelé avec future_due=[] et future_deadline=null, pas de crash', async () => {
    eventFixture = accountEvent({
      requirements: {
        disabled_reason: 'requirements.past_due',
        currently_due: ['individual.verification.document'],
        past_due: ['individual.verification.document'],
        current_deadline: 1780000000,
      },
      payouts_enabled: false,
      // pas de future_requirements
    });

    const res = await POST(buildRequest() as any);

    expect(res.status).toBe(200);
    expect(chains.business_settings.update).toHaveBeenCalledWith(
      expect.objectContaining({
        stripe_future_due: [],
        stripe_future_deadline: null,
        stripe_payouts_enabled: false,
        stripe_disabled_reason: 'requirements.past_due',
      })
    );
  });

  it('timestamps Unix convertis en ISO (current_deadline et future_deadline)', async () => {
    eventFixture = accountEvent({
      requirements: {
        disabled_reason: null,
        currently_due: [],
        past_due: [],
        current_deadline: 1780000000,
      },
      future_requirements: {
        currently_due: ['individual.id_number'],
        current_deadline: 1793000000,
      },
    });

    await POST(buildRequest() as any);

    const updateCall = chains.business_settings.update.mock.calls[0][0];
    expect(updateCall.stripe_current_deadline).toBe(new Date(1780000000 * 1000).toISOString());
    expect(updateCall.stripe_future_deadline).toBe(new Date(1793000000 * 1000).toISOString());
    expect(updateCall.stripe_future_due).toEqual(['individual.id_number']);
  });

  it('stripe_account_id inconnu (aucune business_settings correspondante) → pas d\'erreur, aucun update tenté', async () => {
    chains.business_settings = makeChain([], null);
    eventFixture = accountEvent({ id: 'acct_orphan' });

    const res = await POST(buildRequest() as any);

    expect(res.status).toBe(200);
    expect(chains.business_settings.update).not.toHaveBeenCalled();
  });

  it('compte connu : lookup par stripe_account_id, update ciblé sur le bon biz_id', async () => {
    chains.business_settings = makeChain([], { biz_id: 'biz-42' });
    eventFixture = accountEvent({ id: 'acct_test_42' });

    await POST(buildRequest() as any);

    expect(chains.business_settings.eq).toHaveBeenCalledWith('stripe_account_id', 'acct_test_42');
    expect(chains.business_settings.eq).toHaveBeenCalledWith('biz_id', 'biz-42');
  });
});
