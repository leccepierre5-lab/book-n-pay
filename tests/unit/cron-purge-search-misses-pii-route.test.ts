// src/app/api/cron/purge-search-misses-pii/route.ts — dette rétention notée
// le 14/08 (voir [[project_bnp_dette_technique]]), traitée le 16/08. Prouve :
// 1. Bearer secret invalide → 401.
// 2. La requête cible bien les actions 'notify'/'invite' ET le cutoff de
//    rétention — jamais 'none' (journal anonyme, pas de PII, voir
//    search-misses.ts), jamais les lignes récentes.
// 3. Rien à purger → deleted:0, pas d'erreur.
// 4. Échec Supabase → 500, message loggé.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/constant-time', () => ({
  isValidBearerSecret: (authHeader: string | null, secret: string | undefined) =>
    !!authHeader && authHeader === `Bearer ${secret}`,
}));

function makeDeleteChain(data: any[] | null, error: any = null) {
  const chain: any = {};
  chain.delete = vi.fn(() => chain);
  chain.in = vi.fn(() => chain);
  chain.lt = vi.fn(() => chain);
  chain.select = vi.fn(async () => ({ data, error }));
  return chain;
}

let chain: any;
vi.mock('@/lib/supabase/server', () => ({
  createServiceRoleClient: vi.fn(() => ({ from: () => chain })),
}));

import { GET } from '@/app/api/cron/purge-search-misses-pii/route';

function buildRequest(secret?: string) {
  return new Request('http://localhost/api/cron/purge-search-misses-pii', {
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = 'test-secret';
});

describe('GET /api/cron/purge-search-misses-pii', () => {
  it('bearer secret invalide → 401', async () => {
    chain = makeDeleteChain([]);
    const res = await GET(buildRequest('mauvais-secret') as any);
    expect(res.status).toBe(401);
    expect(chain.delete).not.toHaveBeenCalled();
  });

  it("cible action IN ('notify','invite') et un cutoff de rétention — jamais 'none'", async () => {
    chain = makeDeleteChain([{ id: 'sm1' }]);
    await GET(buildRequest('test-secret') as any);

    expect(chain.in).toHaveBeenCalledWith('action', ['notify', 'invite']);
    expect(chain.lt).toHaveBeenCalledWith('created_at', expect.any(String));
    const cutoffArg = chain.lt.mock.calls[0][1];
    expect(new Date(cutoffArg).getTime()).toBeLessThan(Date.now());
  });

  it('rien à purger → deleted:0', async () => {
    chain = makeDeleteChain([]);
    const res = await GET(buildRequest('test-secret') as any);
    const json = await res.json();
    expect(json).toEqual({ deleted: 0 });
  });

  it('cas nominal : N lignes purgées → deleted:N', async () => {
    chain = makeDeleteChain([{ id: 'sm1' }, { id: 'sm2' }, { id: 'sm3' }]);
    const res = await GET(buildRequest('test-secret') as any);
    const json = await res.json();
    expect(json).toEqual({ deleted: 3 });
  });

  it('échec Supabase → 500', async () => {
    chain = makeDeleteChain(null, { message: 'boom' });
    const res = await GET(buildRequest('test-secret') as any);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('boom');
  });
});
