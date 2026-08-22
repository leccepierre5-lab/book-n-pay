// Audit 26/07 — même classe que le BLOQUANT #1 (expireGroup.ts) : un refund
// Stripe en échec n'était que console.error'd sur bookings/cancel et
// admin/freeze-business, sans alerte admin. NUANCE par rapport au groupe :
// aucun cron ne repasse sur ces deux flux (annulation client / gel admin
// déjà actés, la place se libère quoi qu'il arrive) — l'alerte admin est
// donc le SEUL filet ici, pas un complément à un retry automatique.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const notifyAdminOnFailure = vi.fn(async (_label: string, _result: any) => {});
vi.mock('@/lib/notify-admin', () => ({ notifyAdminOnFailure }));

vi.mock('@/lib/email/send', () => ({
  sendEmail: vi.fn(async () => ({ sent: true })),
}));

vi.mock('@/lib/booking-lifecycle', () => ({
  cancelBookingIfNoActiveMembers: vi.fn(async () => false),
}));

vi.mock('@/lib/pro-notifications', () => ({
  notifyProBookingCancelled: vi.fn(async () => {}),
}));

function makeChain(data: any) {
  const p: any = Promise.resolve({ data, error: null });
  // 'or' — withRefundClaim() (audit 22/08, migration 0063), voir même
  // commentaire dans reverse-transfer-refunds.test.ts.
  for (const m of ['select', 'eq', 'neq', 'gte', 'in', 'or', 'update', 'insert', 'single', 'maybeSingle']) {
    p[m] = vi.fn((...args: any[]) => {
      if (m === 'single' || m === 'maybeSingle') return Promise.resolve({ data, error: null });
      return p;
    });
  }
  return p;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('bookings/cancel — refund Stripe en échec', () => {
  it('alerte admin déclenchée, membre quand même libéré (pas de filet automatique ici)', async () => {
    const booking = { id: 'bk1', date: '2099-01-10', time: '10:00', client_id: 'user-1', biz_name: 'Salon', service_name: 'Massage' };
    const member = { id: 'm1', status: 'paid', phone: '+33600000001', deposit: 20, stripe_payment_intent_id: 'pi_1', name: 'Alice' };

    const chains: Record<string, any> = {
      bookings: makeChain(booking),
      booking_members: makeChain(member),
      app_users: makeChain({ phone: '+33600000001', role: 'client' }),
      booking_logs: makeChain(null),
    };

    vi.doMock('@/lib/stripe/client', () => ({
      getStripeClient: vi.fn(async () => ({
        refunds: { create: vi.fn(async () => { throw new Error('stripe down'); }) },
      })),
    }));
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
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.refundDone).toBe(false);
    expect(notifyAdminOnFailure).toHaveBeenCalledTimes(1);
    expect(notifyAdminOnFailure.mock.calls[0][0]).toBe('bookings/cancel:refund');
    expect(notifyAdminOnFailure.mock.calls[0][1].failed).toBe(1);
    // Le membre est quand même libéré (update status=cancelled tenté) —
    // vérifié indirectement : la route répond 200, pas une erreur.
  });
});

describe('admin/freeze-business — refunds Stripe en échec, alerte groupée', () => {
  it('1 succès + 1 échec → une seule alerte admin, avec le détail des deux', async () => {
    const business = { id: 'biz1', name: 'Salon Test' };
    const bookingOk = {
      id: 'bk-ok', client_email: 'a@example.com', service_name: 'Massage', date: '2099-01-10', time: '10:00',
      booking_members: [{ id: 'm-ok', name: 'A', status: 'paid', email: 'a@example.com', deposit: 10, stripe_payment_intent_id: 'pi_ok' }],
    };
    const bookingFail = {
      id: 'bk-fail', client_email: 'b@example.com', service_name: 'Massage', date: '2099-01-11', time: '11:00',
      booking_members: [{ id: 'm-fail', name: 'B', status: 'paid', email: 'b@example.com', deposit: 30, stripe_payment_intent_id: 'pi_fail' }],
    };

    const bookingsChain: any = Promise.resolve({ data: [bookingOk, bookingFail], error: null });
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
    // withRefundClaim() (audit 22/08, migration 0063) — .or() avant
    // .select().maybeSingle(). Ce chain sert aussi booking_members : doit
    // résoudre un objet vérité pour que la réclamation du verrou réussisse.
    genericChain.or = vi.fn(() => genericChain);
    genericChain.maybeSingle = vi.fn(() => Promise.resolve({ data: { id: 'claim-ok' }, error: null }));

    const chains: Record<string, any> = {
      bookings: bookingsChain,
      businesses: businessesChain,
      app_users: genericChain,
      booking_members: genericChain,
      booking_logs: genericChain,
    };

    vi.doMock('@/lib/stripe/client', () => ({
      getStripeClient: vi.fn(async () => ({
        refunds: {
          create: vi.fn(async (params: any) => {
            if (params.payment_intent === 'pi_fail') throw new Error('carte refusée');
            return { id: 're_ok' };
          }),
        },
        // Le membre pi_ok passe par reverseConnectedAccountTransfer après son
        // refund réussi (bug critique reverse_transfer) — mocké en succès ici,
        // ce test porte sur l'échec du REFUND lui-même, pas de la réversal.
        paymentIntents: { retrieve: vi.fn(async () => ({ latest_charge: { transfer: 'tr_ok' } })) },
        transfers: { createReversal: vi.fn(async () => ({ id: 'trr_ok' })) },
      })),
    }));
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
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.refundedMembers).toBe(1);
    expect(body.refundFailures).toBe(1);
    expect(notifyAdminOnFailure).toHaveBeenCalledTimes(1);
    expect(notifyAdminOnFailure.mock.calls[0][0]).toBe('admin/freeze-business:refunds');
    expect(notifyAdminOnFailure.mock.calls[0][1].failed).toBe(1);
    expect(notifyAdminOnFailure.mock.calls[0][1].failedDescriptions[0]).toContain('m-fail');
  });
});
