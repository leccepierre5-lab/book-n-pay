// src/app/api/cron/reschedule-expire/route.ts — filet de sécurité quotidien
// pour les propositions jamais consultées (migration 0055). Prouve :
// 1. Bearer secret invalide → 401.
// 2. Rien à traiter → processed:0, aucun appel superflu.
// 3. Cas nominal : chaque proposition pending expirée passe 'expired',
//    booking_logs + notif pro, un item en échec n'empêche pas les autres
//    (processBatch).
// 4. Course avec un accept/decline concurrent (UPDATE conditionné ne touche
//    aucune ligne) : traité comme un succès silencieux, pas une erreur.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/constant-time', () => ({
  isValidBearerSecret: (authHeader: string | null, secret: string | undefined) =>
    !!authHeader && authHeader === `Bearer ${secret}`,
}));

const mockNotifyAdminOnFailure = vi.fn(async (..._args: any[]) => {});
vi.mock('@/lib/notify-admin', () => ({
  notifyAdminOnFailure: (...args: any[]) => mockNotifyAdminOnFailure(...args),
}));

const mockNotifyProRescheduleOutcome = vi.fn(async (..._args: any[]) => {});
vi.mock('@/lib/pro-notifications', () => ({
  notifyProRescheduleOutcome: (...args: any[]) => mockNotifyProRescheduleOutcome(...args),
}));

function makeChain(listData: any[], singleData: any = listData[0] ?? null, error: any = null) {
  const chain: any = Promise.resolve({ data: listData, error });
  for (const m of ['select', 'eq', 'lt', 'update', 'insert']) {
    chain[m] = vi.fn((..._args: any[]) => chain);
  }
  chain.maybeSingle = vi.fn(async () => ({ data: singleData, error }));
  return chain;
}

let chains: Record<string, any> = {};
vi.mock('@/lib/supabase/server', () => ({
  createServiceRoleClient: vi.fn(() => ({ from: (t: string) => chains[t] })),
}));

function buildRequest(secret?: string) {
  return new Request('http://localhost/api/cron/reschedule-expire', {
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  chains = {};
  process.env.CRON_SECRET = 'test-secret';
});

describe('GET /api/cron/reschedule-expire', () => {
  it('bearer secret invalide → 401', async () => {
    const { GET } = await import('@/app/api/cron/reschedule-expire/route');
    const res = await GET(buildRequest('mauvais-secret') as any);
    expect(res.status).toBe(401);
  });

  it('rien à traiter → processed:0', async () => {
    chains.reschedule_proposals = makeChain([]);
    const { GET } = await import('@/app/api/cron/reschedule-expire/route');
    const res = await GET(buildRequest('test-secret') as any);
    const json = await res.json();
    expect(json).toEqual({ processed: 0, failed: 0 });
    expect(mockNotifyProRescheduleOutcome).not.toHaveBeenCalled();
  });

  it("cas nominal : deux propositions expirées, chacune passe 'expired', booking_logs + notif pro", async () => {
    const expiredRows = [
      { id: 'p1', booking_id: 'bk1', proposed_date: '2099-01-11', proposed_time: '11:00:00' },
      { id: 'p2', booking_id: 'bk2', proposed_date: '2099-01-12', proposed_time: '12:00:00' },
    ];
    chains.reschedule_proposals = makeChain(expiredRows);
    chains.reschedule_proposals.maybeSingle = vi.fn(async () => ({ data: { id: 'p1' }, error: null }));
    chains.booking_logs = makeChain([]);

    const { GET } = await import('@/app/api/cron/reschedule-expire/route');
    const res = await GET(buildRequest('test-secret') as any);
    const json = await res.json();

    expect(json.processed).toBe(2);
    expect(json.failed).toBe(0);
    expect(chains.reschedule_proposals.update).toHaveBeenCalledWith({ status: 'expired' });
    expect(chains.booking_logs.insert).toHaveBeenCalledTimes(2);
    expect(mockNotifyProRescheduleOutcome).toHaveBeenCalledTimes(2);
    expect(mockNotifyProRescheduleOutcome).toHaveBeenCalledWith(
      expect.anything(), 'bk1', expect.objectContaining({ outcome: 'expired' })
    );
    expect(mockNotifyAdminOnFailure).toHaveBeenCalledWith('cron/reschedule-expire', expect.objectContaining({ failed: 0 }));
  });

  it("course avec un accept/decline concurrent (UPDATE ne touche aucune ligne) : traité en succès silencieux, pas de log/notif", async () => {
    chains.reschedule_proposals = makeChain([{ id: 'p1', booking_id: 'bk1', proposed_date: '2099-01-11', proposed_time: '11:00:00' }]);
    chains.reschedule_proposals.maybeSingle = vi.fn(async () => ({ data: null, error: null })); // déjà tranchée
    chains.booking_logs = makeChain([]);

    const { GET } = await import('@/app/api/cron/reschedule-expire/route');
    const res = await GET(buildRequest('test-secret') as any);
    const json = await res.json();

    expect(json.processed).toBe(1); // pas une exception, juste un no-op
    expect(chains.booking_logs.insert).not.toHaveBeenCalled();
    expect(mockNotifyProRescheduleOutcome).not.toHaveBeenCalled();
  });
});
