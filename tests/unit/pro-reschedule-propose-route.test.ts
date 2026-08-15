// src/app/api/pro/reschedule-propose/route.ts — le pro propose un nouveau
// créneau pour un RDV à venir (migration 0055). Prouve :
// 1. Auth/rate-limit/autorisation biz gardent la route.
// 2. Réservation non active ou de groupe → rejetée (portée individuel only,
//    décision 15/08).
// 3. RDV à moins de 2h → rejeté (report impossible, annulation directe).
// 4. Créneau proposé dans le passé → rejeté.
// 5. Proposition déjà en attente pour la même réservation → 409.
// 6. Cas nominal : ligne créée, booking_logs, email au client avec le lien.
// 7. Course sur la contrainte unique (double clic) → 409, pas de crash.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCheckRateLimit = vi.fn(async (..._args: any[]) => ({ allowed: true, currentCount: 1 }));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: (...args: any[]) => mockCheckRateLimit(...args),
}));

const mockSendEmail = vi.fn(async (..._args: any[]) => ({ sent: true }));
vi.mock('@/lib/email/send', () => ({ sendEmail: (...args: any[]) => mockSendEmail(...args) }));

const mockGenerateToken = vi.fn((..._args: any[]) => 'tok_test_123');
const mockComputeExpiresAt = vi.fn((...args: any[]): Date | null => {
  const rdv = args[0] as Date;
  return new Date(rdv.getTime() - 24 * 60 * 60 * 1000);
});
vi.mock('@/lib/reschedule', () => ({
  generateRescheduleToken: (...args: any[]) => mockGenerateToken(...args),
  computeRescheduleExpiresAt: (...args: any[]) => mockComputeExpiresAt(...args),
}));

const mockGetUser = vi.fn();
let authProfile: any = null;

function makeChain(listData: any[], singleData: any = listData[0] ?? null, error: any = null) {
  const chain: any = Promise.resolve({ data: listData, error });
  for (const m of ['select', 'eq', 'neq', 'update', 'insert']) {
    chain[m] = vi.fn((..._args: any[]) => chain);
  }
  chain.maybeSingle = vi.fn(async () => ({ data: singleData, error }));
  chain.single = vi.fn(async () => ({ data: singleData, error }));
  return chain;
}

// reschedule_proposals a besoin de deux réponses DIFFÉRENTES dans la même
// requête : .maybeSingle() (existingPending, doit être null par défaut) et
// .single() après insert (la ligne créée) — makeChain générique renvoie la
// même donnée aux deux, donc chain dédiée ici.
function makeProposalsChain(insertedProposal: any = { id: 'proposal-1' }, insertError: any = null, existingPending: any = null) {
  const chain: any = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.insert = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(async () => ({ data: existingPending, error: null }));
  chain.single = vi.fn(async () => ({ data: insertError ? null : insertedProposal, error: insertError }));
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
  createServiceRoleClient: vi.fn(() => ({
    from: (t: string) => chains[t],
  })),
}));

