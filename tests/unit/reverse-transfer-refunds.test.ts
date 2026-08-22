// Bug critique corrigé : aucune des 4 routes de remboursement ne récupérait
// le dépôt déjà transféré au pro (transfer_data.destination) — la PLATEFORME
// absorbait seule chaque remboursement (doc Stripe, Connect > Destination
// charges > "Émettre des remboursements"). pro_charges (C15) ne récupérait
// que les frais de gestion, jamais le dépôt.
//
// Ces tests couvrent le niveau ROUTE (les unitaires du helper lui-même sont
// dans refunds.test.ts) :
// 1. bookings/cancel, pro/refund-gesture, admin/freeze-business : la
//    réversal est bien émise, avec le montant EXACT du dépôt (pas la charge
//    totale) — ces 3 routes remboursent un montant PARTIEL (dépôt seul), donc
//    passent par reverseConnectedAccountTransfer (transfer reversal séparée),
//    PAS par le flag reverse_transfer sur le refund (qui sous-récupérerait
//    proportionnellement, voir lib/refunds.ts).
// 2. Échec de la réversal (transfert déjà réversé, montant excédentaire,
//    transfer_id introuvable...) : le client reste remboursé, le créneau
//    libéré, une alerte admin dédiée part — jamais de crash, jamais de
//    blocage (règle absolue du correctif).
// 3. pro/cancel-booking (C15) est testé séparément dans
//    pro-cancel-booking-route.test.ts (reverse_transfer natif suffit,
//    remboursement à 100% de la charge — pas cette route-ci).
//
// Mocks STATIQUES (vi.mock, pas vi.doMock) pour éviter le piège de cache
// module : plusieurs tests d'un même describe réimportent la MÊME route,
// vi.doMock + import() dynamique répété ne réapplique pas le mock sur un
// module déjà évalué dans ce fichier (constaté en pratique) — la convention
// du repo pour ce cas (voir pro-cancel-booking-route.test.ts) est un mock
// figé, reconfiguré via mockResolvedValueOnce/mockRejectedValueOnce par test.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sentEmails: any[] = [];
vi.mock('@/lib/email/send', () => ({
  sendEmail: vi.fn(async (opts: any) => { sentEmails.push(opts); return { sent: true }; }),
}));

vi.mock('@/lib/booking-lifecycle', () => ({
  cancelBookingIfNoActiveMembers: vi.fn(async () => false),
}));

vi.mock('@/lib/pro-notifications', () => ({
  notifyProBookingCancelled: vi.fn(async () => {}),
  notifyProNewBooking: vi.fn(async () => {}),
}));

const notifyAdminOnFailure = vi.fn(async (_label: string, _result: any) => {});
vi.mock('@/lib/notify-admin', () => ({ notifyAdminOnFailure }));

// Migration 0052 — chaque échec de remboursement/réversal des 4 routes doit
// écrire dans refund_failures, pas seulement déclencher l'email admin.
const insertRefundFailure = vi.fn(async (..._args: any[]) => {});
vi.mock('@/lib/refund-failures', () => ({ insertRefundFailure }));

const mockRefundsCreate = vi.fn(async () => ({ id: 're_1' }));
// Type explicite (transfer: string | null) : un pi.latest_charge.transfer
// null est un cas réel testé plus bas (fixture sans compte Connect) — sans
// cette annotation, TS infère `string` depuis le seul usage par défaut
// (template `tr_${id}`) et rejette `mockResolvedValueOnce({ transfer: null })`.
const mockPiRetrieve = vi.fn(async (id: string): Promise<{ latest_charge: { transfer: string | null } }> => ({
  latest_charge: { transfer: `tr_${id}` },
}));
const mockCreateReversal = vi.fn(async () => ({ id: 'trr_1' }));
vi.mock('@/lib/stripe/client', () => ({
  // Référence directe (pas de wrapper (...args) => mock(...args)) : les mocks
  // ci-dessus n'ont pas tous la même arité déclarée (0, 1 param...), un
  // wrapper `(...args: any[]) =>` spreadé dedans échoue le typecheck
  // (TS2556, la signature du mock n'est pas un tuple compatible).
  getStripeClient: vi.fn(async () => ({
    refunds: { create: mockRefundsCreate },
    paymentIntents: { retrieve: mockPiRetrieve },
    transfers: { createReversal: mockCreateReversal },
  })),
}));

