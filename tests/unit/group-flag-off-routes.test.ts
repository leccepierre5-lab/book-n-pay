// GROUP_BOOKING_ENABLED = false (src/lib/feature-flags.ts) — décision
// produit du 26/07 : V1 = réservation solo uniquement. Ces tests prouvent
// que les 4 routes serveur du flux groupe sont bloquées À LA SOURCE (pas
// seulement en UI) tant que le flag est OFF, sans qu'aucune logique
// applicative (Stripe, Supabase, rollback...) ne s'exécute derrière.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetUser = vi.fn(async () => ({ data: { user: null } }));
const mockFrom = vi.fn(() => {
  throw new Error('supabase.from() ne devrait jamais être appelé — le flag doit couper avant');
});

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: mockGetUser } })),
  createServiceRoleClient: vi.fn(() => ({ from: mockFrom })),
}));

vi.mock('@/lib/stripe/client', () => ({
  getStripeClient: vi.fn(async () => {
    throw new Error('getStripeClient ne devrait jamais être appelé — le flag doit couper avant');
  }),
  getStripeClientWithMode: vi.fn(async () => {
    throw new Error('getStripeClientWithMode ne devrait jamais être appelé — le flag doit couper avant');
  }),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true })),
  getClientIp: vi.fn(() => '127.0.0.1'),
}));

function jsonRequest(url: string, body: Record<string, unknown> = {}) {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFrom.mockClear();
});

describe('Flag OFF — routes serveur du flux groupe', () => {
  // Timeout relevé (défaut vitest 5000ms) : ce test fait le tout premier
  // import dynamique de '@/app/api/bookings/create-group/route' de la
  // suite — sa chaîne de dépendances transitives (Stripe/Supabase, même
  // mockées) peut dépasser 5s sous contention quand les fichiers de test
  // tournent en parallèle (suite complète), alors qu'il reste toujours
  // sous 2s en isolé. Les imports suivants (autres tests de ce fichier,
  // même chaîne de deps) sont mis en cache par le registre de modules et
  // restent rapides — un seul test avait besoin de la marge. 3e occurrence
  // de cette instabilité (11/08), corrigée ici plutôt que reconfirmée.
  it('POST /api/bookings/create-group → 404, aucune écriture tentée', async () => {
    const { POST } = await import('@/app/api/bookings/create-group/route');
    const res = await POST(jsonRequest('http://localhost/api/bookings/create-group', {
      bizId: 'b1', serviceId: 's1', date: '2026-08-01', slots: ['10:00', '10:30'],
    }) as any);
    expect(res.status).toBe(404);
    expect(mockFrom).not.toHaveBeenCalled();
  }, 15000);

  it("POST /api/bookings/group (addMemberAndGetCheckout) → 404, aucune écriture tentée", async () => {
    const { POST } = await import('@/app/api/bookings/group/route');
    const res = await POST(jsonRequest('http://localhost/api/bookings/group', {
      action: 'addMemberAndGetCheckout', bookingId: 'bk1', memberData: { name: 'X', phone: '+33600000000' },
    }) as any);
    expect(res.status).toBe(404);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("POST /api/bookings/group (removeInvite) → 404 aussi, même route bloquée en un seul point", async () => {
    const { POST } = await import('@/app/api/bookings/group/route');
    const res = await POST(jsonRequest('http://localhost/api/bookings/group', {
      action: 'removeInvite', bookingId: 'bk1', memberId: 'm1', token: 'whatever',
    }) as any);
    expect(res.status).toBe(404);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('POST /api/group/pay-for-member → 404, aucune session Stripe créée', async () => {
    const { POST } = await import('@/app/api/group/pay-for-member/route');
    const res = await POST(jsonRequest('http://localhost/api/group/pay-for-member', {
      targetMemberId: 'm1',
    }) as any);
    expect(res.status).toBe(404);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('GET /api/group/pending-status → {pending:false}, jamais interrogé (contrat inchangé pour un poll silencieux)', async () => {
    const { GET } = await import('@/app/api/group/pending-status/route');
    const res = await GET();
    const body = await res.json();
    expect(body).toEqual({ pending: false });
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
