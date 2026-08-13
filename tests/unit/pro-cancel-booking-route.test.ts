// src/app/api/pro/cancel-booking/route.ts — C15, annulation d'un RDV à venir
// par le pro (avec remboursement), audité 26/07 comme le seul mécanisme
// manquant qui touche un cas certain à se produire.
//
// Extension 11/08 : le client est désormais remboursé du TOTAL (frais de
// réservation + frais de gestion, CGU Art. 3) et les frais de gestion sont
// refacturés au pro (pro_charges, migration 0041). Ces tests prouvent :
// 1. Auth/rate-limit/autorisation biz gardent bien la route.
// 2. Idempotence : un membre déjà 'cancelled' ne redéclenche jamais Stripe.
// 3. Un RDV déjà passé est rejeté (refund-gesture couvre ce cas, pas C15).
// 4. Cas nominal (frais de gestion connus) : refund OK du TOTAL → statut
//    'cancelled', montant_rembourse = TOTAL, créneau libéré, ligne
//    pro_charges 'pending' créée, log ANNULATION_PRO étendu (frais_gestion_
//    impute + charge_id), email client (remboursement intégral, une seule
//    ligne), email pro (montant refacturé), pas d'alerte admin.
// 5. Rejeu (contrainte unique booking_id+type) : aucun doublon créé, pas
//    d'alerte admin — idempotence normale.
// 6. Insertion pro_charges en échec pour une autre raison : n'empêche NI
//    l'annulation NI le remboursement, alerte admin + trace booking_logs.
// 7. Échec Stripe : le membre est quand même annulé et le créneau libéré,
//    AUCUNE ligne pro_charges, log porte refund_status=echec, alerte admin
//    (refund), pas de second email pro.
// 8. Frais de gestion non identifiables (session introuvable) : pas de
//    crash, remboursement du dépôt seul, alerte admin, aucune ligne
//    pro_charges, pas d'email pro.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetUser = vi.fn();
let authProfile: any = null;

// (...args: any[]) — sans args typés, TS infère un mock 0-arité et
// `.mock.calls[0][0]` (utilisé plus bas) échoue le typecheck (tuple `[]`
// n'a pas d'index 0), alors que la route réelle appelle bien refunds.create
// avec un objet.
const mockRefundsCreate = vi.fn(async (..._args: any[]) => ({ id: 're_test' }));
const mockSessionsRetrieve = vi.fn(async () => ({ metadata: {} }));
// Rattachement pro_charges à la prochaine facture (pro-charge-billing.ts,
// 13/08) — succès par défaut, sans effet sur ce que ces tests vérifient
// déjà (le remboursement/la charge elle-même), voir tests dédiés dans
// pro-charge-billing.test.ts pour le comportement de cette fonction.
const mockInvoiceItemsCreate = vi.fn(async (..._args: any[]) => ({ id: 'ii_test' }));
vi.mock('@/lib/stripe/client', () => ({
  getStripeClient: vi.fn(async () => ({
    refunds: { create: mockRefundsCreate },
    checkout: { sessions: { retrieve: mockSessionsRetrieve } },
    invoiceItems: { create: mockInvoiceItemsCreate },
  })),
}));

const mockCheckRateLimit = vi.fn(async (..._args: any[]) => ({ allowed: true, currentCount: 1 }));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: (...args: any[]) => mockCheckRateLimit(...args),
}));

const mockSendEmail = vi.fn(async (..._args: any[]) => ({ sent: true }));
vi.mock('@/lib/email/send', () => ({ sendEmail: (...args: any[]) => mockSendEmail(...args) }));

const mockNotifyAdminOnFailure = vi.fn(async (..._args: any[]) => {});
vi.mock('@/lib/notify-admin', () => ({
  notifyAdminOnFailure: (...args: any[]) => mockNotifyAdminOnFailure(...args),
}));

function makeChain(listData: any[], singleData: any = listData[0] ?? null, error: any = null) {
  const chain: any = Promise.resolve({ data: listData, error });
  for (const m of ['select', 'eq', 'neq', 'update', 'insert']) {
    chain[m] = vi.fn((..._args: any[]) => chain);
  }
  chain.maybeSingle = vi.fn(async () => ({ data: singleData, error }));
  chain.single = vi.fn(async () => ({ data: singleData, error }));
  return chain;
}

const mockGetUserById = vi.fn(async (_id?: string) => ({ data: { user: { email: 'owner@example.com' } } }));

