// src/app/api/pro/cancel-booking/route.ts — C15, annulation d'un RDV à venir
// par le pro (avec remboursement), audité 26/07 comme le seul mécanisme
// manquant qui touche un cas certain à se produire.
//
// Ces tests prouvent :
// 1. Auth/rate-limit/autorisation biz gardent bien la route.
// 2. Idempotence : un membre déjà 'cancelled' ne redéclenche jamais Stripe.
// 3. Un RDV déjà passé est rejeté (refund-gesture couvre ce cas, pas C15).
// 4. Cas nominal : refund OK → statut 'cancelled' (pas de statut parallèle,
//    voir commentaire de tête de route.ts), montant_rembourse posé, créneau
//    libéré (cancelBookingIfNoActiveMembers → bookings.status='cancelled'),
//    log ANNULATION_PRO au format constant, email client envoyé, pas
//    d'alerte admin.
// 5. Échec Stripe : le membre est quand même annulé et le créneau libéré
//    (le pro est indisponible quoi qu'il arrive côté Stripe), le log porte
//    refund_status=echec, une alerte admin part.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetUser = vi.fn();
let authProfile: any = null;

const mockRefundsCreate = vi.fn(async () => ({ id: 're_test' }));
vi.mock('@/lib/stripe/client', () => ({
  getStripeClient: vi.fn(async () => ({ refunds: { create: mockRefundsCreate } })),
}));

const mockCheckRateLimit = vi.fn(async (..._args: any[]) => ({ allowed: true, currentCount: 1 }));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: (...args: any[]) => mockCheckRateLimit(...args),
}));

const mockSendEmail = vi.fn(async (..._args: any[]) => ({ sent: true }));
vi.mock('@/lib/email/send', () => ({ sendEmail: (...args: any[]) => mockSendEmail(...args) }));

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
        return { select: () => ({ eq: () => ({ single: async () => ({ data: authProfile }) }) }) };
      }
      throw new Error('unexpected table on authed client: ' + t);
    },
  })),
  createServiceRoleClient: vi.fn(() => ({ from: (t: string) => chains[t] })),
}));

