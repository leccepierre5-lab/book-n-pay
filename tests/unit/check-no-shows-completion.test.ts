// cron/check-no-shows — audit du 15/08 : c'était le 4e chemin réel vers un
// état terminal de membre (avec checkin-by-qr, cloturer-prestation,
// update-member) et le seul qui n'appelait pas encore
// completeBookingIfAllArrived (src/lib/booking-lifecycle.ts). Sans ça, un
// client qui ne se présente pas laissait son booking 'active' pour
// toujours. Prouve : completeBookingIfAllArrived est appelé avec le bon
// booking_id pour chaque booking où un no-show vient d'être enregistré.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn(async () => ({ sent: true })) }));
vi.mock('@/lib/pro-notifications', () => ({ notifyProNoShow: vi.fn(async () => {}) }));
vi.mock('@/lib/notify-admin', () => ({ notifyAdminOnFailure: vi.fn(async () => {}) }));

const mockCompleteBookingIfAllArrived = vi.fn(async (..._args: any[]) => false);
vi.mock('@/lib/booking-lifecycle', () => ({
  completeBookingIfAllArrived: (...args: any[]) => mockCompleteBookingIfAllArrived(...args),
}));

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
});

afterEach(() => {
  vi.useRealTimers();
});

describe('cron/check-no-shows — complétion du booking', () => {
  it("membre marqué no_show → completeBookingIfAllArrived appelé avec le booking_id", async () => {
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
    expect(mockCompleteBookingIfAllArrived).toHaveBeenCalledWith(expect.anything(), 'bk1');
  });

  it("pas de no-show détecté (RDV encore dans la grâce) → completeBookingIfAllArrived jamais appelé", async () => {
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
    await GET(req as any);

    expect(mockCompleteBookingIfAllArrived).not.toHaveBeenCalled();
  });
});
