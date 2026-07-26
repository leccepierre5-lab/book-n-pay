// Audit 26/07 (point b) : périmètre restreint à bookings/cancel,
// freeze-business et refund-gesture (paid_by_member_id / payeur tiers hors
// périmètre, mort avec le flag groupe OFF). bookings/cancel n'indiquait
// jamais le MONTANT remboursé au client (juste "vos frais de réservation
// initié", sans chiffre) — corrigé. freeze-business et refund-gesture
// étaient déjà conformes (montant + délai + vocabulaire "frais de
// réservation", jamais "acompte") ; ces tests figent ce comportement pour
// qu'une future régression ne le fasse pas taire silencieusement.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sentEmails: any[] = [];
vi.mock('@/lib/email/send', () => ({
  sendEmail: vi.fn(async (opts: any) => { sentEmails.push(opts); return { sent: true }; }),
}));

vi.mock('@/lib/stripe/client', () => ({
  getStripeClient: vi.fn(async () => ({ refunds: { create: vi.fn(async () => ({ id: 're_1' })) } })),
}));

vi.mock('@/lib/booking-lifecycle', () => ({
  cancelBookingIfNoActiveMembers: vi.fn(async () => false),
}));

vi.mock('@/lib/pro-notifications', () => ({
  notifyProBookingCancelled: vi.fn(async () => {}),
  notifyProNewBooking: vi.fn(async () => {}),
}));

function makeChain(data: any) {
  const p: any = Promise.resolve({ data, error: null });
  for (const m of ['select', 'eq', 'neq', 'in', 'update', 'insert', 'single', 'maybeSingle']) {
    p[m] = vi.fn((...args: any[]) => {
      if (m === 'single' || m === 'maybeSingle') return Promise.resolve({ data, error: null });
      return p;
    });
  }
  return p;
}

beforeEach(() => {
  sentEmails.length = 0;
  vi.clearAllMocks();
});

describe('bookings/cancel — montant présent dans l\'email de remboursement', () => {
  it('annulation >48h, refund OK → email mentionne le montant exact, jamais "acompte"', async () => {
    const booking = {
      id: 'bk1', date: '2099-01-10', time: '10:00', client_id: 'user-1',
      biz_name: 'Salon Test', service_name: 'Massage',
    };
    const member = { id: 'm1', status: 'paid', phone: '+33600000001', deposit: 18, stripe_payment_intent_id: 'pi_1', name: 'Alice' };

    const chains: Record<string, any> = {
      bookings: makeChain(booking),
      booking_members: makeChain(member),
      app_users: makeChain({ phone: '+33600000001', role: 'client' }),
      booking_logs: makeChain(null),
    };

    vi.doMock('@/lib/supabase/server', () => ({
      createClient: vi.fn(async () => ({
        auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'user-1', email: 'alice@example.com' } } })) },
        from: (t: string) => chains[t],
      })),
      createServiceRoleClient: vi.fn(() => ({ from: (t: string) => chains[t] })),
    }));

    const { POST } = await import('@/app/api/bookings/cancel/route');
    const res = await POST(new Request('http://localhost/api/bookings/cancel', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bookingId: 'bk1', memberId: 'm1' }),
    }) as any);

    expect(res.status).toBe(200);
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].text).toContain('18€');
    expect(sentEmails[0].text).toContain('frais de réservation');
    expect(sentEmails[0].text.toLowerCase()).not.toContain('acompte');
  });
});

