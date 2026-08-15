// src/app/api/bookings/checkin-by-qr/route.ts — prouve :
// 1. Non pro/admin → 403.
// 2. Pro d'un autre business → 403.
// 3. Membre déjà arrivé → alreadyCheckedIn, pas de ré-écriture.
// 4. Membre pas 'paid' → 400, check-in impossible.
// 5. Cas nominal : membre marqué 'arrived', completeBookingIfAllArrived
//    appelé avec le bon booking_id (audit 15/08 — remplace l'ancien
//    déclenchement sur le paiement dans le webhook Stripe).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCheckRateLimit = vi.fn(async (..._args: any[]) => ({ allowed: true, currentCount: 1 }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: (...args: any[]) => mockCheckRateLimit(...args) }));

const mockCompleteBookingIfAllArrived = vi.fn(async (..._args: any[]) => false);
vi.mock('@/lib/booking-lifecycle', () => ({
  completeBookingIfAllArrived: (...args: any[]) => mockCompleteBookingIfAllArrived(...args),
}));

function makeChain(singleData: any, error: any = null) {
  const chain: any = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.update = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(async () => ({ data: singleData, error }));
  chain.single = vi.fn(async () => ({ data: error ? null : singleData, error }));
  return chain;
}

let appUsersChain: any;
let membersChain: any;
const mockGetUser = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
    from: (t: string) => (t === 'app_users' ? appUsersChain : membersChain),
  })),
}));

function buildRequest(qrCode: string) {
  return new Request('http://localhost/api/bookings/checkin-by-qr', {
    method: 'POST',
    body: JSON.stringify({ qrCode }),
  });
}

const MEMBER_PAID = {
  id: 'member-1',
  booking_id: 'bk1',
  status: 'paid',
  phone: null,
  bookings: { id: 'bk1', biz_id: 'biz-1' },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockCheckRateLimit.mockResolvedValue({ allowed: true, currentCount: 1 });
  mockGetUser.mockResolvedValue({ data: { user: { id: 'pro1' } } });
  appUsersChain = makeChain({ role: 'pro', biz_id: 'biz-1' });
});

describe('POST /api/bookings/checkin-by-qr', () => {
  it('rôle client (non pro/admin) → 403', async () => {
    appUsersChain = makeChain({ role: 'client', biz_id: null });
    const { POST } = await import('@/app/api/bookings/checkin-by-qr/route');
    const res = await POST(buildRequest('123456') as any);
    expect(res.status).toBe(403);
  });

  it("pro d'un AUTRE business → 403, non autorisé", async () => {
    membersChain = makeChain(MEMBER_PAID);
    const { POST } = await import('@/app/api/bookings/checkin-by-qr/route');
    appUsersChain = makeChain({ role: 'pro', biz_id: 'biz-AUTRE' });
    const res = await POST(buildRequest('123456') as any);
    expect(res.status).toBe(403);
    expect(mockCompleteBookingIfAllArrived).not.toHaveBeenCalled();
  });

  it('membre déjà arrivé → alreadyCheckedIn, aucune écriture', async () => {
    membersChain = makeChain({ ...MEMBER_PAID, status: 'arrived' });
    const { POST } = await import('@/app/api/bookings/checkin-by-qr/route');
    const res = await POST(buildRequest('123456') as any);
    const json = await res.json();
    expect(json.alreadyCheckedIn).toBe(true);
    expect(membersChain.update).not.toHaveBeenCalled();
    expect(mockCompleteBookingIfAllArrived).not.toHaveBeenCalled();
  });

  it("membre pas 'paid' (ex. 'invite') → 400, check-in impossible", async () => {
    membersChain = makeChain({ ...MEMBER_PAID, status: 'invite' });
    const { POST } = await import('@/app/api/bookings/checkin-by-qr/route');
    const res = await POST(buildRequest('123456') as any);
    expect(res.status).toBe(400);
    expect(mockCompleteBookingIfAllArrived).not.toHaveBeenCalled();
  });

  it("cas nominal : membre marqué 'arrived', completeBookingIfAllArrived appelé avec booking_id", async () => {
    membersChain = makeChain(MEMBER_PAID);
    const { POST } = await import('@/app/api/bookings/checkin-by-qr/route');
    const res = await POST(buildRequest('123456') as any);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(membersChain.update).toHaveBeenCalledWith({ status: 'arrived' });
    expect(mockCompleteBookingIfAllArrived).toHaveBeenCalledWith(expect.anything(), 'bk1');
  });
});
