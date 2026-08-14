// src/app/api/admin/search-misses/[id]/informed/route.ts — case "informé
// (article 14)" de /admin/recherches-vides (migration 0054, Bloc B 14/08).
// Spec Pierre (reprise du 14/08) : preuve écrite, pas un processus non
// écrit — la case doit exister et être restreinte aux lignes action='invite'.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetUser = vi.fn();
let authProfile: any = null;

function makeChain(singleData: any) {
  const chain: any = {};
  for (const m of ['select', 'eq', 'update']) {
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

function buildRequest(body: any) {
  return new Request('http://localhost/api/admin/search-misses/m1/informed', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
function buildParams(id = 'm1') {
  return { params: Promise.resolve({ id }) };
}

const INVITE_ROW = { id: 'm1', action: 'invite' };

beforeEach(() => {
  vi.clearAllMocks();
  chains = { search_misses: makeChain(INVITE_ROW) };
  authProfile = { role: 'admin' };
  mockGetUser.mockResolvedValue({ data: { user: { id: 'admin1' } } });
});

describe('POST /api/admin/search-misses/[id]/informed', () => {
  it('non authentifié → 401', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const { POST } = await import('@/app/api/admin/search-misses/[id]/informed/route');
    const res = await POST(buildRequest({ informed: true }) as any, buildParams());

    expect(res.status).toBe(401);
    expect(chains.search_misses.update).not.toHaveBeenCalled();
  });

  it('rôle non-admin → 403', async () => {
    authProfile = { role: 'pro' };
    const { POST } = await import('@/app/api/admin/search-misses/[id]/informed/route');
    const res = await POST(buildRequest({ informed: true }) as any, buildParams());

    expect(res.status).toBe(403);
    expect(chains.search_misses.update).not.toHaveBeenCalled();
  });

  it('paramètre informed absent/non booléen → 400', async () => {
    const { POST } = await import('@/app/api/admin/search-misses/[id]/informed/route');
    const res = await POST(buildRequest({}) as any, buildParams());

    expect(res.status).toBe(400);
    expect(chains.search_misses.update).not.toHaveBeenCalled();
  });

  it("ligne inexistante ou action != 'invite' → 404, aucune update", async () => {
    chains.search_misses = makeChain(null);
    const { POST } = await import('@/app/api/admin/search-misses/[id]/informed/route');
    const res = await POST(buildRequest({ informed: true }) as any, buildParams());

    expect(res.status).toBe(404);
    expect(chains.search_misses.update).not.toHaveBeenCalled();
  });

  it("action='notify' (pas une invitation) → 404", async () => {
    chains.search_misses = makeChain({ id: 'm1', action: 'notify' });
    const { POST } = await import('@/app/api/admin/search-misses/[id]/informed/route');
    const res = await POST(buildRequest({ informed: true }) as any, buildParams());

    expect(res.status).toBe(404);
  });

  it('informed=true → informed_at posé à maintenant (ISO string)', async () => {
    const { POST } = await import('@/app/api/admin/search-misses/[id]/informed/route');
    const res = await POST(buildRequest({ informed: true }) as any, buildParams());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(typeof json.informed_at).toBe('string');
    expect(chains.search_misses.update).toHaveBeenCalledWith({ informed_at: json.informed_at });
  });

  it('informed=false → informed_at remis à null (correction possible)', async () => {
    const { POST } = await import('@/app/api/admin/search-misses/[id]/informed/route');
    const res = await POST(buildRequest({ informed: false }) as any, buildParams());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.informed_at).toBeNull();
    expect(chains.search_misses.update).toHaveBeenCalledWith({ informed_at: null });
  });
});
