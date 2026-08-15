// src/app/api/bookings/reschedule/accept/route.ts — le client accepte le
// créneau proposé (migration 0055). Le coeur de la décision du 15/08 : le
// créneau n'est jamais bloqué à la proposition, il est re-vérifié ICI sans
// toucher aux fonctions Postgres anti-double-booking. Prouve :
// 1. Rate limit / token manquant / proposition introuvable.
// 2. Idempotence sur un accepted déjà acté ; 409 sur declined/slot_taken/
//    expired (états définitifs, pas de seconde chance).
// 3. Lazy-expire si expires_at dépassée avant même de checker la dispo.
// 4. Réservation modifiée entre-temps (annulée) → 409, rien écrit.
// 5. Créneau plus libre → proposal passe 'slot_taken', booking JAMAIS
//    touchée, notif pro, PAS d'appel à bookings.update.
// 6. Cas nominal solo (staff_id null) et cas nominal avec staff : booking
//    mise à jour (date/time/staff_id/staff_name/ics_sequence+1), proposal
//    'accepted', email client avec .ics.
// 7. Course sur l'UPDATE bookings (status changé entre lecture et écriture)
//    → 409, écriture partielle impossible (clause .eq('status','active')).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCheckRateLimit = vi.fn(async (..._args: any[]) => ({ allowed: true, currentCount: 1 }));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: (...args: any[]) => mockCheckRateLimit(...args),
  getClientIp: () => '1.2.3.4',
}));

const mockSendEmail = vi.fn(async (..._args: any[]) => ({ sent: true }));
vi.mock('@/lib/email/send', () => ({ sendEmail: (...args: any[]) => mockSendEmail(...args) }));

const mockIsProposedSlotStillFree = vi.fn(async (..._args: any[]) => true);
vi.mock('@/lib/reschedule', () => ({
  isProposedSlotStillFree: (...args: any[]) => mockIsProposedSlotStillFree(...args),
}));

const mockNotifyProRescheduleOutcome = vi.fn(async (..._args: any[]) => {});
vi.mock('@/lib/pro-notifications', () => ({
  notifyProRescheduleOutcome: (...args: any[]) => mockNotifyProRescheduleOutcome(...args),
}));

function makeChain(listData: any[], singleData: any = listData[0] ?? null, error: any = null) {
  const chain: any = Promise.resolve({ data: listData, error });
  for (const m of ['select', 'eq', 'update', 'insert']) {
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
  return new Request('http://localhost/api/bookings/reschedule/accept', {
    method: 'POST',
    body: JSON.stringify(token ? { token } : {}),
  });
}

const ACTIVE_BOOKING = {
  id: 'bk1', biz_id: 'biz-1', biz_name: 'Salon Test', service_name: 'Coupe',
  status: 'active', ics_sequence: 0,
  client_email: 'client@example.com', client_name: 'Client Test',
  services: { duration_minutes: 60 },
  businesses: { business_locations: { address: '1 rue Test' } },
};

const PENDING_PROPOSAL = {
  id: 'proposal-1', booking_id: 'bk1', status: 'pending', staff_id: null,
  proposed_date: '2099-01-11', proposed_time: '11:00:00',
  expires_at: '2099-01-01T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockCheckRateLimit.mockResolvedValue({ allowed: true, currentCount: 1 });
  mockIsProposedSlotStillFree.mockResolvedValue(true);
  chains = {};
});

