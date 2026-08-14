// src/app/api/stripe/webhook/route.ts — event customer.subscription.updated
// (Bloc D, 14/08). Avant ce chantier, cet event n'était pas écouté du tout :
// un changement de formule ou un passage en impayé fait depuis le Dashboard
// Stripe n'était jamais répercuté sur business_settings.
import { describe, it, expect, vi, beforeEach } from 'vitest';

let eventFixture: any = null;
const mockConstructEventAsync = vi.fn(async () => eventFixture);

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

function subscriptionEvent(overrides: Record<string, any>) {
  return {
    type: 'customer.subscription.updated',
    data: {
      object: {
        id: 'sub_test_1',
        status: 'active',
        items: { data: [{ price: { id: 'price_business_test' } }] },
        ...overrides,
      },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_SECRET_KEY = 'sk_test_123';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
  process.env.STRIPE_PRICE_STARTER = 'price_starter_test';
  process.env.STRIPE_PRICE_BUSINESS = 'price_business_test';
  process.env.STRIPE_PRICE_SCALE = 'price_scale_test';
  chains = {};
  chains.business_settings = makeChain([], { biz_id: 'biz-1', plan_key: 'business', subscription_status: 'active' });
});

describe('stripe/webhook — customer.subscription.updated', () => {
  it('upgrade de plan (business → scale) : business_settings mis à jour avec plan_key seul', async () => {
    eventFixture = subscriptionEvent({ items: { data: [{ price: { id: 'price_scale_test' } }] } });

    const { POST } = await import('@/app/api/stripe/webhook/route');
    const res = await POST(buildRequest() as any);

    expect(res.status).toBe(200);
    expect(chains.business_settings.update).toHaveBeenCalledWith({ plan_key: 'scale' });
    expect(chains.business_settings.eq).toHaveBeenCalledWith('biz_id', 'biz-1');
  });

  it('passage en impayé (status=past_due) : subscription_status synchronisé', async () => {
    eventFixture = subscriptionEvent({ status: 'past_due' });

    const { POST } = await import('@/app/api/stripe/webhook/route');
    await POST(buildRequest() as any);

    expect(chains.business_settings.update).toHaveBeenCalledWith({ subscription_status: 'past_due' });
  });

  it('rien de changé (même plan, même statut) : aucun update émis', async () => {
    eventFixture = subscriptionEvent({});

    const { POST } = await import('@/app/api/stripe/webhook/route');
    const res = await POST(buildRequest() as any);

    expect(res.status).toBe(200);
    expect(chains.business_settings.update).not.toHaveBeenCalled();
  });

  it('stripe_subscription_id inconnu (aucune business_settings correspondante) → pas d\'erreur, aucun update tenté', async () => {
    chains.business_settings = makeChain([], null);
    eventFixture = subscriptionEvent({ id: 'sub_orphan' });

    const { POST } = await import('@/app/api/stripe/webhook/route');
    const res = await POST(buildRequest() as any);

    expect(res.status).toBe(200);
    expect(chains.business_settings.update).not.toHaveBeenCalled();
  });

  it('lookup par stripe_subscription_id (pas par un autre champ)', async () => {
    eventFixture = subscriptionEvent({ id: 'sub_specific_42', status: 'past_due' });

    const { POST } = await import('@/app/api/stripe/webhook/route');
    await POST(buildRequest() as any);

    expect(chains.business_settings.eq).toHaveBeenCalledWith('stripe_subscription_id', 'sub_specific_42');
  });
});
