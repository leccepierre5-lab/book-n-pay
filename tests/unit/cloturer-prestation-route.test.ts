// src/app/api/bookings/cloturer-prestation/route.ts — prouve :
// 1. Champs requis manquants → 400.
// 2. Réservation introuvable → 404.
// 3. Pro d'un AUTRE business → 403.
// 4. Cas nominal : membre marqué 'arrived', payment_mode posé,
//    completeBookingIfAllArrived appelé (audit 15/08 — remplace l'ancien
//    déclenchement sur le paiement dans le webhook Stripe).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSendEmail = vi.fn(async (..._args: any[]) => ({ sent: true }));
vi.mock('@/lib/email/send', () => ({
  sendEmail: (...args: any[]) => mockSendEmail(...args),
  escapeHtml: (s: string) => s,
}));

const mockCompleteBookingIfAllArrived = vi.fn(async (..._args: any[]) => false);
vi.mock('@/lib/booking-lifecycle', () => ({
  completeBookingIfAllArrived: (...args: any[]) => mockCompleteBookingIfAllArrived(...args),
}));

function makeChain(singleData: any) {
  const chain: any = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.update = vi.fn(() => chain);
  chain.insert = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(async () => ({ data: singleData, error: null }));
  chain.single = vi.fn(async () => ({ data: singleData, error: null }));
  return chain;
}

let appUsersChain: any;
let chains: Record<string, any> = {};
const mockGetUser = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
    from: (t: string) => (t === 'app_users' ? appUsersChain : chains[t]),
  })),
  createServiceRoleClient: vi.fn(() => ({
    from: (t: string) => chains[t],
  })),
}));

function buildRequest(body: any) {
  return new Request('http://localhost/api/bookings/cloturer-prestation', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

const BOOKING = { id: 'bk1', biz_id: 'biz-1', biz_name: 'Salon Test', service_name: 'Coupe', date: '2026-08-20', time: '14:00:00', client_email: null };
const MEMBER = { id: 'member-1', name: 'Client Test', status: 'paid', phone: null, email: null };
const VALID_BODY = { bookingId: 'bk1', memberId: 'member-1', paymentMode: 'tpe' };

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: 'pro1' } } });
  appUsersChain = makeChain({ role: 'pro', biz_id: 'biz-1' });
  chains = {
    bookings: makeChain(BOOKING),
    booking_members: makeChain(MEMBER),
    booking_logs: makeChain(null),
  };
});

describe('POST /api/bookings/cloturer-prestation', () => {
  it('champs manquants → 400', async () => {
    const { POST } = await import('@/app/api/bookings/cloturer-prestation/route');
    const res = await POST(buildRequest({ bookingId: 'bk1' }) as any);
    expect(res.status).toBe(400);
  });

  it('réservation introuvable → 404', async () => {
    chains.bookings = makeChain(null);
    const { POST } = await import('@/app/api/bookings/cloturer-prestation/route');
    const res = await POST(buildRequest(VALID_BODY) as any);
    expect(res.status).toBe(404);
  });

  it("pro d'un AUTRE business → 403", async () => {
    appUsersChain = makeChain({ role: 'pro', biz_id: 'biz-AUTRE' });
    const { POST } = await import('@/app/api/bookings/cloturer-prestation/route');
    const res = await POST(buildRequest(VALID_BODY) as any);
    expect(res.status).toBe(403);
    expect(mockCompleteBookingIfAllArrived).not.toHaveBeenCalled();
  });

  it("cas nominal : membre marqué 'arrived', payment_mode posé, completeBookingIfAllArrived appelé", async () => {
    const { POST } = await import('@/app/api/bookings/cloturer-prestation/route');
    const res = await POST(buildRequest(VALID_BODY) as any);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(chains.booking_members.update).toHaveBeenCalledWith({ status: 'arrived', payment_mode: 'tpe' });
    expect(mockCompleteBookingIfAllArrived).toHaveBeenCalledWith(expect.anything(), 'bk1');
  });
});
