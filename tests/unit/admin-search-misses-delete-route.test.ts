// src/app/api/admin/search-misses/[id]/route.ts — suppression manuelle
// (migration 0054, Bloc B 14/08). Décision Pierre : pas de purge
// automatique des emails "notify", mais un bouton de suppression manuelle
// oui — restreint aux lignes action='notify', jamais le journal silencieux
// ni les invitations.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetUser = vi.fn();
let authProfile: any = null;

function makeChain(singleData: any) {
  const chain: any = {};
  for (const m of ['select', 'eq', 'delete']) {
    chain[m] = vi.fn((..._args: any[]) => chain);
  }
  chain.maybeSingle = vi.fn(async () => ({ data: singleData, error: null }));
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
  return new Request('http://localhost/api/admin/search-misses/m1', { method: 'DELETE' });
}
function buildParams(id = 'm1') {
  return { params: Promise.resolve({ id }) };
}

const NOTIFY_ROW = { id: 'm1', action: 'notify' };

beforeEach(() => {
  vi.clearAllMocks();
  chains = { search_misses: makeChain(NOTIFY_ROW) };
  authProfile = { role: 'admin' };
  mockGetUser.mockResolvedValue({ data: { user: { id: 'admin1' } } });
});

describe('DELETE /api/admin/search-misses/[id]', () => {
  it('non authentifié → 401', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const { DELETE } = await import('@/app/api/admin/search-misses/[id]/route');
    const res = await DELETE(buildRequest() as any, buildParams());

    expect(res.status).toBe(401);
    expect(chains.search_misses.delete).not.toHaveBeenCalled();
  });

  it('rôle non-admin → 403', async () => {
    authProfile = { role: 'client' };
    const { DELETE } = await import('@/app/api/admin/search-misses/[id]/route');
    const res = await DELETE(buildRequest() as any, buildParams());

    expect(res.status).toBe(403);
    expect(chains.search_misses.delete).not.toHaveBeenCalled();
  });

  it('ligne inexistante → 404', async () => {
    chains.search_misses = makeChain(null);
    const { DELETE } = await import('@/app/api/admin/search-misses/[id]/route');
    const res = await DELETE(buildRequest() as any, buildParams());

    expect(res.status).toBe(404);
    expect(chains.search_misses.delete).not.toHaveBeenCalled();
  });

  it("action='invite' → 404, refuse de supprimer une invitation via cette route", async () => {
    chains.search_misses = makeChain({ id: 'm1', action: 'invite' });
    const { DELETE } = await import('@/app/api/admin/search-misses/[id]/route');
    const res = await DELETE(buildRequest() as any, buildParams());

    expect(res.status).toBe(404);
    expect(chains.search_misses.delete).not.toHaveBeenCalled();
  });

  it("action='none' (journal silencieux) → 404, jamais supprimable via cette route", async () => {
    chains.search_misses = makeChain({ id: 'm1', action: 'none' });
    const { DELETE } = await import('@/app/api/admin/search-misses/[id]/route');
    const res = await DELETE(buildRequest() as any, buildParams());

    expect(res.status).toBe(404);
    expect(chains.search_misses.delete).not.toHaveBeenCalled();
  });

  it("action='notify' → suppression effective", async () => {
    const { DELETE } = await import('@/app/api/admin/search-misses/[id]/route');
    const res = await DELETE(buildRequest() as any, buildParams());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ success: true });
    expect(chains.search_misses.delete).toHaveBeenCalledTimes(1);
  });
});
