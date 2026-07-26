// src/app/api/stripe/webhook/route.ts — audit LOT 3/4 (26/07), finding HIGH
// re-qualifié SOLO (pas seulement groupe) : le check d'idempotence sur
// checkout.session.completed n'excluait que 'paid'/'arrived', pas
// 'cancelled'. Garantie Stripe "at-least-once" → un rejeu du même webhook
// après qu'un client a annulé + été remboursé ressuscitait le membre en
// 'paid' sans qu'aucun attaquant n'ait rien fait (créneau ré-occupé, client
// remboursé mais compté présent, no-show à venir).
//
// Ces tests prouvent :
// 1. Rejeu pur (refund déjà existant côté Stripe pour ce payment_intent) →
//    ignoré, pas de résurrection, pas de second remboursement.
// 2. Paiement orphelin réel (booking annulé pendant que la session Checkout
//    restait ouverte côté client, qui a fini par payer — payment_intent
//    différent, aucun refund existant) → remboursé immédiatement.
// 3. Cas normal (membre pas encore payé) → comportement inchangé, membre
//    marqué 'paid', aucun remboursement déclenché.
import { describe, it, expect, vi, beforeEach } from 'vitest';

let eventFixture: any = null;
const mockConstructEventAsync = vi.fn(async () => eventFixture);
const mockRefundsList = vi.fn(async (): Promise<{ data: any[] }> => ({ data: [] }));
const mockRefundsCreate = vi.fn(async () => ({ id: 're_new' }));

vi.mock('stripe', () => ({
  default: function MockStripe(this: any) {
    this.webhooks = { constructEventAsync: mockConstructEventAsync };
    this.refunds = { list: mockRefundsList, create: mockRefundsCreate };
    this.paymentIntents = { retrieve: vi.fn() };
  },
}));

vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn(async () => ({ sent: true })) }));
vi.mock('@/lib/pro-notifications', () => ({ notifyProNewBooking: vi.fn(async () => {}) }));
vi.mock('@/lib/notify-admin', () => ({ notifyAdminOnFailure: vi.fn(async () => {}) }));
vi.mock('@/lib/stripe/overageCharge', () => ({
  maybeCreateOverageCharge: vi.fn(async () => {}),
  invoiceUnpaidOverageCharges: vi.fn(async () => {}),
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

function sessionEvent(overrides: Record<string, any>) {
  return {
    type: 'checkout.session.completed',
    data: {
      object: {
        metadata: { bookingId: 'bk1', memberId: 'mX' },
        amount_total: 2000,
        payment_intent: 'pi_default',
        customer_details: { email: null },
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
});

describe('stripe/webhook — idempotence membre cancelled', () => {
  it("rejeu du webhook sur un membre déjà 'cancelled' ET déjà remboursé côté Stripe → ignoré, pas de second remboursement, pas de résurrection", async () => {
    chains.booking_members = makeChain([], { id: 'm1', status: 'cancelled', name: 'Alice' });
    mockRefundsList.mockResolvedValueOnce({ data: [{ id: 're_existing' }] });
    eventFixture = sessionEvent({
      metadata: { bookingId: 'bk1', memberId: 'm1' },
      payment_intent: 'pi_123',
    });

    const { POST } = await import('@/app/api/stripe/webhook/route');
    const res = await POST(buildRequest() as any);

    expect(res.status).toBe(200);
    expect(mockRefundsList).toHaveBeenCalledWith({ payment_intent: 'pi_123', limit: 1 });
    expect(mockRefundsCreate).not.toHaveBeenCalled();
    expect(chains.booking_members.update).not.toHaveBeenCalled();
  });

  it("paiement orphelin capturé sur un membre déjà 'cancelled' (aucun remboursement existant) → remboursé immédiatement, membre pas ressuscité", async () => {
    chains.booking_members = makeChain([], { id: 'm2', status: 'cancelled', name: 'Bob' });
    mockRefundsList.mockResolvedValueOnce({ data: [] });
    eventFixture = sessionEvent({
      metadata: { bookingId: 'bk1', memberId: 'm2' },
      payment_intent: 'pi_456',
    });

    const { POST } = await import('@/app/api/stripe/webhook/route');
    const res = await POST(buildRequest() as any);

    expect(res.status).toBe(200);
    expect(mockRefundsCreate).toHaveBeenCalledTimes(1);
    expect(mockRefundsCreate).toHaveBeenCalledWith({ payment_intent: 'pi_456' });
    expect(chains.booking_members.update).not.toHaveBeenCalled();
  });

  it("membre pas encore payé ('invite') → comportement inchangé, marqué 'paid', aucun remboursement déclenché", async () => {
    chains.booking_members = makeChain(
      [{ id: 'm3', status: 'paid' }],
      { id: 'm3', status: 'invite', name: 'Carl', member_ref: null }
    );
    chains.bookings = makeChain([], null);
    eventFixture = sessionEvent({
      metadata: { bookingId: 'bk1', memberId: 'm3' },
      payment_intent: 'pi_789',
    });

    const { POST } = await import('@/app/api/stripe/webhook/route');
    const res = await POST(buildRequest() as any);

    expect(res.status).toBe(200);
    expect(mockRefundsList).not.toHaveBeenCalled();
    expect(mockRefundsCreate).not.toHaveBeenCalled();
    const paidCall = chains.booking_members.update.mock.calls.find((c: any[]) => c[0]?.status === 'paid');
    expect(paidCall).toBeTruthy();
  });
});
