// cron/check-no-shows — audit LOT 3 (26/07) : jusqu'ici, aucune notification
// n'existait sur ce chemin — ni le client ni le pro n'apprenaient qu'un
// no-show venait d'être enregistré, alors que c'est le moment précis où le
// pro perd de l'argent (frais de réservation conservés, prestation non
// facturée). Ce test prouve : email client (ton neutre, non-accusatoire,
// utilise resolveMemberRecipientEmail donc fonctionne aussi pour un invité
// de groupe résiduel) + notification pro (notifyProNoShow), un envoi par
// membre effectivement passé no_show.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const sentEmails: any[] = [];
vi.mock('@/lib/email/send', () => ({
  sendEmail: vi.fn(async (opts: any) => { sentEmails.push(opts); return { sent: true }; }),
}));

const notifyProNoShow = vi.fn(async () => {});
vi.mock('@/lib/pro-notifications', () => ({ notifyProNoShow }));

vi.mock('@/lib/notify-admin', () => ({ notifyAdminOnFailure: vi.fn(async () => {}) }));

function makeChain(data: any) {
  const p: any = Promise.resolve({ data, error: null });
  for (const m of ['select', 'eq', 'neq', 'gte', 'lte', 'update', 'insert']) {
    p[m] = vi.fn(() => p);
  }
  return p;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  sentEmails.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('cron/check-no-shows — notifications', () => {
  it('membre no-show avec email propre (invité de groupe résiduel) → email neutre, non-accusatoire, notifyProNoShow appelé', async () => {
    // "Maintenant" figé à 12:00 Paris (CEST, 10:00 UTC) ; RDV à 11:40 Paris
    // = 20 min avant, au-delà de la grâce de 15 min.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-26T10:00:00.000Z'));

    const booking = {
      id: 'bk1',
      biz_name: 'Salon Test',
      service_name: 'Massage',
      date: '2026-07-26',
      time: '11:40',
      client_email: 'organisateur@example.com',
      client_phone: '+33600000001',
      booking_members: [
        { id: 'm1', name: 'Alice', phone: '+33600000002', email: 'alice@example.com', status: 'paid' },
      ],
    };

    const chains: Record<string, any> = {
      flash_slots: makeChain([]),
      bookings: makeChain([booking]),
      booking_members: makeChain(null),
      booking_logs: makeChain(null),
    };

    vi.doMock('@/lib/supabase/server', () => ({
      createServiceRoleClient: vi.fn(() => ({ from: (t: string) => chains[t] })),
    }));

    const { GET } = await import('@/app/api/cron/check-no-shows/route');
    process.env.CRON_SECRET = 'test-secret';
    const req = new Request('http://localhost/api/cron/check-no-shows', {
      headers: { authorization: 'Bearer test-secret' },
    });
    const res = await GET(req as any);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.noShows).toBe(1);

    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].to).toBe('alice@example.com'); // priorité à member.email, pas client_email
    expect(sentEmails[0].text).toContain('frais de réservation restent acquis');
    expect(sentEmails[0].text.toLowerCase()).not.toMatch(/vous n'êtes pas venu|vous avez manqué|de votre faute/);

    expect(notifyProNoShow).toHaveBeenCalledTimes(1);
    expect(notifyProNoShow).toHaveBeenCalledWith(expect.anything(), 'bk1', { memberName: 'Alice' });

    const memberUpdateCalls = chains['booking_members'].update.mock.calls;
    expect(memberUpdateCalls).toContainEqual([{ status: 'no_show' }]);
  });

  it("RDV dans les 15 dernières minutes (grâce en cours) → pas de no-show, pas d'email", async () => {
    // Même horloge figée ; RDV à 11:55 Paris = 5 min avant, sous la grâce.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-26T10:00:00.000Z'));

    const booking = {
      id: 'bk2',
      biz_name: 'Salon Test',
      service_name: 'Massage',
      date: '2026-07-26',
      time: '11:55',
      client_email: 'organisateur@example.com',
      client_phone: '+33600000001',
      booking_members: [
        { id: 'm2', name: 'Bob', phone: '+33600000001', email: null, status: 'paid' },
      ],
    };

    const chains: Record<string, any> = {
      flash_slots: makeChain([]),
      bookings: makeChain([booking]),
      booking_members: makeChain(null),
      booking_logs: makeChain(null),
    };

    vi.doMock('@/lib/supabase/server', () => ({
      createServiceRoleClient: vi.fn(() => ({ from: (t: string) => chains[t] })),
    }));

    const { GET } = await import('@/app/api/cron/check-no-shows/route');
    process.env.CRON_SECRET = 'test-secret';
    const req = new Request('http://localhost/api/cron/check-no-shows', {
      headers: { authorization: 'Bearer test-secret' },
    });
    const res = await GET(req as any);
    const body = await res.json();

    expect(body.noShows).toBe(0);
    expect(sentEmails).toHaveLength(0);
    expect(notifyProNoShow).not.toHaveBeenCalled();
  });
});
