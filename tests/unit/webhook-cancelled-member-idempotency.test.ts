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
// Import statique plutôt que `await import(...)` par test (16/08) : voir
// webhook-dual-secret-signature.test.ts pour le raisonnement complet.
import { POST } from '@/app/api/stripe/webhook/route';

let eventFixture: any = null;
const mockConstructEventAsync = vi.fn(async () => eventFixture);
const mockRefundsList = vi.fn(async (): Promise<{ data: any[] }> => ({ data: [] }));
const mockRefundsCreate = vi.fn(async () => ({ id: 're_new' }));
// Défaut : un transfert existe (cas réel destination charge) — voir le
// correctif 22/08 (reverse_transfer sur le paiement orphelin).
const mockPiRetrieve = vi.fn(async (): Promise<{ latest_charge: { transfer: string | null } }> => ({
  latest_charge: { transfer: 'tr_orphan' },
}));

vi.mock('stripe', () => ({
  default: function MockStripe(this: any) {
    this.webhooks = { constructEventAsync: mockConstructEventAsync };
    this.refunds = { list: mockRefundsList, create: mockRefundsCreate };
    this.paymentIntents = { retrieve: mockPiRetrieve };
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

    const res = await POST(buildRequest() as any);

    expect(res.status).toBe(200);
    expect(mockRefundsCreate).toHaveBeenCalledTimes(1);
    // ⚠️ CORRECTIF (audit 22/08) : ce remboursement est à 100% de la charge
    // (aucun `amount` fourni) — le cas où `reverse_transfer: true` suffit
    // (contrairement à un remboursement partiel, voir lib/refunds.ts). Le
    // pro gardait auparavant le dépôt déjà transféré pour un paiement
    // orphelin, sans jamais le lui reprendre.
    expect(mockRefundsCreate).toHaveBeenCalledWith({ payment_intent: 'pi_456', reverse_transfer: true });
    expect(chains.booking_members.update).not.toHaveBeenCalled();
  });

  it('CORRECTIF 22/08 — paiement orphelin SANS transfert associé (fixture sans compte Connect) → reverse_transfer non posé, refund quand même effectué', async () => {
    chains.booking_members = makeChain([], { id: 'm4', status: 'cancelled', name: 'Dana' });
    mockRefundsList.mockResolvedValueOnce({ data: [] });
    mockPiRetrieve.mockResolvedValueOnce({ latest_charge: { transfer: null } });
    eventFixture = sessionEvent({
      metadata: { bookingId: 'bk1', memberId: 'm4' },
      payment_intent: 'pi_no_transfer',
    });

    const res = await POST(buildRequest() as any);

    expect(res.status).toBe(200);
    expect(mockRefundsCreate).toHaveBeenCalledWith({ payment_intent: 'pi_no_transfer' });
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

    const res = await POST(buildRequest() as any);

    expect(res.status).toBe(200);
    expect(mockRefundsList).not.toHaveBeenCalled();
    expect(mockRefundsCreate).not.toHaveBeenCalled();
    const paidCall = chains.booking_members.update.mock.calls.find((c: any[]) => c[0]?.status === 'paid');
    expect(paidCall).toBeTruthy();
  });
});