describe('admin/freeze-business — montant + délai + ton neutre (déjà conforme, régression gardée)', () => {
  it('gel établissement, membre payé → email mentionne montant, délai bancaire, ne met pas en cause le pro', async () => {
    const business = { id: 'biz1', name: 'Salon Test' };
    const booking = {
      id: 'bk1', client_email: 'client@example.com', service_name: 'Massage', date: '2099-01-10', time: '10:00',
      booking_members: [
        { id: 'm1', name: 'Bob', status: 'paid', email: 'bob@example.com', deposit: 22, stripe_payment_intent_id: 'pi_2' },
      ],
    };

    const bookingsChain: any = Promise.resolve({ data: [booking], error: null });
    bookingsChain.select = vi.fn(() => bookingsChain);
    bookingsChain.eq = vi.fn(() => bookingsChain);
    bookingsChain.neq = vi.fn(() => bookingsChain);
    bookingsChain.gte = vi.fn(() => bookingsChain);
    bookingsChain.update = vi.fn(() => bookingsChain);

    const businessesChain: any = Promise.resolve({ data: business, error: null });
    businessesChain.select = vi.fn(() => businessesChain);
    businessesChain.eq = vi.fn(() => businessesChain);
    businessesChain.update = vi.fn(() => businessesChain);
    businessesChain.single = vi.fn(() => Promise.resolve({ data: business, error: null }));
    businessesChain.maybeSingle = vi.fn(() => Promise.resolve({ data: business, error: null }));

    const genericChain: any = Promise.resolve({ data: null, error: null });
    genericChain.select = vi.fn(() => genericChain);
    genericChain.eq = vi.fn(() => genericChain);
    genericChain.update = vi.fn(() => genericChain);
    genericChain.insert = vi.fn(() => genericChain);
    genericChain.single = vi.fn(() => Promise.resolve({ data: { role: 'admin' }, error: null }));
    genericChain.maybeSingle = vi.fn(() => Promise.resolve({ data: null, error: null }));

    const chains: Record<string, any> = {
      bookings: bookingsChain,
      businesses: businessesChain,
      app_users: genericChain,
      booking_members: genericChain,
      booking_logs: genericChain,
    };

    vi.doMock('@/lib/supabase/server', () => ({
      createClient: vi.fn(async () => ({
        auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'admin-1' } } })) },
        from: (t: string) => chains[t] ?? genericChain,
      })),
      createServiceRoleClient: vi.fn(() => ({ from: (t: string) => chains[t] ?? genericChain })),
    }));

    const { POST } = await import('@/app/api/admin/freeze-business/route');
    const res = await POST(new Request('http://localhost/api/admin/freeze-business', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bizId: 'biz1', action: 'freeze', reason: 'test' }),
    }) as any);

    expect(res.status).toBe(200);
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].text).toContain('22€');
    expect(sentEmails[0].text).toContain('frais de réservation');
    expect(sentEmails[0].text).toContain('5 à 10 jours ouvrés');
    expect(sentEmails[0].text.toLowerCase()).not.toContain('acompte');
    // Ton neutre : pas de mise en cause explicite du professionnel.
    expect(sentEmails[0].text.toLowerCase()).not.toMatch(/faute|responsable|défaillan/);
  });
});

describe('pro/refund-gesture — geste commercial explicite + montant (déjà conforme, régression gardée)', () => {
  it('geste commercial du pro → email mentionne le montant, le motif, jamais "acompte"', async () => {
    const booking = { biz_id: 'biz1', biz_name: 'Salon Test', service_name: 'Massage', date: '2099-01-10', time: '10:00', client_email: 'client@example.com' };
    const member = { id: 'm1', name: 'Carla', status: 'paid', email: null, deposit: 9.5, stripe_payment_intent_id: 'pi_3' };

    const bookingChain: any = Promise.resolve({ data: booking, error: null });
    bookingChain.select = vi.fn(() => bookingChain);
    bookingChain.eq = vi.fn(() => bookingChain);
    bookingChain.maybeSingle = vi.fn(() => Promise.resolve({ data: booking, error: null }));

    const memberChain: any = Promise.resolve({ data: member, error: null });
    memberChain.select = vi.fn(() => memberChain);
    memberChain.eq = vi.fn(() => memberChain);
    memberChain.update = vi.fn(() => memberChain);
    memberChain.maybeSingle = vi.fn(() => Promise.resolve({ data: member, error: null }));

    const profileChain: any = Promise.resolve({ data: { role: 'admin', biz_id: 'biz1' }, error: null });
    profileChain.select = vi.fn(() => profileChain);
    profileChain.eq = vi.fn(() => profileChain);
    profileChain.single = vi.fn(() => Promise.resolve({ data: { role: 'admin', biz_id: 'biz1' }, error: null }));

    const logsChain: any = Promise.resolve({ data: null, error: null });
    logsChain.insert = vi.fn(() => logsChain);

    const chains: Record<string, any> = {
      bookings: bookingChain,
      booking_members: memberChain,
      app_users: profileChain,
      booking_logs: logsChain,
    };

    vi.doMock('@/lib/supabase/server', () => ({
      createClient: vi.fn(async () => ({
        auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'admin-1' } } })) },
        from: (t: string) => chains[t],
      })),
      createServiceRoleClient: vi.fn(() => ({ from: (t: string) => chains[t] })),
    }));

    const { POST } = await import('@/app/api/pro/refund-gesture/route');
    const res = await POST(new Request('http://localhost/api/pro/refund-gesture', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bookingId: 'bk1', memberId: 'm1' }),
    }) as any);

    expect(res.status).toBe(200);
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].text).toContain('9.50€');
    expect(sentEmails[0].text).toContain('geste commercial');
    expect(sentEmails[0].text).toContain('frais de réservation');
    expect(sentEmails[0].text.toLowerCase()).not.toContain('acompte');
  });
});