function makeChain(data: any) {
  const p: any = Promise.resolve({ data, error: null });
  // 'or' — withRefundClaim() (audit 22/08, migration 0063) fait
  // .update(...).eq(...).or(...).select('id').maybeSingle() avant tout
  // appel Stripe. `data` (le membre, toujours vérité ici) fait réussir la
  // réclamation, donc attempt() (le vrai appel Stripe testé) s'exécute
  // normalement.
  for (const m of ['select', 'eq', 'neq', 'gte', 'in', 'or', 'update', 'insert', 'single', 'maybeSingle']) {
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
  mockRefundsCreate.mockResolvedValue({ id: 're_1' });
  mockPiRetrieve.mockImplementation(async (id: string) => ({ latest_charge: { transfer: `tr_${id}` } }));
  mockCreateReversal.mockResolvedValue({ id: 'trr_1' });
});

describe('bookings/cancel — récupération du dépôt auprès du pro', () => {
  const booking = { id: 'bk1', date: '2099-01-10', time: '10:00', client_id: 'user-1', biz_name: 'Salon', service_name: 'Massage' };
  const member = { id: 'm1', status: 'paid', phone: '+33600000001', deposit: 18, stripe_payment_intent_id: 'pi_1', name: 'Alice' };

  beforeEach(() => {
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
  });

  function postCancel() {
    return import('@/app/api/bookings/cancel/route').then(({ POST }) =>
      POST(new Request('http://localhost/api/bookings/cancel', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bookingId: 'bk1', memberId: 'm1' }),
      }) as any)
    );
  }

  it('refund OK → réversal émise avec le montant EXACT du dépôt (pas la charge totale)', async () => {
    const res = await postCancel();

    expect(res.status).toBe(200);
    // Montant EXACT du dépôt (18€ = 1800 cents), pas la charge totale (dépôt+frais).
    expect(mockCreateReversal).toHaveBeenCalledWith('tr_pi_1', { amount: 1800 }, { idempotencyKey: 'reversal_pi_1' });
    expect(notifyAdminOnFailure).not.toHaveBeenCalled();
  });

  it('réversal échoue (transfert déjà réversé) → client quand même remboursé, alerte admin dédiée, pas de crash', async () => {
    mockCreateReversal.mockRejectedValueOnce(new Error('This transfer has already been fully reversed.'));

    const res = await postCancel();
    const body = await res.json();

    // Le client a bien été remboursé (refund Stripe distinct de la réversal) —
    // règle absolue : un échec de récupération n'empêche jamais le remboursement.
    expect(res.status).toBe(200);
    expect(body.refundDone).toBe(true);
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].text).toContain('Remboursement de vos frais de réservation');

    // Alerte admin DÉDIÉE à la réversal — label distinct de celui du refund,
    // message explicite ("à vérifier manuellement"), pas "solde insuffisant".
    expect(notifyAdminOnFailure).toHaveBeenCalledTimes(1);
    expect(notifyAdminOnFailure.mock.calls[0][0]).toBe('bookings/cancel:reverse_transfer');
    expect(notifyAdminOnFailure.mock.calls[0][1].failedDescriptions[0]).toContain('à vérifier manuellement');
    expect(notifyAdminOnFailure.mock.calls[0][1].failedDescriptions[0]).not.toContain('solde insuffisant');

    expect(insertRefundFailure).toHaveBeenCalledTimes(1);
    expect(insertRefundFailure.mock.calls[0][1]).toMatchObject({ bookingId: 'bk1' });
  });

  it("pas de transfert à l'origine (fixture sans compte Connect) → pas d'alerte, rien à récupérer", async () => {
    mockPiRetrieve.mockResolvedValueOnce({ latest_charge: { transfer: null } });

    const res = await postCancel();

    expect(res.status).toBe(200);
    expect(mockCreateReversal).not.toHaveBeenCalled();
    expect(notifyAdminOnFailure).not.toHaveBeenCalled();
  });

  it('refund lui-même en échec → aucune réversal tentée (rien à récupérer tant que le client n\'est pas remboursé)', async () => {
    mockRefundsCreate.mockRejectedValueOnce(new Error('carte refusée'));

    const res = await postCancel();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.refundDone).toBe(false);
    expect(mockCreateReversal).not.toHaveBeenCalled();
    // Une seule alerte (le refund), pas de seconde alerte réversal.
    expect(notifyAdminOnFailure).toHaveBeenCalledTimes(1);
    expect(notifyAdminOnFailure.mock.calls[0][0]).toBe('bookings/cancel:refund');

    expect(insertRefundFailure).toHaveBeenCalledTimes(1);
    expect(insertRefundFailure.mock.calls[0][1]).toMatchObject({ bookingId: 'bk1', errorMessage: 'carte refusée' });
  });
});