let chains: Record<string, any> = {};
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
    from: (t: string) => {
      if (t === 'app_users') {
        return { select: () => ({ eq: () => ({ single: async () => ({ data: authProfile }) }) }) };
      }
      throw new Error('unexpected table on authed client: ' + t);
    },
  })),
  createServiceRoleClient: vi.fn(() => ({
    from: (t: string) => chains[t],
    auth: { admin: { getUserById: (id: string) => mockGetUserById(id) } },
  })),
}));

function buildRequest(body: any) {
  return new Request('http://localhost/api/pro/cancel-booking', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

const FUTURE_BOOKING = {
  biz_id: 'biz-1', biz_name: 'Salon Test', service_name: 'Coupe', date: '2099-01-01', time: '10:00:00',
  client_email: 'client@example.com',
};
const PAST_BOOKING = { ...FUTURE_BOOKING, date: '2020-01-01' };
const PAID_MEMBER = {
  id: 'm1', booking_id: 'bk1', status: 'paid', deposit: 15, email: 'client@example.com', name: 'Client Test',
  stripe_payment_intent_id: 'pi_123',
};
// Variante avec session Checkout identifiable — nécessaire pour que
// managementFeeAmount soit connu (voir stripe_checkout_session_id).
const PAID_MEMBER_WITH_FEE = { ...PAID_MEMBER, stripe_checkout_session_id: 'cs_123' };

beforeEach(() => {
  vi.clearAllMocks();
  mockCheckRateLimit.mockResolvedValue({ allowed: true, currentCount: 1 });
  chains = {};
  // Défaut : customer Stripe connu, le rattachement à la prochaine facture
  // réussit silencieusement — les tests qui veulent vérifier le cas "pas de
  // stripe_customer_id" écrasent ceci explicitement.
  chains.business_settings = makeChain([], { stripe_customer_id: 'cus_test_1' });
  authProfile = { role: 'pro', biz_id: 'biz-1' };
});

describe('POST /api/pro/cancel-booking', () => {
  it('non authentifié → 401, rien interrogé', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const { POST } = await import('@/app/api/pro/cancel-booking/route');
    const res = await POST(buildRequest({ bookingId: 'bk1', memberId: 'm1' }) as any);

    expect(res.status).toBe(401);
    expect(mockRefundsCreate).not.toHaveBeenCalled();
  });

  it('rate limit dépassé → 429, rien interrogé', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'pro1', email: 'pro@example.com' } } });
    mockCheckRateLimit.mockResolvedValue({ allowed: false, currentCount: 21 });

    const { POST } = await import('@/app/api/pro/cancel-booking/route');
    const res = await POST(buildRequest({ bookingId: 'bk1', memberId: 'm1' }) as any);

    expect(res.status).toBe(429);
    expect(mockRefundsCreate).not.toHaveBeenCalled();
  });

  it("pro d'un AUTRE business → 403, jamais atteint le membre/refund", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'pro1', email: 'pro@example.com' } } });
    authProfile = { role: 'pro', biz_id: 'biz-AUTRE' };
    chains.bookings = makeChain([], FUTURE_BOOKING);

    const { POST } = await import('@/app/api/pro/cancel-booking/route');
    const res = await POST(buildRequest({ bookingId: 'bk1', memberId: 'm1' }) as any);

    expect(res.status).toBe(403);
    expect(mockRefundsCreate).not.toHaveBeenCalled();
  });

  it("membre déjà 'cancelled' → idempotent, aucun second appel Stripe", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'pro1', email: 'pro@example.com' } } });
    chains.bookings = makeChain([], FUTURE_BOOKING);
    chains.booking_members = makeChain([], { ...PAID_MEMBER, status: 'cancelled' });

    const { POST } = await import('@/app/api/pro/cancel-booking/route');
    const res = await POST(buildRequest({ bookingId: 'bk1', memberId: 'm1' }) as any);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.alreadyCancelled).toBe(true);
    expect(mockRefundsCreate).not.toHaveBeenCalled();
  });

  it('RDV déjà passé → 400, refund-gesture est le bon outil, pas celui-ci', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'pro1', email: 'pro@example.com' } } });
    chains.bookings = makeChain([], PAST_BOOKING);
    chains.booking_members = makeChain([], PAID_MEMBER);

    const { POST } = await import('@/app/api/pro/cancel-booking/route');
    const res = await POST(buildRequest({ bookingId: 'bk1', memberId: 'm1' }) as any);

    expect(res.status).toBe(400);
    expect(mockRefundsCreate).not.toHaveBeenCalled();
  });

  it('cas nominal (frais de gestion connus) : remboursement TOTAL, charge pro_charges créée, log étendu, emails client+pro, pas d\'alerte admin', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'pro1', email: 'pro@example.com' } } });
    chains.bookings = makeChain([], FUTURE_BOOKING);
    // listData=[] : après annulation, plus aucun membre actif restant →
    // cancelBookingIfNoActiveMembers doit fermer le booking.
    chains.booking_members = makeChain([], PAID_MEMBER_WITH_FEE);
    chains.booking_logs = makeChain([]);
    chains.pro_charges = makeChain([], { id: 'charge-1' });
    chains.businesses = makeChain([], { slug: null, owner_id: 'owner-1' });
    mockSessionsRetrieve.mockResolvedValueOnce({ metadata: { fraisGestion: '1.99' } });
    mockGetUserById.mockResolvedValueOnce({ data: { user: { email: 'proowner@example.com' } } });

    const { POST } = await import('@/app/api/pro/cancel-booking/route');
    const res = await POST(buildRequest({ bookingId: 'bk1', memberId: 'm1' }) as any);
    const json = await res.json();

    expect(res.status).toBe(200);
    // Total = dépôt (15) + frais de gestion (1.99) = 16.99.
    expect(json).toEqual({ success: true, refundDone: true, refundAmount: 16.99 });

    expect(mockRefundsCreate).toHaveBeenCalledWith({
      payment_intent: 'pi_123',
      amount: 1699,
      reason: 'requested_by_customer',
      // reverse_transfer:true — cette route rembourse 100% de la charge
      // (dépôt + frais de gestion), donc le flag natif suffit à récupérer
      // 100% du transfert fait au pro (bug critique reverse_transfer,
      // corrigé). Aucun refund_application_fee : les frais de gestion ne
      // sont jamais transférés au pro dans ce modèle (application_fee_amount
      // reste sur la plateforme), donc rien à en "rendre".
      reverse_transfer: true,
      metadata: { email_sent: 'true', reason: 'pro_cancellation' },
    });
    expect(mockRefundsCreate.mock.calls[0][0]).not.toHaveProperty('refund_application_fee');

    // Statut réutilisé, montant_rembourse = TOTAL.
    const memberUpdateCall = chains.booking_members.update.mock.calls[0][0];
    expect(memberUpdateCall).toEqual({ status: 'cancelled', montant_rembourse: 16.99 });

    // Créneau libéré.
    expect(chains.bookings.update).toHaveBeenCalledWith({ status: 'cancelled' });

    // Charge créée pour le pro, statut 'pending'.
    expect(chains.pro_charges.insert).toHaveBeenCalledWith({
      biz_id: 'biz-1',
      booking_id: 'bk1',
      type: 'management_fee_pro_cancellation',
      amount_cents: 199,
      currency: 'eur',
      status: 'pending',
    });

    // Log étendu (frais_gestion_impute + charge_id).
    const logCalls = chains.booking_logs.insert.mock.calls.map((c: any[]) => c[0].message);
    const mainLog = logCalls.find((m: string) => m.startsWith('ANNULATION_PRO |'));
    expect(mainLog).toBe(
      'ANNULATION_PRO | pro_id=pro1 | pro_email=pro@example.com | montant_rembourse=16.99 | refund_status=ok | frais_gestion_impute=1.99 | charge_id=charge-1'
    );

    // Email client (remboursement intégral) + email pro (montant refacturé).
    expect(mockSendEmail).toHaveBeenCalledTimes(2);
    const clientCall = mockSendEmail.mock.calls.find((c: any[]) => c[0].to === 'client@example.com');
    expect(clientCall![0].text).toContain('Remboursé : 16.99€ (intégral — frais de réservation + frais de gestion)');
    expect(clientCall![0].text).not.toContain('Conservé');

    const proCall = mockSendEmail.mock.calls.find((c: any[]) => c[0].to === 'proowner@example.com');
    expect(proCall![0].text).toContain(
      "Votre client a été intégralement remboursé. Les frais de gestion de cette réservation (1,99 €) vous seront refacturés sur une prochaine facture."
    );

    expect(mockNotifyAdminOnFailure).not.toHaveBeenCalled();
  });

  it('rejeu (contrainte unique booking_id+type) : aucun doublon, pas d\'alerte admin', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'pro1', email: 'pro@example.com' } } });
    chains.bookings = makeChain([], FUTURE_BOOKING);
    chains.booking_members = makeChain([], PAID_MEMBER_WITH_FEE);
    chains.booking_logs = makeChain([]);
    chains.pro_charges = makeChain([], null, { code: '23505', message: 'duplicate key value violates unique constraint "uq_pro_charges_booking_type"' });
    chains.businesses = makeChain([], { slug: null, owner_id: null });
    mockSessionsRetrieve.mockResolvedValueOnce({ metadata: { fraisGestion: '1.99' } });

    const { POST } = await import('@/app/api/pro/cancel-booking/route');
    const res = await POST(buildRequest({ bookingId: 'bk1', memberId: 'm1' }) as any);

    expect(res.status).toBe(200);
    expect(mockNotifyAdminOnFailure).not.toHaveBeenCalled();

    const logMessage = chains.booking_logs.insert.mock.calls
      .map((c: any[]) => c[0].message)
      .find((m: string) => m.startsWith('ANNULATION_PRO |'));
    // charge_id=none : pas de nouvelle ligne créée sur ce rejeu.
    expect(logMessage).toContain('charge_id=none');
  });

  it('insertion pro_charges en échec (autre raison) : annulation et remboursement quand même effectués, alerte admin + trace booking_logs', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'pro1', email: 'pro@example.com' } } });
    chains.bookings = makeChain([], FUTURE_BOOKING);
    chains.booking_members = makeChain([], PAID_MEMBER_WITH_FEE);
    chains.booking_logs = makeChain([]);
    chains.pro_charges = makeChain([], null, { code: '23503', message: 'foreign key violation' });
    chains.businesses = makeChain([], { slug: null, owner_id: null });
    mockSessionsRetrieve.mockResolvedValueOnce({ metadata: { fraisGestion: '1.99' } });

    const { POST } = await import('@/app/api/pro/cancel-booking/route');
    const res = await POST(buildRequest({ bookingId: 'bk1', memberId: 'm1' }) as any);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.refundDone).toBe(true);
    expect(json.refundAmount).toBe(16.99);

    expect(mockNotifyAdminOnFailure).toHaveBeenCalledTimes(1);
    expect(mockNotifyAdminOnFailure.mock.calls[0][0]).toBe('pro/cancel-booking:pro_charge');

    const chargeFailLog = chains.booking_logs.insert.mock.calls
      .map((c: any[]) => c[0].message)
      .find((m: string) => m.startsWith('ANNULATION_PRO_CHARGE_ECHEC'));
    expect(chargeFailLog).toContain('booking_id=bk1');
    expect(chargeFailLog).toContain('montant=1.99');
  });

  it('email : remboursement intégral, une seule ligne (plus de "conservé")', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'pro1', email: 'pro@example.com' } } });
    chains.bookings = makeChain([], FUTURE_BOOKING);
    chains.booking_members = makeChain([], PAID_MEMBER_WITH_FEE);
    chains.booking_logs = makeChain([]);
    chains.pro_charges = makeChain([], { id: 'charge-1' });
    chains.businesses = makeChain([], { slug: 'salon-test', owner_id: null });
    mockSessionsRetrieve.mockResolvedValueOnce({ metadata: { fraisGestion: '1.99' } });

    const { POST } = await import('@/app/api/pro/cancel-booking/route');
    await POST(buildRequest({ bookingId: 'bk1', memberId: 'm1' }) as any);

    const emailText = mockSendEmail.mock.calls[0][0].text as string;
    expect(emailText).toContain('Remboursé : 16.99€ (intégral — frais de réservation + frais de gestion)');
    expect(emailText).toContain('https://book-n-pay-next.vercel.app/etablissement/salon-test');
  });

  it('frais de gestion non identifiables (session introuvable) : pas de crash, remboursement du dépôt seul, alerte admin, aucune charge, pas d\'email pro', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'pro1', email: 'pro@example.com' } } });
    chains.bookings = makeChain([], FUTURE_BOOKING);
    chains.booking_members = makeChain([], PAID_MEMBER_WITH_FEE);
    chains.booking_logs = makeChain([]);
    chains.pro_charges = makeChain([]);
    chains.businesses = makeChain([], { slug: null, owner_id: 'owner-1' });
    mockSessionsRetrieve.mockRejectedValueOnce(new Error('session introuvable'));

    const { POST } = await import('@/app/api/pro/cancel-booking/route');
    const res = await POST(buildRequest({ bookingId: 'bk1', memberId: 'm1' }) as any);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.refundDone).toBe(true);
    // Dépôt seul : montant total inconnu, jamais inventé.
    expect(json.refundAmount).toBe(15);

    expect(chains.pro_charges.insert).not.toHaveBeenCalled();
    expect(mockNotifyAdminOnFailure).toHaveBeenCalledTimes(1);
    expect(mockNotifyAdminOnFailure.mock.calls[0][0]).toBe('pro/cancel-booking:pro_charge');

    const unknownFeeLog = chains.booking_logs.insert.mock.calls
      .map((c: any[]) => c[0].message)
      .find((m: string) => m.startsWith('ANNULATION_PRO_FRAIS_GESTION_INCONNU'));
    expect(unknownFeeLog).toContain('booking_id=bk1');

    // Un seul email (client) — pas d'email pro sans montant à annoncer.
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockSendEmail.mock.calls[0][0].to).toBe('client@example.com');
  });

  it('bug critique reverse_transfer : pas de double récupération avec pro_charges (montants disjoints)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'pro1', email: 'pro@example.com' } } });
    chains.bookings = makeChain([], FUTURE_BOOKING);
    chains.booking_members = makeChain([], PAID_MEMBER_WITH_FEE);
    chains.booking_logs = makeChain([]);
    chains.pro_charges = makeChain([], { id: 'charge-1' });
    chains.businesses = makeChain([], { slug: null, owner_id: 'owner-1' });
    mockSessionsRetrieve.mockResolvedValueOnce({ metadata: { fraisGestion: '1.99' } });

    const { POST } = await import('@/app/api/pro/cancel-booking/route');
    await POST(buildRequest({ bookingId: 'bk1', memberId: 'm1' }) as any);

    // reverse_transfer récupère le DÉPÔT auprès du pro (transfert Stripe,
    // transfer_data.destination) — pro_charges facture séparément les FRAIS
    // DE GESTION (jamais transférés au pro dans ce modèle). Un seul appel
    // refunds.create (le flag suffit, pas d'appel séparé à
    // reverseConnectedAccountTransfer/transfers.createReversal pour cette
    // route) et une seule ligne pro_charges, avec le montant frais de
    // gestion SEUL (1.99€=199 cents) — jamais le dépôt (15€) ni le total.
    expect(mockRefundsCreate).toHaveBeenCalledTimes(1);
    expect(chains.pro_charges.insert).toHaveBeenCalledTimes(1);
    expect(chains.pro_charges.insert).toHaveBeenCalledWith(
      expect.objectContaining({ amount_cents: 199 })
    );
  });

  it('échec Stripe : le membre est quand même annulé et le créneau libéré, aucune charge pro_charges, log refund_status=echec, alerte admin (refund)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'pro1', email: 'pro@example.com' } } });
    chains.bookings = makeChain([], FUTURE_BOOKING);
    chains.booking_members = makeChain([], PAID_MEMBER_WITH_FEE);
    chains.booking_logs = makeChain([]);
    chains.pro_charges = makeChain([]);
    chains.businesses = makeChain([], { slug: null, owner_id: 'owner-1' });
    mockSessionsRetrieve.mockResolvedValueOnce({ metadata: { fraisGestion: '1.99' } });
    mockRefundsCreate.mockRejectedValueOnce(new Error('solde Connect insuffisant'));

    const { POST } = await import('@/app/api/pro/cancel-booking/route');
    const res = await POST(buildRequest({ bookingId: 'bk1', memberId: 'm1' }) as any);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.refundDone).toBe(false);

    const memberUpdateCall = chains.booking_members.update.mock.calls[0][0];
    expect(memberUpdateCall).toEqual({ status: 'cancelled', montant_rembourse: null });
    expect(chains.bookings.update).toHaveBeenCalledWith({ status: 'cancelled' });

    expect(chains.pro_charges.insert).not.toHaveBeenCalled();

    const logMessage = chains.booking_logs.insert.mock.calls
      .map((c: any[]) => c[0].message)
      .find((m: string) => m.startsWith('ANNULATION_PRO |'));
    expect(logMessage).toBe(
      'ANNULATION_PRO | pro_id=pro1 | pro_email=pro@example.com | montant_rembourse=0.00 | refund_status=echec | frais_gestion_impute=0.00 | charge_id=none'
    );

    // Une seule alerte admin (refund) — pas de seconde alerte "pro_charge"
    // puisque le montant n'a jamais été facturé (rien à réclamer).
    expect(mockNotifyAdminOnFailure).toHaveBeenCalledTimes(1);
    expect(mockNotifyAdminOnFailure.mock.calls[0][0]).toBe('pro/cancel-booking:refund');

    // Pas d'email pro (refundDone=false).
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockSendEmail.mock.calls[0][0].to).toBe('client@example.com');
  });
});
