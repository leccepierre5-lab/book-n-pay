// src/app/api/loyalty/use-joker/route.ts
//
// Correctif du 21/08 : un Joker était consommé même quand l'annulation
// était déjà gratuite (>= CANCEL_DEADLINE_HOURS avant le RDV), gaspillant
// silencieusement le quota annuel du client. Ces tests prouvent :
// 1. RDV encore loin (>=48h) : jokerApplique=false, raison explicite,
//    AUCUN appel Stripe, AUCUNE décrémentation du quota Joker.
// 2. RDV proche (<48h, cas où l'annulation serait sinon payante) : le
//    Joker fonctionne toujours normalement (refund + quota décrémenté).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetUser = vi.fn();
let callerProfile: any = null;

const mockRefundsCreate = vi.fn(async (..._args: any[]) => ({ id: 're_test' }));
const mockPiRetrieve = vi.fn(async (..._args: any[]) => ({ latest_charge: { transfer: 'tr_test' } }));
const mockCreateReversal = vi.fn(async (..._args: any[]) => ({ id: 'trr_test' }));
vi.mock('@/lib/stripe/client', () => ({
  getStripeClient: vi.fn(async () => ({
    refunds: { create: mockRefundsCreate },
    paymentIntents: { retrieve: mockPiRetrieve },
    transfers: { createReversal: mockCreateReversal },
  })),
}));

const mockNotifyAdminOnFailure = vi.fn(async (..._args: any[]) => {});
vi.mock('@/lib/notify-admin', () => ({
  notifyAdminOnFailure: (...args: any[]) => mockNotifyAdminOnFailure(...args),
}));

const mockInsertRefundFailure = vi.fn(async (..._args: any[]) => {});
vi.mock('@/lib/refund-failures', () => ({
  insertRefundFailure: (...args: any[]) => mockInsertRefundFailure(...args),
}));

const mockCancelBookingIfNoActiveMembers = vi.fn(async (..._args: any[]) => {});
vi.mock('@/lib/booking-lifecycle', () => ({
  cancelBookingIfNoActiveMembers: (...args: any[]) => mockCancelBookingIfNoActiveMembers(...args),
}));

const mockNotifyProBookingCancelled = vi.fn(async (..._args: any[]) => {});
vi.mock('@/lib/pro-notifications', () => ({
  notifyProBookingCancelled: (...args: any[]) => mockNotifyProBookingCancelled(...args),
}));

function makeChain(listData: any[], singleData: any = listData[0] ?? null, error: any = null) {
  const chain: any = Promise.resolve({ data: listData, error });
  // 'or' — withRefundClaim() (audit 22/08, migration 0063), désormais
  // câblée sur cette route. fait .update(...).eq(...).or(...).select('id')
  // .maybeSingle() avant tout appel Stripe ; singleData (le membre, vérité
  // dans ces tests) fait réussir la réclamation.
  for (const m of ['select', 'eq', 'or', 'update']) {
    chain[m] = vi.fn((..._args: any[]) => chain);
  }
  chain.maybeSingle = vi.fn(async () => ({ data: singleData, error }));
  return chain;
}

let chains: Record<string, any> = {};
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
    from: (t: string) => {
      if (t === 'app_users') {
        return { select: () => ({ eq: () => ({ single: async () => ({ data: callerProfile }) }) }) };
      }
      throw new Error('unexpected table on authed client: ' + t);
    },
  })),
  createServiceRoleClient: vi.fn(() => ({
    from: (t: string) => chains[t],
  })),
}));

function buildRequest(body: any) {
  return new Request('http://localhost/api/loyalty/use-joker', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// Formate un instant réel (maintenant + offsetHours) en date/heure Paris —
// robuste quelle que soit la date d'exécution des tests, contrairement à
// une date en dur qui pourrait un jour tomber du mauvais côté du seuil 48h.
function parisDateTimeInHours(offsetHours: number): { date: string; time: string } {
  const d = new Date(Date.now() + offsetHours * 3600 * 1000);
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).format(d);
  return { date, time };
}

const TARGET_MEMBER = {
  phone: '+33612345678', status: 'paid', deposit: 15, stripe_payment_intent_id: 'pi_123',
};
const USER = {
  id: 'user-1', name: 'Client Test', statut: 'Bronze', jokers_disponibles: 2, jokers_utilises: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  chains = {};
  callerProfile = { phone: '+33612345678', role: 'client' };
  mockGetUser.mockResolvedValue({ data: { user: { id: 'client1' } } });
});

