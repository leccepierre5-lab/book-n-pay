// Audit sécurité 25/07 : cette route acceptait `bizId` en query param sans
// aucun check applicatif, protection 100% dépendante de la policy RLS
// `owns_biz()` (non versionnée dans ce repo, migration 0038 en pause). Ce
// test prouve que même si l'appelant envoie le bizId d'un AUTRE business,
// la route ignore ce param et n'interroge que le biz_id du profil connecté.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetUser = vi.fn();
const mockMaybeSingle = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: mockMaybeSingle,
        }),
      }),
    }),
  })),
}));

const getProBookingsForMonth = vi.fn(async (_bizId: string, _year: number, _month: number) => [{ id: 'booking-1' }]);
vi.mock('@/lib/queries/pro', () => ({
  getProBookingsForMonth: (...args: [string, number, number]) => getProBookingsForMonth(...args),
}));

describe('GET /api/pro/bookings-month', () => {
  beforeEach(() => {
    mockGetUser.mockReset();
    mockMaybeSingle.mockReset();
    getProBookingsForMonth.mockClear();
  });

  it('non authentifié → 401, jamais interrogé', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const { GET } = await import('@/app/api/pro/bookings-month/route');
    const req = new Request('http://localhost/api/pro/bookings-month?bizId=biz-attaquant&year=2026&month=6');
    const res = await GET(req as any);

    expect(res.status).toBe(401);
    expect(getProBookingsForMonth).not.toHaveBeenCalled();
  });

  it("compte client (pas de biz_id) → 403, jamais interrogé", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mockMaybeSingle.mockResolvedValue({ data: { biz_id: null, role: 'client' } });

    const { GET } = await import('@/app/api/pro/bookings-month/route');
    const req = new Request('http://localhost/api/pro/bookings-month?bizId=biz-attaquant&year=2026&month=6');
    const res = await GET(req as any);

    expect(res.status).toBe(403);
    expect(getProBookingsForMonth).not.toHaveBeenCalled();
  });

  it("pro authentifié qui fournit le bizId d'un AUTRE business → la route utilise son PROPRE biz_id, pas celui de la query", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mockMaybeSingle.mockResolvedValue({ data: { biz_id: 'biz-du-pro-connecte', role: 'pro' } });

    const { GET } = await import('@/app/api/pro/bookings-month/route');
    const req = new Request('http://localhost/api/pro/bookings-month?bizId=biz-attaquant&year=2026&month=6');
    const res = await GET(req as any);

    expect(res.status).toBe(200);
    expect(getProBookingsForMonth).toHaveBeenCalledWith('biz-du-pro-connecte', 2026, 6);
  });
});
