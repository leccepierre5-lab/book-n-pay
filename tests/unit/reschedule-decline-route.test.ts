// src/app/api/bookings/reschedule/decline/route.ts — le client refuse le
// créneau proposé (migration 0055). La réservation n'est JAMAIS touchée ici.
// Prouve : rate limit, token manquant/inconnu, idempotence sur declined déjà
// acté, 409 sur un statut définitif différent, course avec un accept/expire
// concurrent (UPDATE conditionné sur status='pending' ne touche aucune ligne),
// cas nominal (booking_logs + notif pro).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCheckRateLimit = vi.fn(async (..._args: any[]) => ({ allowed: true, currentCount: 1 }));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: (...args: any[]) => mockCheckRateLimit(...args),
  getClientIp: () => '1.2.3.4',
}));

const mockNotifyProRescheduleOutcome = vi.fn(async (..._args: any[]) => {});
vi.mock('@/lib/pro-notifications', () => ({
  notifyProRescheduleOutcome: (...args: any[]) => mockNotifyProRescheduleOutcome(...args),
}));

function makeChain(listData: any[], singleData: any = listData[0] ?? null, error: any = null) {
  const chain: any = Promise.resolve({ data: listData, error });
  for (const m of ['select', 'eq', 'update', 'insert']) {
    chain[m] = vi.fn((..._args: any[]) => chain);
  }
  chain.maybeSingle = vi.fn(async () => ({ data: singleData, error }));
  return chain;
}

let chains: Record<string, any> = {};
vi.mock('@/lib/supabase/server', () => ({
  createServiceRoleClient: vi.fn(() => ({ from: (t: string) => chains[t] })),
}));

function buildRequest(token: string | null) {
  return new Request('http://localhost/api/bookings/reschedule/decline', {
    method: 'POST',
    body: JSON.stringify(token ? { token } : {}),
  });
}

const PENDING_PROPOSAL = {
  id: 'proposal-1', booking_id: 'bk1', status: 'pending',
  proposed_date: '2099-01-11', proposed_time: '11:00:00',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockCheckRateLimit.mockResolvedValue({ allowed: true, currentCount: 1 });
  chains = {};
});

describe('POST /api/bookings/reschedule/decline', () => {
  it('rate limit dépassé → 429', async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false, currentCount: 11 });
    const { POST } = await import('@/app/api/bookings/reschedule/decline/route');
    const res = await POST(buildRequest('tok') as any);
    expect(res.status).toBe(429);
  });

  it('token manquant → 400', async () => {
    const { POST } = await import('@/app/api/bookings/reschedule/decline/route');
    const res = await POST(buildRequest(null) as any);
    expect(res.status).toBe(400);
  });

  it('proposition introuvable → 404', async () => {
    chains.reschedule_proposals = makeChain([], null);
    const { POST } = await import('@/app/api/bookings/reschedule/decline/route');
    const res = await POST(buildRequest('tok-inconnu') as any);
    expect(res.status).toBe(404);
  });

  it('déjà declined → idempotent 200', async () => {
    chains.reschedule_proposals = makeChain([], { ...PENDING_PROPOSAL, status: 'declined' });
    const { POST } = await import('@/app/api/bookings/reschedule/decline/route');
    const res = await POST(buildRequest('tok') as any);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json).toEqual({ success: true, alreadyDeclined: true });
  });

  it.each(['accepted', 'slot_taken', 'expired'])('statut définitif %s → 409', async (status) => {
    chains.reschedule_proposals = makeChain([], { ...PENDING_PROPOSAL, status });
    const { POST } = await import('@/app/api/bookings/reschedule/decline/route');
    const res = await POST(buildRequest('tok') as any);
    expect(res.status).toBe(409);
  });

  it('course avec un accept/expire concurrent (UPDATE ne touche aucune ligne) → 409', async () => {
    chains.reschedule_proposals = makeChain([], PENDING_PROPOSAL);
    // 1er appel .maybeSingle() = lecture initiale (trouvée, pending) ; 2e =
    // après l'UPDATE conditionné sur status='pending', qui n'a rien touché
    // (tranchée entre-temps par un accept/expire concurrent).
    chains.reschedule_proposals.maybeSingle = vi
      .fn()
      .mockResolvedValueOnce({ data: PENDING_PROPOSAL, error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    const { POST } = await import('@/app/api/bookings/reschedule/decline/route');
    const res = await POST(buildRequest('tok') as any);
    expect(res.status).toBe(409);
  });

  it('cas nominal : declined, booking_logs, notif pro', async () => {
    chains.reschedule_proposals = makeChain([], PENDING_PROPOSAL);
    chains.reschedule_proposals.maybeSingle = vi
      .fn()
      .mockResolvedValueOnce({ data: PENDING_PROPOSAL, error: null })
      .mockResolvedValueOnce({ data: { ...PENDING_PROPOSAL, status: 'declined' }, error: null });
    chains.booking_logs = makeChain([]);

    const { POST } = await import('@/app/api/bookings/reschedule/decline/route');
    const res = await POST(buildRequest('tok') as any);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ success: true });
    expect(chains.reschedule_proposals.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'declined' })
    );

    const logMessage = chains.booking_logs.insert.mock.calls[0][0].message;
    expect(logMessage).toContain('RESCHEDULE_DECLINED');

    expect(mockNotifyProRescheduleOutcome).toHaveBeenCalledWith(
      expect.anything(), 'bk1', expect.objectContaining({ outcome: 'declined' })
    );
  });
});