describe('POST /api/loyalty/use-joker', () => {
  it('RDV >= 48h : annulation déjà gratuite, aucun Joker consommé, aucun appel Stripe', async () => {
    chains.booking_members = makeChain([], TARGET_MEMBER);
    chains.bookings = makeChain([], parisDateTimeInHours(72)); // 3 jours, largement >48h
    chains.app_users = makeChain([], USER);

    const { POST } = await import('@/app/api/loyalty/use-joker/route');
    const res = await POST(buildRequest({ phone: '0612345678', bookingId: 'bk1', memberId: 'm1' }) as any);
    const json = await res.json();

    expect(json.jokerApplique).toBe(false);
    expect(json.raison).toContain('déjà gratuite');
    expect(mockRefundsCreate).not.toHaveBeenCalled();
    // Le quota Joker n'a jamais été touché : app_users.update jamais appelé.
    expect(chains.app_users.update).not.toHaveBeenCalled();
    expect(chains.booking_members.update).not.toHaveBeenCalled();
  });

  it('RDV < 48h : le Joker fonctionne normalement (refund + quota décrémenté)', async () => {
    chains.booking_members = makeChain([], TARGET_MEMBER);
    chains.bookings = makeChain([], parisDateTimeInHours(5)); // dans 5h, largement <48h
    chains.app_users = makeChain([], USER);

    const { POST } = await import('@/app/api/loyalty/use-joker/route');
    const res = await POST(buildRequest({ phone: '0612345678', bookingId: 'bk1', memberId: 'm1' }) as any);
    const json = await res.json();

    expect(json.jokerApplique).toBe(true);
    expect(json.montantRembourse).toBe(15);
    expect(mockRefundsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: 'pi_123', amount: 1500 }),
      expect.anything()
    );
    expect(chains.app_users.update).toHaveBeenCalledWith({ jokers_disponibles: 1, jokers_utilises: 1 });
    expect(chains.booking_members.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'cancelled', joker_applique: true })
    );

    // ⚠️ CORRECTIF (audit 22/08) : le dépôt déjà transféré au pro doit être
    // récupéré après le remboursement Joker — même bug que reverse_transfer
    // (d77eaa1), un point d'appel oublié par ce correctif-là. Sans ça, le
    // pro garde le dépôt ET le client est remboursé : la différence reste à
    // la charge de Book'nPay, en silence.
    expect(mockCreateReversal).toHaveBeenCalledWith('tr_test', { amount: 1500 }, { idempotencyKey: 'reversal_pi_123' });
  });

  it('CORRECTIF 22/08 — réversal du dépôt échoué après un remboursement Joker : alerte admin, mais le remboursement client et le quota restent acquis', async () => {
    chains.booking_members = makeChain([], TARGET_MEMBER);
    chains.bookings = makeChain([], parisDateTimeInHours(5));
    chains.app_users = makeChain([], USER);

    mockCreateReversal.mockRejectedValueOnce(new Error('insufficient balance'));

    const { POST } = await import('@/app/api/loyalty/use-joker/route');
    const res = await POST(buildRequest({ phone: '0612345678', bookingId: 'bk1', memberId: 'm1' }) as any);
    const json = await res.json();

    // Le remboursement client et la décrémentation du quota ont bien eu
    // lieu malgré l'échec du réversal — best-effort strict, jamais un
    // blocage (même principe que bookings/cancel).
    expect(json.jokerApplique).toBe(true);
    expect(chains.app_users.update).toHaveBeenCalledWith({ jokers_disponibles: 1, jokers_utilises: 1 });

    // Mais l'échec de récupération auprès du pro est bien tracé et alerté.
    expect(mockNotifyAdminOnFailure).toHaveBeenCalledWith(
      'loyalty/use-joker:reverse_transfer',
      expect.objectContaining({ failed: 1 }),
      'action'
    );
    expect(mockInsertRefundFailure).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ errorMessage: expect.stringMatching(/réversal.*échouée.*Joker/i) })
    );
  });
});
