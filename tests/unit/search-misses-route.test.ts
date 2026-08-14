// src/app/api/search-misses/route.ts — les deux actions consenties de
// l'écran zéro résultat /recherche (migration 0054, Bloc B 14/08).
// Le journal silencieux (action='none') ne passe PAS par cette route — voir
// search-misses-log.test.ts pour src/lib/search-misses.ts.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCheckRateLimit = vi.fn(async (..._args: any[]) => ({ allowed: true, currentCount: 1 }));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: (...args: any[]) => mockCheckRateLimit(...args),
  getClientIp: () => '127.0.0.1',
}));

const mockInsert = vi.fn(async (..._args: any[]) => ({ error: null }));
vi.mock('@/lib/supabase/server', () => ({
  createServiceRoleClient: vi.fn(() => ({
    from: (table: string) => {
      if (table !== 'search_misses') throw new Error('unexpected table: ' + table);
      return { insert: (row: any) => mockInsert(row) };
    },
  })),
}));

function buildRequest(body: any) {
  return new Request('http://localhost/api/search-misses', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCheckRateLimit.mockResolvedValue({ allowed: true, currentCount: 1 });
  mockInsert.mockResolvedValue({ error: null });
});

describe('POST /api/search-misses', () => {
  it('rate limit dépassé → 429, aucun insert', async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false, currentCount: 11 });
    const { POST } = await import('@/app/api/search-misses/route');
    const res = await POST(buildRequest({ action: 'notify', email: 'a@b.fr', consent: true }) as any);

    expect(res.status).toBe(429);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('action inconnue → 400', async () => {
    const { POST } = await import('@/app/api/search-misses/route');
    const res = await POST(buildRequest({ action: 'bogus' }) as any);

    expect(res.status).toBe(400);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  describe('action=notify', () => {
    it('email invalide → 400, aucun insert', async () => {
      const { POST } = await import('@/app/api/search-misses/route');
      const res = await POST(buildRequest({ action: 'notify', email: 'pas-un-email', consent: true }) as any);

      expect(res.status).toBe(400);
      expect(mockInsert).not.toHaveBeenCalled();
    });

    it('consentement absent → 400, aucun insert (même avec un email valide)', async () => {
      const { POST } = await import('@/app/api/search-misses/route');
      const res = await POST(buildRequest({ action: 'notify', email: 'a@b.fr', consent: false }) as any);

      expect(res.status).toBe(400);
      expect(mockInsert).not.toHaveBeenCalled();
    });

    it('cas nominal → insert action=notify, email trim+lowercase, contexte propagé', async () => {
      const { POST } = await import('@/app/api/search-misses/route');
      const res = await POST(
        buildRequest({
          action: 'notify',
          email: '  A@B.FR  ',
          consent: true,
          query: 'coiffeur',
          category: 'coiffure-barber',
          city: 'Bayonne',
        }) as any
      );
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json).toEqual({ success: true });
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'notify',
          user_email: 'a@b.fr',
          query: 'coiffeur',
          category: 'coiffure-barber',
          city: 'Bayonne',
        })
      );
      const inserted = mockInsert.mock.calls[0][0];
      expect(inserted.invited_business_name).toBeUndefined();
      expect(inserted.invited_business_contact).toBeUndefined();
    });
  });

  describe('action=invite', () => {
    it('nom du pro manquant → 400, aucun insert', async () => {
      const { POST } = await import('@/app/api/search-misses/route');
      const res = await POST(buildRequest({ action: 'invite', businessContact: 'pro@ex.fr' }) as any);

      expect(res.status).toBe(400);
      expect(mockInsert).not.toHaveBeenCalled();
    });

    it('contact du pro manquant → 400, aucun insert', async () => {
      const { POST } = await import('@/app/api/search-misses/route');
      const res = await POST(buildRequest({ action: 'invite', businessName: 'Salon X' }) as any);

      expect(res.status).toBe(400);
      expect(mockInsert).not.toHaveBeenCalled();
    });

    it('cas nominal → insert action=invite, aucun champ email/consent', async () => {
      const { POST } = await import('@/app/api/search-misses/route');
      const res = await POST(
        buildRequest({
          action: 'invite',
          businessName: '  Salon X  ',
          businessContact: ' pro@ex.fr ',
          city: 'Bayonne',
        }) as any
      );
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json).toEqual({ success: true });
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'invite',
          invited_business_name: 'Salon X',
          invited_business_contact: 'pro@ex.fr',
          city: 'Bayonne',
        })
      );
      const inserted = mockInsert.mock.calls[0][0];
      expect(inserted.user_email).toBeUndefined();
    });
  });
});
