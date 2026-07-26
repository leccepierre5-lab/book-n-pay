// getProStats (src/lib/queries/pro.ts) — audit 26/07 : le dashboard pro
// affichait un seul "CA ce mois" = somme des `deposit` (frais de réservation
// perçus en ligne par Book'nPay), en l'appelant "CA" — le solde de la
// prestation encaissé sur place par le pro (app/tpe/espèces, via
// cloturer-prestation/route.ts qui pose booking_members.payment_mode)
// n'entrait jamais dans ce chiffre. Un pro comparant son cahier de caisse
// réel au dashboard aurait vu un écart massif et permanent.
//
// Ce test prouve que onlineRevenue et onSiteRevenue sont maintenant calculés
// et séparés correctement, avec les mêmes règles que CaisseEncaissement.tsx
// (solde = prix remisé - dépôt, jamais négatif) — et que seul un membre
// réellement CLÔTURÉ (payment_mode posé) compte dans onSiteRevenue, pas un
// simple check-in QR sans clôture.
import { describe, it, expect, vi, afterEach } from 'vitest';

function buildSupabaseMock(statsRows: any[]) {
  const from = (table: string) => {
    const builder: any = {
      _selectArgs: null as unknown,
      select: (...args: unknown[]) => { builder._selectArgs = args[0]; return builder; },
      eq: () => builder,
      gte: () => builder,
      lte: () => builder,
      neq: () => builder,
      in: () => builder,
      then: (resolve: (v: unknown) => void) => {
        // Distingue la requête stats (bookings + booking_members imbriqués)
        // de la requête "upcomingCount" (bookings, count-only) et de
        // "depositRows" (booking_members) — toutes passent par from(), mais
        // avec des select() différents.
        if (table === 'bookings' && typeof builder._selectArgs === 'string' && builder._selectArgs.includes('booking_members')) {
          resolve({ data: statsRows, error: null });
        } else if (table === 'bookings') {
          resolve({ count: 0, data: null, error: null });
        } else {
          resolve({ data: [], error: null });
        }
      },
    };
    return builder;
  };

  return { from };
}

afterEach(() => {
  vi.resetModules();
});

describe('getProStats — séparation onlineRevenue / onSiteRevenue', () => {
  it('additionne deposit (en ligne) et solde clôturé (sur place) séparément, jamais fusionnés', async () => {
    const statsRows = [
      {
        date: '2026-07-15',
        status: 'active',
        created_at: '2026-07-10T10:00:00Z',
        services: { price: 60 },
        booking_members: [
          // Payé en ligne, pas encore clôturé — compte seulement en ligne.
          { status: 'paid', deposit: 10, payment_mode: null, referral_discount_pct: 0 },
          // Arrivé ET clôturé via TPE — solde = 60 - 15 = 45€ sur place.
          { status: 'arrived', deposit: 15, payment_mode: 'tpe', referral_discount_pct: 0 },
        ],
      },
      {
        date: '2026-07-20',
        status: 'completed',
        created_at: '2026-07-18T09:00:00Z',
        services: { price: 100 },
        booking_members: [
          // Arrivé mais PAS clôturé (payment_mode null) — check-in QR seul,
          // ne doit PAS compter dans onSiteRevenue (argent non confirmé).
          { status: 'arrived', deposit: 12, payment_mode: null, referral_discount_pct: 0 },
        ],
      },
      {
        date: '2026-07-22',
        status: 'completed',
        created_at: '2026-07-21T09:00:00Z',
        services: { price: 50 },
        booking_members: [
          // Clôturé en espèces AVEC réduction parrainage -20% : prix remisé
          // 40€, dépôt 8€ → solde attendu 32€.
          { status: 'arrived', deposit: 8, payment_mode: 'especes', referral_discount_pct: 20 },
        ],
      },
    ];

    const { from } = buildSupabaseMock(statsRows);
    vi.doMock('@/lib/supabase/server', () => ({
      createClient: vi.fn(async () => ({ from })),
    }));

    const { getProStats } = await import('@/lib/queries/pro');
    const stats = await getProStats('biz-1', { open_time: null, close_time: null, open_days: [] });

    // En ligne : 10 (paid) + 15 (arrived/tpe) + 12 (arrived sans clôture) + 8 (arrived/especes) = 45
    expect(stats.onlineRevenue).toBe(45);
    // Sur place : 45 (tpe) + 0 (pas clôturé, exclu) + 32 (especes, remisé -20%) = 77
    expect(stats.onSiteRevenue).toBe(77);
  });
});
