// src/app/api/bookings/update-member/route.ts — prouve, en plus des
// correctifs de sécurité déjà documentés dans le fichier (whitelist de
// champs, rôle pro/admin requis pour arrived/no_show) :
// 1. status='arrived' → completeBookingIfAllArrived appelé (même helper,
//    même comportement que checkin-by-qr et cloturer-prestation — audit
//    15/08, ce chemin est réel même si aucun parcours front actuel ne
//    l'emprunte pour 'arrived').
// 2. status='no_show' → completeBookingIfAllArrived N'EST PAS appelé
//    (no_show seul n'est pas la raison de compléter — la complétion, elle,
//    tolère un no_show déjà présent parmi d'autres membres arrivés, mais ce
//    n'est pas CETTE mise à jour qui doit re-déclencher le check ici).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCompleteBookingIfAllArrived = vi.fn(async (..._args: any[]) => false);
vi.mock('@/lib/booking-lifecycle', () => ({
  completeBookingIfAllArrived: (...args: any[]) => mockCompleteBookingIfAllArrived(...args),
}));

function makeChain(singleData: any) {
  const chain: any = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.update = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(async () => ({ data: singleData, error: null }));
  chain.single = vi.fn(async () => ({ data: singleData, error: null }));
  return chain;
}

let appUsersChain: any;
let memberChain: any;
const mockGetUser = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
    from: (t: string) => (t === 'app_users' ? appUsersChain : memberChain),
  })),
}));

function buildRequest(body: any) {
  return new Request('http://localhost/api/bookings/update-member', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: 'pro1' } } });
  appUsersChain = makeChain({ role: 'pro' });
  memberChain = makeChain({ status: 'paid', phone: null, name: 'Client', id: 'member-1', booking_id: 'bk1' });
});

describe('POST /api/bookings/update-member', () => {
  it("status='arrived' → completeBookingIfAllArrived appelé avec bookingId", async () => {
    const { POST } = await import('@/app/api/bookings/update-member/route');
    const res = await POST(buildRequest({ bookingId: 'bk1', memberId: 'member-1', updates: { status: 'arrived' } }) as any);
    expect(res.status).toBe(200);
    expect(mockCompleteBookingIfAllArrived).toHaveBeenCalledWith(expect.anything(), 'bk1');
  });

  it("status='no_show' → completeBookingIfAllArrived jamais appelé", async () => {
    const { POST } = await import('@/app/api/bookings/update-member/route');
    const res = await POST(buildRequest({ bookingId: 'bk1', memberId: 'member-1', updates: { status: 'no_show' } }) as any);
    expect(res.status).toBe(200);
    expect(mockCompleteBookingIfAllArrived).not.toHaveBeenCalled();
  });

  it("rôle client tentant status='arrived' → 403, completeBookingIfAllArrived jamais appelé", async () => {
    appUsersChain = makeChain({ role: 'client' });
    const { POST } = await import('@/app/api/bookings/update-member/route');
    const res = await POST(buildRequest({ bookingId: 'bk1', memberId: 'member-1', updates: { status: 'arrived' } }) as any);
    expect(res.status).toBe(403);
    expect(mockCompleteBookingIfAllArrived).not.toHaveBeenCalled();
  });
});