describe('POST /api/bookings/reschedule/accept', () => {
  it('rate limit dépassé → 429', async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false, currentCount: 11 });
    const { POST } = await import('@/app/api/bookings/reschedule/accept/route');
    const res = await POST(buildRequest('tok') as any);
    expect(res.status).toBe(429);
  });

  it('token manquant → 400', async () => {
    const { POST } = await import('@/app/api/bookings/reschedule/accept/route');
    const res = await POST(buildRequest(null) as any);
    expect(res.status).toBe(400);
  });

  it('proposition introuvable → 404', async () => {
    chains.reschedule_proposals = makeChain([], null);
    const { POST } = await import('@/app/api/bookings/reschedule/accept/route');
    const res = await POST(buildRequest('tok-inconnu') as any);
    expect(res.status).toBe(404);
  });

  it('déjà accepted → idempotent 200, aucune écriture supplémentaire', async () => {
    chains.reschedule_proposals = makeChain([], { ...PENDING_PROPOSAL, status: 'accepted' });
    const { POST } = await import('@/app/api/bookings/reschedule/accept/route');
    const res = await POST(buildRequest('tok') as any);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json).toEqual({ success: true, alreadyAccepted: true });
    expect(chains.reschedule_proposals.update).not.toHaveBeenCalled();
  });

  it.each(['declined', 'slot_taken', 'expired'])('statut définitif %s → 409, pas de seconde chance', async (status) => {
    chains.reschedule_proposals = makeChain([], { ...PENDING_PROPOSAL, status });
    const { POST } = await import('@/app/api/bookings/reschedule/accept/route');
    const res = await POST(buildRequest('tok') as any);
    const json = await res.json();
    expect(res.status).toBe(409);
    expect(json.status).toBe(status);
  });

  it('expires_at dépassée : lazy-switch vers expired avant même de checker la dispo', async () => {
    chains.reschedule_proposals = makeChain([], { ...PENDING_PROPOSAL, expires_at: '2020-01-01T00:00:00.000Z' });
    const { POST } = await import('@/app/api/bookings/reschedule/accept/route');
    const res = await POST(buildRequest('tok') as any);
    expect(res.status).toBe(409);
    expect(chains.reschedule_proposals.update).toHaveBeenCalledWith({ status: 'expired' });
    expect(mockIsProposedSlotStillFree).not.toHaveBeenCalled();
  });

  it('réservation introuvable ou déjà annulée entre-temps → 409, rien écrit', async () => {
    chains.reschedule_proposals = makeChain([], PENDING_PROPOSAL);
    chains.bookings = makeChain([], { ...ACTIVE_BOOKING, status: 'cancelled' });
    const { POST } = await import('@/app/api/bookings/reschedule/accept/route');
    const res = await POST(buildRequest('tok') as any);
    expect(res.status).toBe(409);
    expect(mockIsProposedSlotStillFree).not.toHaveBeenCalled();
  });

  it("créneau plus libre : proposal → slot_taken, booking JAMAIS touchée, notif pro, 409", async () => {
    chains.reschedule_proposals = makeChain([], PENDING_PROPOSAL);
    chains.bookings = makeChain([], ACTIVE_BOOKING);
    chains.booking_logs = makeChain([]);
    mockIsProposedSlotStillFree.mockResolvedValueOnce(false);

    const { POST } = await import('@/app/api/bookings/reschedule/accept/route');
    const res = await POST(buildRequest('tok') as any);
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.status).toBe('slot_taken');
    expect(chains.reschedule_proposals.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'slot_taken' })
    );
    expect(chains.bookings.update).not.toHaveBeenCalled();
    expect(mockNotifyProRescheduleOutcome).toHaveBeenCalledWith(
      expect.anything(),
      'bk1',
      expect.objectContaining({ outcome: 'slot_taken' })
    );

    const logMessage = chains.booking_logs.insert.mock.calls[0][0].message;
    expect(logMessage).toContain('RESCHEDULE_SLOT_TAKEN');
  });

  it('cas nominal (solo, staff_id null) : booking mise à jour, ics_sequence+1, email avec .ics, proposal accepted', async () => {
    chains.reschedule_proposals = makeChain([], PENDING_PROPOSAL);
    chains.bookings = makeChain([], ACTIVE_BOOKING, null);
    // 1er .maybeSingle() = lecture initiale (créneau d'origine) ; 2e = après
    // .update(...).eq(...).eq(...).select() → réservation effectivement mise à jour.
    chains.bookings.maybeSingle = vi
      .fn()
      .mockResolvedValueOnce({ data: ACTIVE_BOOKING, error: null })
      .mockResolvedValueOnce({ data: { ...ACTIVE_BOOKING, date: '2099-01-11', time: '11:00:00' }, error: null });
    chains.booking_logs = makeChain([]);

    const { POST } = await import('@/app/api/bookings/reschedule/accept/route');
    const res = await POST(buildRequest('tok') as any);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ success: true, date: '2099-01-11', time: '11:00:00' });

    expect(chains.bookings.update).toHaveBeenCalledWith(
      expect.objectContaining({
        date: '2099-01-11',
        time: '11:00:00',
        staff_id: null,
        staff_name: null,
        ics_sequence: 1,
      })
    );

    expect(chains.reschedule_proposals.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'accepted' })
    );

    const logMessage = chains.booking_logs.insert.mock.calls[0][0].message;
    expect(logMessage).toContain('RESCHEDULE_ACCEPTED');

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    const emailCall = mockSendEmail.mock.calls[0][0];
    expect(emailCall.to).toBe('client@example.com');
    expect(emailCall.attachments?.[0]?.filename).toBe('rdv-reporte.ics');
  });

  it('cas nominal avec praticien : staff_name résolu et posé sur la réservation', async () => {
    chains.reschedule_proposals = makeChain([], { ...PENDING_PROPOSAL, staff_id: 'staff-1' });
    chains.bookings = makeChain([], ACTIVE_BOOKING);
    chains.bookings.maybeSingle = vi
      .fn()
      .mockResolvedValueOnce({ data: ACTIVE_BOOKING, error: null })
      .mockResolvedValueOnce({ data: { ...ACTIVE_BOOKING, date: '2099-01-11', time: '11:00:00' }, error: null });
    chains.booking_logs = makeChain([]);
    chains.staff = makeChain([], { name: 'Alice' });

    const { POST } = await import('@/app/api/bookings/reschedule/accept/route');
    const res = await POST(buildRequest('tok') as any);

    expect(res.status).toBe(200);
    expect(chains.bookings.update).toHaveBeenCalledWith(
      expect.objectContaining({ staff_id: 'staff-1', staff_name: 'Alice' })
    );
    expect(mockIsProposedSlotStillFree).toHaveBeenCalledWith(
      expect.anything(), 'biz-1', '2099-01-11', '11:00:00', 60, 'staff-1'
    );
  });

  it('course sur bookings.update (statut changé entre-temps) → 409, proposal jamais marquée accepted', async () => {
    chains.reschedule_proposals = makeChain([], PENDING_PROPOSAL);
    chains.bookings = makeChain([], ACTIVE_BOOKING);
    // 1er .maybeSingle() = lecture initiale (trouvée, active) ; 2e = après
    // l'UPDATE conditionné sur status='active', qui n'a touché aucune ligne
    // (annulée entre-temps par ailleurs).
    chains.bookings.maybeSingle = vi
      .fn()
      .mockResolvedValueOnce({ data: ACTIVE_BOOKING, error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    chains.booking_logs = makeChain([]);

    const { POST } = await import('@/app/api/bookings/reschedule/accept/route');
    const res = await POST(buildRequest('tok') as any);

    expect(res.status).toBe(409);
    expect(chains.reschedule_proposals.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: 'accepted' })
    );
  });
});