describe('pro/refund-gesture — récupération du dépôt auprès du pro', () => {
  const booking = { biz_id: 'biz1', biz_name: 'Salon Test', service_name: 'Massage', date: '2099-01-10', time: '10:00', client_email: 'client@example.com' };
  const member = { id: 'm1', name: 'Carla', status: 'paid', email: null, deposit: 9.5, stripe_payment_intent_id: 'pi_3' };

  beforeEach(() => {
    const bookingChain: any = Promise.resolve({ data: booking, error: null });
    bookingChain.select = vi.fn(() => bookingChain);
    bookingChain.eq = vi.fn(() => bookingChain);
    bookingChain.maybeSingle = vi.fn(() => Promise.resolve({ data: booking, error: null }));

    const memberChain: any = Promise.resolve({ data: member, error: null });
    memberChain.select = vi.fn(() => memberChain);
    memberChain.eq = vi.fn(() => memberChain);
    memberChain.update = vi.fn(() => memberChain);
    // withRefundClaim() (audit 22/08, migration 0063) — .or() avant
    // .select().maybeSingle(), qui résout déjà `member` (vérité), donc la
    // réclamation réussit et l'appel Stripe testé s'exécute normalement.
    memberChain.or = vi.fn(() => memberChain);
    memberChain.maybeSingle = vi.fn(() => Promise.resolve({ data: member, error: null }));

    const profileChain: any = Promise.resolve({ data: { role: 'admin', biz_id: 'biz1' }, error: null });
    profileChain.select = vi.fn(() => profileChain);
    profileChain.eq = vi.fn(() => profileChain);
    profileChain.single = vi.fn(() => Promise.resolve({ data: { role: 'admin', biz_id: 'biz1' }, error: null }));

    const logsChain: any = Promise.resolve({ data: null, error: null });
    logsChain.insert = vi.fn(() => logsChain);

    const chains: Record<string, any> = {
      bookings: bookingChain, booking_members: memberChain, app_users: profileChain, booking_logs: logsChain,
    };
    vi.doMock('@/lib/supabase/server', () => ({
      createClient: vi.fn(async () => ({
        auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'admin-1' } } })) },
        from: (t: string) => chains[t],
      })),
      createServiceRoleClient: vi.fn(() => ({ from: (t: string) => chains[t] })),
    }));
  });

  function postGesture() {
    return import('@/app/api/pro/refund-gesture/route').then(({ POST }) =>
      POST(new Request('http://localhost/api/pro/refund-gesture', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bookingId: 'bk1', memberId: 'm1' }),
      }) as any)
    );
  }

  it('refund OK → réversal émise avec le montant exact du dépôt', async () => {
    const res = await postGesture();

    expect(res.status).toBe(200);
    // 9,50€ = 950 cents.
    expect(mockCreateReversal).toHaveBeenCalledWith('tr_pi_3', { amount: 950 }, { idempotencyKey: 'reversal_pi_3' });
    expect(notifyAdminOnFailure).not.toHaveBeenCalled();
  });

  it("refund lui-même en échec → try/catch (absent avant ce correctif) capte l'erreur, alerte admin, 502 explicite, pas de crash 500 brut", async () => {
    mockRefundsCreate.mockRejectedValueOnce(new Error('carte refusée'));

    const res = await postGesture();
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.error).toContain('remboursement Stripe a échoué');
    expect(mockCreateReversal).not.toHaveBeenCalled();
    expect(notifyAdminOnFailure).toHaveBeenCalledTimes(1);
    expect(notifyAdminOnFailure.mock.calls[0][0]).toBe('pro/refund-gesture:refund');

    expect(insertRefundFailure).toHaveBeenCalledTimes(1);
    expect(insertRefundFailure.mock.calls[0][1]).toMatchObject({ bookingId: 'bk1', errorMessage: 'carte refusée' });
  });

  it('réversal échoue (montant excédentaire) → client quand même remboursé, alerte admin dédiée', async () => {
    mockCreateReversal.mockRejectedValueOnce(new Error('Refund amount exceeds unreversed transfer amount.'));

    const res = await postGesture();

    expect(res.status).toBe(200);
    expect(sentEmails).toHaveLength(1); // client remboursé, email parti quand même
    expect(notifyAdminOnFailure).toHaveBeenCalledTimes(1);
    expect(notifyAdminOnFailure.mock.calls[0][0]).toBe('pro/refund-gesture:reverse_transfer');

    expect(insertRefundFailure).toHaveBeenCalledTimes(1);
    expect(insertRefundFailure.mock.calls[0][1]).toMatchObject({ bookingId: 'bk1' });
  });
});

