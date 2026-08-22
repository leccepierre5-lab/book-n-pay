// src/app/api/admin/refund-failures/[id]/retry/route.ts — bouton "Relancer"
// de /admin/remboursements (migration 0052, bug reverse_transfer corrigé le
// 14/08, voir mémoire projet_bnp_refund_failures_reverse_transfer). Spec
// donnée par Pierre à la reprise du 14/08 :
// 1. Rôle non-admin → 403, avant tout appel Stripe.
// 2. Charge sans transfert → pas de reverse_transfer, refund créé, status
//    'resolved', montant_rembourse posé.
// 3. Charge avec transfert → reverse_transfer:true.
// 4. Échec Stripe → attempts incrémenté, error_message remplacé, status
//    reste 'open'.
// 5. Ligne déjà 'resolved' → pas de second remboursement (le SELECT filtre
//    déjà .eq('status','open'), vérifié explicitement ici).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetUser = vi.fn();
let authProfile: any = null;

const mockRefundsCreate = vi.fn(async (..._args: any[]) => ({ id: 're_test' }));
// Aucun refund existant par défaut (pré-check anti-doublon, audit 22/08) —
// les tests dédiés à ce pré-check l'écrasent avec des refunds fictifs.
const mockRefundsList = vi.fn(async (..._args: any[]) => ({ data: [] as any[] }));
// Transfert PRÉSENT par défaut — le test dédié "sans transfert" l'écrase.
const mockPiRetrieve = vi.fn(async (..._args: any[]): Promise<{ latest_charge: { transfer: string | null } }> => ({
  latest_charge: { transfer: 'tr_test' },
}));
vi.mock('@/lib/stripe/client', () => ({
  getStripeClient: vi.fn(async () => ({
    refunds: { create: mockRefundsCreate, list: mockRefundsList },
    paymentIntents: { retrieve: (...args: any[]) => mockPiRetrieve(...args) },
  })),
}));

// ⚠️ CORRECTIF (audit 22/08) : `reverse_transfer: true` sur le refund lui-
// même n'est plus posé que pour un remboursement à 100% de la charge — sur
// un remboursement PARTIEL (le cas le plus fréquent : la majorité des
// `refund_failures` viennent de bookings/cancel/refund-gesture/freeze-
// business/use-joker/expire-groups, tous des dépôts seuls), le réversal
// exact passe désormais par reverseConnectedAccountTransfer séparément.
const mockReverseTransfer = vi.fn(async (..._args: any[]): Promise<{ done: boolean; error?: string }> => ({ done: true }));
// Mock PARTIEL (importOriginal), pas un remplacement total du module —
// withRefundClaim() et RefundAlreadyClaimedError (audit 22/08, migration
// 0063) sont désormais importés par la route ; un mock total qui ne les
// réexporte pas casse au premier `instanceof` (piège constaté le 22/08).
// withRefundClaim est un passthrough ici : ces tests portent sur la
// logique métier de la route (branchement failure_type, garde-fous
// montant), pas sur la concurrence du verrou — couverte à part.
vi.mock('@/lib/refunds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/refunds')>();
  return {
    ...actual,
    reverseConnectedAccountTransfer: (...args: any[]) => mockReverseTransfer(...args),
    withRefundClaim: async (_supabase: any, _memberId: string, attempt: () => Promise<any>) => attempt(),
  };
});

const mockNotifyAdminOnFailure = vi.fn(async (..._args: any[]) => {});
vi.mock('@/lib/notify-admin', () => ({
  notifyAdminOnFailure: (...args: any[]) => mockNotifyAdminOnFailure(...args),
}));

function makeChain(listData: any[], singleData: any = listData[0] ?? null, error: any = null) {
  const chain: any = Promise.resolve({ data: listData, error });
  for (const m of ['select', 'eq', 'neq', 'update', 'insert']) {
    chain[m] = vi.fn((..._args: any[]) => chain);
  }
  chain.maybeSingle = vi.fn(async () => ({ data: singleData, error }));
  chain.single = vi.fn(async () => ({ data: singleData, error }));
  return chain;
}

let chains: Record<string, any> = {};
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
    from: (t: string) => {
      if (t === 'app_users') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: authProfile }) }) }) };
      }
      throw new Error('unexpected table on authed client: ' + t);
    },
  })),
  createServiceRoleClient: vi.fn(() => ({
    from: (t: string) => chains[t],
  })),
}));

