// src/app/api/bookings/reschedule/route.ts — consultation publique d'une
// proposition de report par token (migration 0055). Prouve :
// 1. Token manquant/inconnu → 400/404.
// 2. Pending non expiré : affiché tel quel, aucune écriture.
// 3. Lazy-check : pending + expires_at dépassée → bascule 'expired' à la
//    volée (UPDATE conditionné sur status='pending'), jamais sur un état
//    déjà tranché (accepted/declined/slot_taken).
// 4. Ne renvoie que des champs d'affichage — jamais l'email/téléphone du
//    client (même précaution IDOR que bookings/group).
import { describe, it, expect, vi, beforeEach } from 'vitest';

function makeChain(listData: any[], singleData: any = listData[0] ?? null, error: any = null) {
  const chain: any = Promise.resolve({ data: listData, error });
  for (const m of ['select', 'eq', 'update']) {
    chain[m] = vi.fn((..._args: any[]) => chain);
  }
  chain.maybeSingle = vi.fn(async () => ({ data: singleData, error }));
  return chain;
}

let chains: Record<string, any> = {};
vi.mock('@/lib/supabase/server', () => ({
  createServiceRoleClient: vi.fn(() => ({ from: (t: string) => chains[t] })),
}));

function buildRequest(token: string | null) {
  const url = token ? `http://localhost/api/bookings/reschedule?token=${token}` : 'http://localhost/api/bookings/reschedule';
  return new Request(url);
}

const PENDING_PROPOSAL = {
  id: 'proposal-1', booking_id: 'bk1', status: 'pending',
  original_date: '2099-01-10', original_time: '10:00:00',
  proposed_date: '2099-01-11', proposed_time: '11:00:00',
  reason: null, expires_at: '2099-01-11T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  chains = {};
});

describe('GET /api/bookings/reschedule', () => {
  it('token manquant → 400', async () => {
    const { GET } = await import('@/app/api/bookings/reschedule/route');
    const res = await GET(buildRequest(null) as any);
    expect(res.status).toBe(400);
  });

  it('token inconnu → 404', async () => {
    chains.reschedule_proposals = makeChain([], null);
    const { GET } = await import('@/app/api/bookings/reschedule/route');
    const res = await GET(buildRequest('tok-inconnu') as any);
    expect(res.status).toBe(404);
  });

  it('pending non expiré : affiché tel quel, aucun update', async () => {
    chains.reschedule_proposals = makeChain([], PENDING_PROPOSAL);
    chains.bookings = makeChain([], { biz_name: 'Salon Test', service_name: 'Coupe' });

    const { GET } = await import('@/app/api/bookings/reschedule/route');
    const res = await GET(buildRequest('tok-valide') as any);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({
      status: 'pending',
      bizName: 'Salon Test',
      serviceName: 'Coupe',
      originalDate: '2099-01-10',
      originalTime: '10:00:00',
      proposedDate: '2099-01-11',
      proposedTime: '11:00:00',
      reason: null,
      expiresAt: '2099-01-11T00:00:00.000Z',
    });
    expect(chains.reschedule_proposals.update).not.toHaveBeenCalled();
  });

  it('pending + expires_at dépassée : lazy-switch vers expired, update conditionné sur pending', async () => {
    const expired = { ...PENDING_PROPOSAL, expires_at: '2020-01-01T00:00:00.000Z' };
    chains.reschedule_proposals = makeChain([], expired);
    chains.bookings = makeChain([], { biz_name: 'Salon Test', service_name: 'Coupe' });

    const { GET } = await import('@/app/api/bookings/reschedule/route');
    const res = await GET(buildRequest('tok-expire') as any);
    const json = await res.json();

    expect(json.status).toBe('expired');
    expect(chains.reschedule_proposals.update).toHaveBeenCalledWith({ status: 'expired' });
    expect(chains.reschedule_proposals.eq).toHaveBeenCalledWith('status', 'pending');
  });

  it("statut déjà tranché (accepted) même avec expires_at dépassée : jamais réécrit", async () => {
    const accepted = { ...PENDING_PROPOSAL, status: 'accepted', expires_at: '2020-01-01T00:00:00.000Z' };
    chains.reschedule_proposals = makeChain([], accepted);
    chains.bookings = makeChain([], { biz_name: 'Salon Test', service_name: 'Coupe' });

    const { GET } = await import('@/app/api/bookings/reschedule/route');
    const res = await GET(buildRequest('tok-accepte') as any);
    const json = await res.json();

    expect(json.status).toBe('accepted');
    expect(chains.reschedule_proposals.update).not.toHaveBeenCalled();
  });

  it('ne renvoie jamais email/téléphone client (IDOR)', async () => {
    chains.reschedule_proposals = makeChain([], PENDING_PROPOSAL);
    chains.bookings = makeChain([], {
      biz_name: 'Salon Test', service_name: 'Coupe',
      client_email: 'secret@example.com', client_phone: '0600000000',
    });

    const { GET } = await import('@/app/api/bookings/reschedule/route');
    const res = await GET(buildRequest('tok-valide') as any);
    const json = await res.json();

    expect(JSON.stringify(json)).not.toContain('secret@example.com');
    expect(JSON.stringify(json)).not.toContain('0600000000');
  });
});
