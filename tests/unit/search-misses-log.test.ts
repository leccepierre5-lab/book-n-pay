// src/lib/search-misses.ts — journal silencieux des recherches vides
// (migration 0054, Bloc B 14/08). Point dur : cette ligne ne doit JAMAIS
// porter d'identifiant (pas de session_id, pas d'IP) — voir décision du
// 14/08 dans la migration. Ce test verrouille la forme exacte de l'insert.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockInsert = vi.fn(async (..._args: any[]) => ({ error: null }));
vi.mock('@/lib/supabase/server', () => ({
  createServiceRoleClient: vi.fn(() => ({
    from: (table: string) => {
      if (table !== 'search_misses') throw new Error('unexpected table: ' + table);
      return { insert: (row: any) => mockInsert(row) };
    },
  })),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockInsert.mockResolvedValue({ error: null });
});

describe('logSearchMiss', () => {
  it("insère une ligne action='none' avec exactement query/category/city/action — aucun autre champ", async () => {
    const { logSearchMiss } = await import('@/lib/search-misses');
    await logSearchMiss({ query: 'coiffeur', category: 'coiffure-barber', city: 'Bayonne' });

    expect(mockInsert).toHaveBeenCalledTimes(1);
    const row = mockInsert.mock.calls[0][0];
    expect(row).toEqual({
      query: 'coiffeur',
      category: 'coiffure-barber',
      city: 'Bayonne',
      action: 'none',
    });
    expect(row.user_email).toBeUndefined();
    expect(row.invited_business_name).toBeUndefined();
  });

  it('accepte des valeurs null (recherche sans query/category/city) sans planter', async () => {
    const { logSearchMiss } = await import('@/lib/search-misses');
    await logSearchMiss({ query: null, category: null, city: null });

    expect(mockInsert).toHaveBeenCalledWith({
      query: null,
      category: null,
      city: null,
      action: 'none',
    });
  });

  it('une erreur Supabase est absorbée (non bloquant) — ne rejette jamais', async () => {
    mockInsert.mockRejectedValueOnce(new Error('boom'));
    const { logSearchMiss } = await import('@/lib/search-misses');

    await expect(logSearchMiss({ query: 'x', category: null, city: null })).resolves.toBeUndefined();
  });
});