describe('admin/freeze-business — récupération du dépôt auprès du pro', () => {
  const business = { id: 'biz1', name: 'Salon Test' };
  const booking = {
    id: 'bk1', client_email: 'client@example.com', service_name: 'Massage', date: '2099-01-10', time: '10:00',
    booking_members: [{ id: 'm1', name: 'Bob', status: 'paid', email: 'bob@example.com', deposit: 22, stripe_payment_intent_id: 'pi_2' }],
  };

  beforeEach(() => {
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
    // withRefundClaim() (audit 22/08, migration 0063) — .or() avant
    // .select().maybeSingle(). Ce chain générique sert aussi booking_members
    // (voir `chains` plus bas) : maybeSingle doit résoudre un objet vérité
    // pour que la réclamation du verrou réussisse (sinon RefundAlreadyClaimedError
    // avant tout appel Stripe, aucune de ces routes ne le teste ici — la
    // concurrence du verrou est couverte à part).
    genericChain.or = vi.fn(() => genericChain);
    genericChain.maybeSingle = vi.fn(() => Promise.resolve({ data: { id: 'm1' }, error: null }));

    const chains: Record<string, any> = {
      bookings: bookingsChain, businesses: businessesChain, app_users: genericChain, booking_members: genericChain, booking_logs: genericChain,
    };
    vi.doMock('@/lib/supabase/server', () => ({
      createClient: vi.fn(async () => ({
        auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'admin-1' } } })) },
        from: (t: string) => chains[t] ?? genericChain,
      })),
      createServiceRoleClient: vi.fn(() => ({ from: (t: string) => chains[t] ?? genericChain })),
    }));
  });

  function postFreeze() {
    return import('@/app/api/admin/freeze-business/route').then(({ POST }) =>
      POST(new Request('http://localhost/api/admin/freeze-business', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bizId: 'biz1', action: 'freeze', reason: 'test' }),
      }) as any)
    );
  }

  it('refund OK → réversal émise avec le montant exact du dépôt', async () => {
    const res = await postFreeze();

    expect(res.status).toBe(200);
    // 22€ = 2200 cents.
    expect(mockCreateReversal).toHaveBeenCalledWith('tr_pi_2', { amount: 2200 }, { idempotencyKey: 'reversal_pi_2' });
    expect(notifyAdminOnFailure).not.toHaveBeenCalled();
  });

  it('réversal échoue → gel + remboursement client déjà faits, alerte groupée (pas de blocage du gel)', async () => {
    mockCreateReversal.mockRejectedValueOnce(new Error('This transfer has already been fully reversed.'));

    const res = await postFreeze();
    const body = await res.json();

    // Le gel et le remboursement client ont quand même eu lieu (refundedCount
    // compte le refund Stripe réussi, indépendant de la réversal).
    expect(res.status).toBe(200);
    expect(body.refundedMembers).toBe(1);

    expect(notifyAdminOnFailure).toHaveBeenCalledTimes(1);
    expect(notifyAdminOnFailure.mock.calls[0][0]).toBe('admin/freeze-business:refunds');
    expect(notifyAdminOnFailure.mock.calls[0][1].failedDescriptions[0]).toContain('récupération du dépôt');
    expect(notifyAdminOnFailure.mock.calls[0][1].failedDescriptions[0]).not.toContain('solde insuffisant');

    expect(insertRefundFailure).toHaveBeenCalledTimes(1);
    expect(insertRefundFailure.mock.calls[0][1]).toMatchObject({ bookingId: 'bk1' });
  });
});
