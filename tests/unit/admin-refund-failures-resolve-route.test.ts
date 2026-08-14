// src/app/api/admin/refund-failures/[id]/resolve/route.ts — bouton
// "Résolution manuelle" de /admin/remboursements (migration 0052). Spec
// donnée par Pierre à la reprise du 14/08 (voir mémoire
// project_bnp_refund_failures_reverse_transfer) :
// - rôle non-admin → 403
// - note vide → refus
// - status → 'manual' avec resolved_by et resolved_at posés
import { describe, it, expect, vi, beforeEach } from 'vitest';

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

function buildRequest(body: any) {
  return new Request('http://localhost/api/admin/refund-failures/f1/resolve', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
function buildParams(id = 'f1') {
  return { params: Promise.resolve({ id }) };
}

const OPEN_FAILURE = { id: 'f1', booking_id: 'bk1' };

beforeEach(() => {
  vi.clearAllMocks();
  chains = {};
  chains.refund_failures = makeChain([], OPEN_FAILURE);
  chains.booking_logs = makeChain([]);
  authProfile = { role: 'admin' };
  mockGetUser.mockResolvedValue({ data: { user: { id: 'admin1', email: 'admin@example.com' } } });
});

describe('POST /api/admin/refund-failures/[id]/resolve', () => {
  it('rôle non-admin → 403', async () => {
    authProfile = { role: 'pro' };

    const { POST } = await import('@/app/api/admin/refund-failures/[id]/resolve/route');
    const res = await POST(buildRequest({ note: 'Remboursé par virement manuel' }) as any, buildParams());

    expect(res.status).toBe(403);
    expect(chains.refund_failures.update).not.toHaveBeenCalled();
  });

  it('note vide → refus (400), aucune mise à jour', async () => {
    const { POST } = await import('@/app/api/admin/refund-failures/[id]/resolve/route');
    const res = await POST(buildRequest({ note: '   ' }) as any, buildParams());

    expect(res.status).toBe(400);
    expect(chains.refund_failures.update).not.toHaveBeenCalled();
  });

  it("note absente du body → refus (400)", async () => {
    const { POST } = await import('@/app/api/admin/refund-failures/[id]/resolve/route');
    const res = await POST(buildRequest({}) as any, buildParams());

    expect(res.status).toBe(400);
    expect(chains.refund_failures.update).not.toHaveBeenCalled();
  });

  it("status → 'manual', resolved_by et resolved_at posés, note conservée telle quelle (trim)", async () => {
    const { POST } = await import('@/app/api/admin/refund-failures/[id]/resolve/route');
    const res = await POST(buildRequest({ note: '  Remboursé par virement manuel  ' }) as any, buildParams());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ success: true });

    expect(chains.refund_failures.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'manual',
        resolved_by: 'admin1',
        resolution_note: 'Remboursé par virement manuel',
      })
    );
    const updateCall = chains.refund_failures.update.mock.calls[0][0];
    expect(typeof updateCall.resolved_at).toBe('string');

    expect(chains.booking_logs.insert).toHaveBeenCalledTimes(1);
    expect(chains.booking_logs.insert.mock.calls[0][0].message).toContain('REFUND_FAILURE_RESOLVED_MANUALLY');
  });

  it("ligne déjà traitée (SELECT status='open' ne trouve rien) → 404", async () => {
    chains.refund_failures = makeChain([], null);

    const { POST } = await import('@/app/api/admin/refund-failures/[id]/resolve/route');
    const res = await POST(buildRequest({ note: 'note' }) as any, buildParams());

    expect(res.status).toBe(404);
  });
});