function buildRequest(body: any) {
  return new Request('http://localhost/api/pro/cancel-booking', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

const FUTURE_BOOKING = {
  biz_id: 'biz-1', biz_name: 'Salon Test', service_name: 'Coupe', date: '2099-01-01', time: '10:00:00',
  client_email: 'client@example.com',
};
const PAST_BOOKING = { ...FUTURE_BOOKING, date: '2020-01-01' };
const PAID_MEMBER = {
  id: 'm1', booking_id: 'bk1', status: 'paid', deposit: 15, email: 'client@example.com', name: 'Client Test',
  stripe_payment_intent_id: 'pi_123',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockCheckRateLimit.mockResolvedValue({ allowed: true, currentCount: 1 });
  chains = {};
  authProfile = { role: 'pro', biz_id: 'biz-1' };
});

describe('POST /api/pro/cancel-booking', () => {
  it('non authentifié → 401, rien interrogé', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const { POST } = await import('@/app/api/pro/cancel-booking/route');
    const res = await POST(buildRequest({ bookingId: 'bk1', memberId: 'm1' }) as any);

    expect(res.status).toBe(401);
    expect(mockRefundsCreate).not.toHaveBeenCalled();
  });

  it('rate limit dépassé → 429, rien interrogé', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'pro1', email: 'pro@example.com' } } });
    mockCheckRateLimit.mockResolvedValue({ allowed: false, currentCount: 21 });

    const { POST } = await import('@/app/api/pro/cancel-booking/route');
    const res = await POST(buildRequest({ bookingId: 'bk1', memberId: 'm1' }) as any);

    expect(res.status).toBe(429);
    expect(mockRefundsCreate).not.toHaveBeenCalled();
  });

  it("pro d'un AUTRE business → 403, jamais atteint le membre/refund", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'pro1', email: 'pro@example.com' } } });
    authProfile = { role: 'pro', biz_id: 'biz-AUTRE' };
    chains.bookings = makeChain([], FUTURE_BOOKING);

    const { POST } = await import('@/app/api/pro/cancel-booking/route');
    const res = await POST(buildRequest({ bookingId: 'bk1', memberId: 'm1' }) as any);

    expect(res.status).toBe(403);
    expect(mockRefundsCreate).not.toHaveBeenCalled();
  });

  it("membre déjà 'cancelled' → idempotent, aucun second appel Stripe", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'pro1', email: 'pro@example.com' } } });
    chains.bookings = makeChain([], FUTURE_BOOKING);
    chains.booking_members = makeChain([], { ...PAID_MEMBER, status: 'cancelled' });

    const { POST } = await import('@/app/api/pro/cancel-booking/route');
    const res = await POST(buildRequest({ bookingId: 'bk1', memberId: 'm1' }) as any);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.alreadyCancelled).toBe(true);
    expect(mockRefundsCreate).not.toHaveBeenCalled();
  });

  it('RDV déjà passé → 400, refund-gesture est le bon outil, pas celui-ci', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'pro1', email: 'pro@example.com' } } });
    chains.bookings = makeChain([], PAST_BOOKING);
    chains.booking_members = makeChain([], PAID_MEMBER);

    const { POST } = await import('@/app/api/pro/cancel-booking/route');
    const res = await POST(buildRequest({ bookingId: 'bk1', memberId: 'm1' }) as any);

    expect(res.status).toBe(400);
    expect(mockRefundsCreate).not.toHaveBeenCalled();
  });

  it('cas nominal : refund OK → cancelled (pas de statut parallèle), créneau libéré, log ANNULATION_PRO, email client, pas d\'alerte admin', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'pro1', email: 'pro@example.com' } } });
    chains.bookings = makeChain([], FUTURE_BOOKING);
    // listData=[] : après annulation, plus aucun membre actif restant →
    // cancelBookingIfNoActiveMembers doit fermer le booking.
    chains.booking_members = makeChain([], PAID_MEMBER);
    chains.booking_logs = makeChain([]);

    const { POST } = await import('@/app/api/pro/cancel-booking/route');
    const res = await POST(buildRequest({ bookingId: 'bk1', memberId: 'm1' }) as any);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ success: true, refundDone: true, refundAmount: 15 });

    expect(mockRefundsCreate).toHaveBeenCalledWith({
      payment_intent: 'pi_123',
      amount: 1500,
      reason: 'requested_by_customer',
      metadata: { email_sent: 'true', reason: 'pro_cancellation' },
    });

    // Statut réutilisé, pas de valeur parallèle — voir en-tête de route.ts.
    const memberUpdateCall = chains.booking_members.update.mock.calls[0][0];
    expect(memberUpdateCall).toEqual({ status: 'cancelled', montant_rembourse: 15 });

    // Créneau libéré : cancelBookingIfNoActiveMembers a fermé le booking.
    expect(chains.bookings.update).toHaveBeenCalledWith({ status: 'cancelled' });

    // Log au format constant/parsable.
    const logMessage = chains.booking_logs.insert.mock.calls[0][0].message;
    expect(logMessage).toBe(
      'ANNULATION_PRO | pro_id=pro1 | pro_email=pro@example.com | montant_rembourse=15.00 | refund_status=ok'
    );

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockSendEmail.mock.calls[0][0].to).toBe('client@example.com');
    expect(mockNotifyAdminOnFailure).not.toHaveBeenCalled();
  });

  it('échec Stripe : le membre est quand même annulé et le créneau libéré, log refund_status=echec, alerte admin envoyée', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'pro1', email: 'pro@example.com' } } });
    chains.bookings = makeChain([], FUTURE_BOOKING);
    chains.booking_members = makeChain([], PAID_MEMBER);
    chains.booking_logs = makeChain([]);
    mockRefundsCreate.mockRejectedValueOnce(new Error('solde Connect insuffisant'));

    const { POST } = await import('@/app/api/pro/cancel-booking/route');
    const res = await POST(buildRequest({ bookingId: 'bk1', memberId: 'm1' }) as any);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.refundDone).toBe(false);

    const memberUpdateCall = chains.booking_members.update.mock.calls[0][0];
    expect(memberUpdateCall).toEqual({ status: 'cancelled', montant_rembourse: null });
    expect(chains.bookings.update).toHaveBeenCalledWith({ status: 'cancelled' });

    const logMessage = chains.booking_logs.insert.mock.calls[0][0].message;
    expect(logMessage).toBe(
      'ANNULATION_PRO | pro_id=pro1 | pro_email=pro@example.com | montant_rembourse=0.00 | refund_status=echec'
    );

    expect(mockNotifyAdminOnFailure).toHaveBeenCalledTimes(1);
    expect(mockNotifyAdminOnFailure.mock.calls[0][0]).toBe('pro/cancel-booking:refund');
  });
});