function buildRequest() {
  return new Request('http://localhost/api/admin/refund-failures/f1/retry', { method: 'POST' });
}
function buildParams(id = 'f1') {
  return { params: Promise.resolve({ id }) };
}

const OPEN_FAILURE = {
  id: 'f1', booking_id: 'bk1', stripe_charge_id: 'pi_123', amount_cents: 1599,
  status: 'open', attempts: 1, error_code: null, error_message: 'échec précédent',
};
const MEMBER = { id: 'm1', montant_rembourse: null };

beforeEach(() => {
  vi.clearAllMocks();
  chains = {};
  chains.refund_failures = makeChain([], OPEN_FAILURE);
  chains.booking_members = makeChain([], MEMBER);
  chains.booking_logs = makeChain([]);
  authProfile = { role: 'admin' };
  mockGetUser.mockResolvedValue({ data: { user: { id: 'admin1', email: 'admin@example.com' } } });
});

describe('POST /api/admin/refund-failures/[id]/retry', () => {
  it('rôle non-admin → 403, avant tout appel Stripe', async () => {
    authProfile = { role: 'pro' };

    const { POST } = await import('@/app/api/admin/refund-failures/[id]/retry/route');
    const res = await POST(buildRequest() as any, buildParams());

    expect(res.status).toBe(403);
    expect(mockPiRetrieve).not.toHaveBeenCalled();
    expect(mockRefundsCreate).not.toHaveBeenCalled();
  });

  it("charge sans transfert : reverse_transfer omis, refund créé, status 'resolved', montant_rembourse posé", async () => {
    mockPiRetrieve.mockResolvedValueOnce({ latest_charge: { transfer: null } });

    const { POST } = await import('@/app/api/admin/refund-failures/[id]/retry/route');
    const res = await POST(buildRequest() as any, buildParams());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ success: true, resolved: true });

    expect(mockRefundsCreate).toHaveBeenCalledWith(
      {
        payment_intent: 'pi_123',
        amount: 1599,
        reason: 'requested_by_customer',
        metadata: { email_sent: 'true', reason: 'refund_failure_retry' },
      },
      { idempotencyKey: 'refund_pi_123' }
    );
    expect(mockRefundsCreate.mock.calls[0][0]).not.toHaveProperty('reverse_transfer');

    expect(chains.booking_members.update).toHaveBeenCalledWith({ montant_rembourse: 15.99 });
    expect(chains.refund_failures.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'resolved', resolved_by: 'admin1' })
    );
  });

  it('charge avec transfert ET remboursement à 100% de la charge (amount_cents === montant réel) : reverse_transfer:true, pas de réversal séparé', async () => {
    // 1599 == failure.amount_cents (OPEN_FAILURE) → remboursement intégral.
    mockPiRetrieve.mockResolvedValueOnce({ latest_charge: { transfer: 'tr_test', amount: 1599 } as any });

    const { POST } = await import('@/app/api/admin/refund-failures/[id]/retry/route');
    await POST(buildRequest() as any, buildParams());

    expect(mockRefundsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ reverse_transfer: true }),
      expect.anything()
    );
    expect(mockReverseTransfer).not.toHaveBeenCalled();
  });

  it("CORRECTIF 22/08 — charge avec transfert ET remboursement PARTIEL (amount_cents < montant réel de la charge, cas le plus fréquent) : reverse_transfer PAS posé sur le refund, réversal exact fait séparément", async () => {
    // Charge réelle à 20,00€ (dépôt+frais), échec à rejouer = 15,99€ seul
    // (dépôt) — exactement le cas d'un échec initial venant de
    // bookings/cancel/refund-gesture/etc. `reverse_transfer: true` sur ce
    // refund partiel sous-récupérerait proportionnellement (voir
    // lib/refunds.ts) — c'est le bug que ce correctif ferme.
    mockPiRetrieve.mockResolvedValueOnce({ latest_charge: { transfer: 'tr_test', amount: 2000 } as any });

    const { POST } = await import('@/app/api/admin/refund-failures/[id]/retry/route');
    const res = await POST(buildRequest() as any, buildParams());

    expect(res.status).toBe(200);
    expect(mockRefundsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 1599 }),
      expect.anything()
    );
    expect(mockRefundsCreate.mock.calls[0][0]).not.toHaveProperty('reverse_transfer');
    expect(mockReverseTransfer).toHaveBeenCalledWith(
      expect.anything(),
      'pi_123',
      1599,
      'RefundFailureRetry',
      'reversal_pi_123'
    );
  });

  it('CORRECTIF 22/08 — réversal partiel échoué : alerte admin + trace booking_logs, mais le remboursement (déjà réussi) reste acquis, status toujours resolved', async () => {
    mockPiRetrieve.mockResolvedValueOnce({ latest_charge: { transfer: 'tr_test', amount: 2000 } as any });
    mockReverseTransfer.mockResolvedValueOnce({ done: false, error: 'insufficient balance' });

    const { POST } = await import('@/app/api/admin/refund-failures/[id]/retry/route');
    const res = await POST(buildRequest() as any, buildParams());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ success: true, resolved: true });
    expect(chains.refund_failures.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'resolved' })
    );
    expect(mockNotifyAdminOnFailure).toHaveBeenCalledWith(
      'admin/refund-failures/retry:reverse_transfer',
      expect.objectContaining({ failed: 1 }),
      'action'
    );
    expect(chains.booking_logs.insert).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringMatching(/Réversal du dépôt.*échoué/i) })
    );
  });

  it("échec Stripe : attempts incrémenté, error_message remplacé, status reste 'open'", async () => {
    mockRefundsCreate.mockRejectedValueOnce(Object.assign(new Error('solde Connect insuffisant'), { code: 'balance_insufficient' }));

    const { POST } = await import('@/app/api/admin/refund-failures/[id]/retry/route');
    const res = await POST(buildRequest() as any, buildParams());

    expect(res.status).toBe(502);
    expect(chains.refund_failures.update).toHaveBeenCalledWith({
      attempts: 2,
      error_code: 'balance_insufficient',
      error_message: 'solde Connect insuffisant',
    });
    // Aucun update avec status: 'resolved' sur cet échec.
    const statusUpdates = chains.refund_failures.update.mock.calls
      .map((c: any[]) => c[0])
      .filter((body: any) => 'status' in body);
    expect(statusUpdates).toHaveLength(0);
  });

  it("garde-fou montant : amount_cents > montant réel de la charge → refus AVANT refunds.create, attempts incrémenté, status reste 'open'", async () => {
    // Charge réelle à 11,99€, amount_cents en base resté à 16,99€ (même
    // scénario que le backfill erroné du 14/08, booking 59a81eb2).
    mockPiRetrieve.mockResolvedValueOnce({ latest_charge: { transfer: 'tr_test', amount: 1199 } as any });

    const { POST } = await import('@/app/api/admin/refund-failures/[id]/retry/route');
    const res = await POST(buildRequest() as any, buildParams());

    expect(res.status).toBe(502);
    expect(mockRefundsCreate).not.toHaveBeenCalled();
    expect(chains.refund_failures.update).toHaveBeenCalledWith(
      expect.objectContaining({ attempts: 2, error_code: null })
    );
    const updateCall = chains.refund_failures.update.mock.calls[0][0];
    expect(updateCall.error_message).toContain('supérieur au montant réel de la charge');
    const statusUpdates = chains.refund_failures.update.mock.calls
      .map((c: any[]) => c[0])
      .filter((body: any) => 'status' in body);
    expect(statusUpdates).toHaveLength(0);
  });

  it('garde-fou montant : amount_cents <= montant réel de la charge → refund exécuté normalement', async () => {
    mockPiRetrieve.mockResolvedValueOnce({ latest_charge: { transfer: 'tr_test', amount: 1599 } as any });

    const { POST } = await import('@/app/api/admin/refund-failures/[id]/retry/route');
    const res = await POST(buildRequest() as any, buildParams());

    expect(res.status).toBe(200);
    expect(mockRefundsCreate).toHaveBeenCalled();
  });

  it("ligne déjà 'resolved' → 404, pas de second remboursement (le SELECT ne trouve rien, .eq('status','open'))", async () => {
    chains.refund_failures = makeChain([], null);

    const { POST } = await import('@/app/api/admin/refund-failures/[id]/retry/route');
    const res = await POST(buildRequest() as any, buildParams());

    expect(res.status).toBe(404);
    expect(mockRefundsCreate).not.toHaveBeenCalled();
  });
});
