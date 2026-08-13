// getProStats (src/lib/queries/pro.ts) — bornes de "ce mois" (CA affiché au
// pro sur le dashboard). Bug réel trouvé le 24/07/2026 (audit TZ, même
// famille que "aujourd'hui" via toISOString()) : firstOfMonth.setDate(1) /
// getFullYear() / getMonth() / new Date(y, m, d) sont des méthodes LOCALES —
// sur Vercel (runtime UTC), elles calculent les bornes du mois en UTC, pas en
// calendrier Paris. Pendant les ~2h qui suivent minuit Paris le 1er de
// chaque mois (l'UTC est encore sur le mois précédent), le CA "ce mois"
// affichait encore les bornes du mois précédent.
//
// Ce test capture les valeurs gte/lte réellement envoyées à la requête
// bookings, sous une horloge simulée dans cette fenêtre de décalage, et
// vérifie qu'elles correspondent au mois Paris réel (août), pas au mois UTC
// (juillet).
import { describe, it, expect, afterEach, vi } from 'vitest';

interface RecordedChain {
  table: string;
  calls: { method: string; args: unknown[] }[];
}

function buildSupabaseMock() {
  const recorded: RecordedChain[] = [];

  const from = (table: string) => {
    const chain: RecordedChain = { table, calls: [] };
    recorded.push(chain);
    const builder: any = {
      select: (...args: unknown[]) => { chain.calls.push({ method: 'select', args }); return builder; },
      eq: (...args: unknown[]) => { chain.calls.push({ method: 'eq', args }); return builder; },
      gte: (...args: unknown[]) => { chain.calls.push({ method: 'gte', args }); return builder; },
      lte: (...args: unknown[]) => { chain.calls.push({ method: 'lte', args }); return builder; },
      neq: (...args: unknown[]) => { chain.calls.push({ method: 'neq', args }); return builder; },
      in: (...args: unknown[]) => { chain.calls.push({ method: 'in', args }); return builder; },
      order: (...args: unknown[]) => { chain.calls.push({ method: 'order', args }); return builder; },
      limit: (...args: unknown[]) => { chain.calls.push({ method: 'limit', args }); return builder; },
      // Query builders Supabase sont "thenable" — `await query` résout ainsi
      // sans jamais appeler .then() explicitement dans le code testé.
      then: (resolve: (v: unknown) => void) => resolve({ data: [], count: 0, error: null }),
    };
    return builder;
  };

  return { client: { from }, recorded };
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

afterEach(() => {
  vi.useRealTimers();
  vi.resetModules();
});

describe('getProStats — bornes de mois ancrées Paris, pas UTC', () => {
  it('01h00 Paris le 1er août (23h00 UTC le 31 juillet) → bornes = août, pas juillet', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-31T23:00:00.000Z')); // 2026-08-01 01:00 Paris (CEST)

    const { client, recorded } = buildSupabaseMock();
    const { createClient } = await import('@/lib/supabase/server');
    (createClient as any).mockResolvedValue(client);

    const { getProStats } = await import('@/lib/queries/pro');
    await getProStats('biz-1', { open_time: null, close_time: null, open_days: [] });

    const statsQuery = recorded.find((c) => c.table === 'bookings' && c.calls.some((call) => call.method === 'lte'));
    expect(statsQuery).toBeDefined();

    const gteCall = statsQuery!.calls.find((c) => c.method === 'gte');
    const lteCall = statsQuery!.calls.find((c) => c.method === 'lte');

    expect(gteCall!.args).toEqual(['date', '2026-08-01']);
    expect(lteCall!.args).toEqual(['date', '2026-08-31']);
  });

  it('hors fenêtre (milieu de mois) : comportement inchangé', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-15T12:00:00.000Z'));

    const { client, recorded } = buildSupabaseMock();
    const { createClient } = await import('@/lib/supabase/server');
    (createClient as any).mockResolvedValue(client);

    const { getProStats } = await import('@/lib/queries/pro');
    await getProStats('biz-1', { open_time: null, close_time: null, open_days: [] });

    const statsQuery = recorded.find((c) => c.table === 'bookings' && c.calls.some((call) => call.method === 'lte'));
    const gteCall = statsQuery!.calls.find((c) => c.method === 'gte');
    const lteCall = statsQuery!.calls.find((c) => c.method === 'lte');

    expect(gteCall!.args).toEqual(['date', '2026-08-01']);
    expect(lteCall!.args).toEqual(['date', '2026-08-31']);
  });

  it('borne de fin de mois correcte pour un mois de 30 jours (novembre)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-10T12:00:00.000Z'));

    const { client, recorded } = buildSupabaseMock();
    const { createClient } = await import('@/lib/supabase/server');
    (createClient as any).mockResolvedValue(client);

    const { getProStats } = await import('@/lib/queries/pro');
    await getProStats('biz-1', { open_time: null, close_time: null, open_days: [] });

    const statsQuery = recorded.find((c) => c.table === 'bookings' && c.calls.some((call) => call.method === 'lte'));
    const lteCall = statsQuery!.calls.find((c) => c.method === 'lte');
    expect(lteCall!.args).toEqual(['date', '2026-11-30']);
  });
});