function buildRequest(body: any) {
  return new Request('http://localhost/api/pro/reschedule-propose', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

const ACTIVE_BOOKING = {
  id: 'bk1', biz_id: 'biz-1', biz_name: 'Salon Test', service_name: 'Coupe',
  date: '2099-01-10', time: '10:00:00', status: 'active', group_ref: null,
  client_email: 'client@example.com', client_name: 'Client Test',
};

const VALID_BODY = { bookingId: 'bk1', proposedDate: '2099-01-11', proposedTime: '11:00' };

beforeEach(() => {
  vi.clearAllMocks();
  mockCheckRateLimit.mockResolvedValue({ allowed: true, currentCount: 1 });
  mockGenerateToken.mockReturnValue('tok_test_123');
  mockComputeExpiresAt.mockImplementation((rdv: Date) => new Date(rdv.getTime() - 24 * 60 * 60 * 1000));
  chains = {};
  authProfile = { role: 'pro', biz_id: 'biz-1' };
});

describe('POST /api/pro/reschedule-propose', () => {
  it('non authentifié → 401', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const { POST } = await import('@/app/api/pro/reschedule-propose/route');
    const res = await POST(buildRequest(VALID_BODY) as any);
    expect(res.status).toBe(401);
  });

  it('rate limit dépassé → 429', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'pro1' } } });
    mockCheckRateLimit.mockResolvedValue({ allowed: false, currentCount: 21 });
    const { POST } = await import('@/app/api/pro/reschedule-propose/route');
    const res = await POST(buildRequest(VALID_BODY) as any);
    expect(res.status).toBe(429);
  });

  it('champs manquants → 400', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'pro1' } } });
    const { POST } = await import('@/app/api/pro/reschedule-propose/route');
    const res = await POST(buildRequest({ bookingId: 'bk1' }) as any);
    expect(res.status).toBe(400);
  });

  it('réservation introuvable → 404', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'pro1' } } });
    chains.bookings = makeChain([], null);
    const { POST } = await import('@/app/api/pro/reschedule-propose/route');
    const res = await POST(buildRequest(VALID_BODY) as any);
    expect(res.status).toBe(404);
  });

  it("pro d'un AUTRE business → 403", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'pro1' } } });
    authProfile = { role: 'pro', biz_id: 'biz-AUTRE' };
    chains.bookings = makeChain([], ACTIVE_BOOKING);
    const { POST } = await import('@/app/api/pro/reschedule-propose/route');
    const res = await POST(buildRequest(VALID_BODY) as any);
    expect(res.status).toBe(403);
  });

  it('réservation non active (annulée) → 400', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'pro1' } } });
    chains.bookings = makeChain([], { ...ACTIVE_BOOKING, status: 'cancelled' });
    const { POST } = await import('@/app/api/pro/reschedule-propose/route');
    const res = await POST(buildRequest(VALID_BODY) as any);
    expect(res.status).toBe(400);
  });

  it('réservation de groupe → 400, portée individuel uniquement (décision 15/08)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'pro1' } } });
    chains.bookings = makeChain([], { ...ACTIVE_BOOKING, group_ref: 'grp-1' });
    const { POST } = await import('@/app/api/pro/reschedule-propose/route');
    const res = await POST(buildRequest(VALID_BODY) as any);
    expect(res.status).toBe(400);
  });

  it('RDV à moins de 2h (computeRescheduleExpiresAt → null) → 400, report impossible', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'pro1' } } });
    chains.bookings = makeChain([], ACTIVE_BOOKING);
    mockComputeExpiresAt.mockReturnValueOnce(null);
    const { POST } = await import('@/app/api/pro/reschedule-propose/route');
    const res = await POST(buildRequest(VALID_BODY) as any);
    expect(res.status).toBe(400);
  });

  it('créneau proposé dans le passé → 400', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'pro1' } } });
    chains.bookings = makeChain([], ACTIVE_BOOKING);
    const { POST } = await import('@/app/api/pro/reschedule-propose/route');
    const res = await POST(buildRequest({ ...VALID_BODY, proposedDate: '2020-01-01', proposedTime: '10:00' }) as any);
    expect(res.status).toBe(400);
  });

  it('proposition déjà en attente pour cette réservation → 409, aucun insert', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'pro1' } } });
    chains.bookings = makeChain([], ACTIVE_BOOKING);
    chains.reschedule_proposals = makeProposalsChain(undefined, null, { id: 'existing-1' });
    const { POST } = await import('@/app/api/pro/reschedule-propose/route');
    const res = await POST(buildRequest(VALID_BODY) as any);
    expect(res.status).toBe(409);
    expect(chains.reschedule_proposals.insert).not.toHaveBeenCalled();
  });

  it('cas nominal : ligne créée, booking_logs, email au client avec le lien token', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'pro1' } } });
    chains.bookings = makeChain([], ACTIVE_BOOKING);
    chains.reschedule_proposals = makeProposalsChain({ id: 'proposal-1' });
    chains.booking_logs = makeChain([]);

    const { POST } = await import('@/app/api/pro/reschedule-propose/route');
    const res = await POST(buildRequest({ ...VALID_BODY, reason: 'Absence imprévue' }) as any);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({ success: true, proposalId: 'proposal-1' });

    expect(chains.reschedule_proposals.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        booking_id: 'bk1',
        original_date: '2099-01-10',
        original_time: '10:00:00',
        proposed_date: '2099-01-11',
        proposed_time: '11:00',
        token: 'tok_test_123',
        status: 'pending',
        reason: 'Absence imprévue',
        created_by: 'pro1',
      })
    );

    const logMessage = chains.booking_logs.insert.mock.calls[0][0].message;
    expect(logMessage).toContain('RESCHEDULE_PROPOSED | proposal_id=proposal-1');

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    const emailCall = mockSendEmail.mock.calls[0][0];
    expect(emailCall.to).toBe('client@example.com');
    expect(emailCall.text).toContain('/reschedule/tok_test_123');
  });

  it('course sur la contrainte unique (double clic) → 409, pas de crash', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'pro1' } } });
    chains.bookings = makeChain([], ACTIVE_BOOKING);
    chains.reschedule_proposals = makeProposalsChain(
      undefined,
      { code: '23505', message: 'duplicate key value violates unique constraint' },
      null
    );

    const { POST } = await import('@/app/api/pro/reschedule-propose/route');
    const res = await POST(buildRequest(VALID_BODY) as any);
    expect(res.status).toBe(409);
  });
});
