// src/lib/group/expireGroup.ts — audit 26/07 : avant ce correctif,
// bookings.status passait à 'cancelled' pour TOUT le groupe AVANT même de
// tenter les remboursements Stripe. Un refund en échec n'était que
// console.error'd, sans notifyAdminOnFailure (contrairement au cron jumeau
// cleanup-expired-invites) — et le booking, déjà 'cancelled', sortait pour
// toujours du filtre `.eq('status','active')` utilisé par le cron nocturne
// ET le polling lazy (group/pending-status) : un client débité restait
// indéfiniment non remboursé, sans qu'aucune alerte ne remonte à personne.
//
// Ces tests prouvent : (1) un refund en échec laisse le booking 'active'
// (retentable), trace l'échec dans booking_logs, et déclenche
// notifyAdminOnFailure ; (2) le chemin nominal (refund OK) est inchangé ;
// (3) un membre déjà 'cancelled' mais qui AVAIT payé (retry d'un échec
// précédent) ne fait plus prendre à tort le raccourci "tout le monde a payé,
// juste corriger le statut" — sans quoi le refund en échec ne serait jamais
// retenté (le groupe serait marqué 'completed' au lieu de repasser par la
// tentative de remboursement).
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/email/send', () => ({
  sendEmail: vi.fn(async () => ({ sent: true })),
}));
vi.mock('@/lib/notify-admin', () => ({
  notifyAdminOnFailure: vi.fn(async () => {}),
}));

import { sendEmail } from '@/lib/email/send';
import { notifyAdminOnFailure } from '@/lib/notify-admin';
import { expireGroupByRef } from '@/lib/group/expireGroup';

function makeChain(data: any = null) {
  const p: any = Promise.resolve({ data, error: null });
  p.select = vi.fn(() => p);
  p.eq = vi.fn(() => p);
  p.neq = vi.fn(() => p);
  p.in = vi.fn(() => p);
  p.update = vi.fn(() => p);
  p.insert = vi.fn(() => p);
  return p;
}

function makeSupabase(groupBookingsFixture: any[]) {
  const chains: Record<string, any> = {};
  const getChain = (table: string) => {
    if (!chains[table]) {
      chains[table] = makeChain(table === 'bookings' ? groupBookingsFixture : null);
    }
    return chains[table];
  };
  return { from: vi.fn((table: string) => getChain(table)), _chains: chains } as any;
}

const baseBooking = {
  id: 'bk1',
  status: 'active',
  client_email: null,
  biz_name: 'Salon Test',
  service_name: 'Massage',
  date: '2026-08-01',
  time: '10:00',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('expireGroupByRef — remboursement en échec', () => {
  it("laisse le booking 'active' (pas de cancel), trace booking_logs, alerte admin — jamais l'inverse (statut posé avant le refund)", async () => {
    const groupBookings = [
      {
        ...baseBooking,
        booking_members: [
          { id: 'm1', name: 'Alice', status: 'paid', email: 'alice@example.com', deposit: 12, stripe_payment_intent_id: 'pi_1' },
          { id: 'm2', name: 'Bob', status: 'invite', email: null, deposit: null, stripe_payment_intent_id: null },
        ],
      },
    ];
    const supabase = makeSupabase(groupBookings);
    const stripe: any = { refunds: { create: vi.fn(async () => { throw new Error('stripe down'); }) } };

    const result = await expireGroupByRef('ref-1', supabase, stripe);

    expect(result).toEqual({ expired: true });
    expect(stripe.refunds.create).toHaveBeenCalledTimes(1);

    // Le membre payé n'est PAS marqué cancelled (le refund n'a pas réussi) —
    // seule mise à jour attendue sur booking_members est celle de l'invite (m2).
    const memberUpdateCalls = supabase._chains['booking_members'].update.mock.calls;
    expect(memberUpdateCalls).toEqual([[{ status: 'cancelled' }]]); // m2 uniquement

    // Le booking ne doit JAMAIS être marqué 'cancelled' tant que le refund
    // n'a pas réussi — sinon il sort du filtre .eq('status','active') et
    // n'est plus jamais retenté (c'est exactement le bug corrigé).
    const bookingUpdateCalls = supabase._chains['bookings'].update.mock.calls;
    expect(bookingUpdateCalls.some((c: any[]) => c[0]?.status === 'cancelled')).toBe(false);

    // Trace interrogeable de l'échec.
    expect(supabase._chains['booking_logs'].insert).toHaveBeenCalledTimes(1);
    expect(supabase._chains['booking_logs'].insert.mock.calls[0][0].message).toMatch(/échoué/i);

    // Alerte admin déclenchée (jamais avant ce correctif).
    expect(notifyAdminOnFailure).toHaveBeenCalledTimes(1);

    // Aucun email de remboursement envoyé pour Alice (le refund a échoué).
    // Bob (invite) n'a ni email propre ni client_email sur ce fixture, donc
    // pas d'email "place libérée" non plus ici — 0 envoi au total.
    expect((sendEmail as any).mock.calls).toHaveLength(0);
  });

  it('chemin nominal (refund OK) inchangé : membre remboursé+cancelled, booking cancelled, pas d’alerte admin', async () => {
    const groupBookings = [
      {
        ...baseBooking,
        booking_members: [
          { id: 'm1', name: 'Alice', status: 'paid', email: 'alice@example.com', deposit: 12, stripe_payment_intent_id: 'pi_1' },
          { id: 'm2', name: 'Bob', status: 'invite', email: null, deposit: null, stripe_payment_intent_id: null },
        ],
      },
    ];
    const supabase = makeSupabase(groupBookings);
    const stripe: any = {
      refunds: { create: vi.fn(async () => ({ id: 're_1' })) },
      paymentIntents: { retrieve: vi.fn(async () => ({ latest_charge: { transfer: 'tr_1' } })) },
      transfers: { createReversal: vi.fn(async () => ({ id: 'trr_1' })) },
    };

    const result = await expireGroupByRef('ref-2', supabase, stripe);

    expect(result).toEqual({ expired: true });

    const memberUpdateCalls = supabase._chains['booking_members'].update.mock.calls;
    expect(memberUpdateCalls).toContainEqual([{ status: 'cancelled', montant_rembourse: 12 }]);
    expect(memberUpdateCalls).toContainEqual([{ status: 'cancelled' }]);

    const bookingUpdateCalls = supabase._chains['bookings'].update.mock.calls;
    expect(bookingUpdateCalls.some((c: any[]) => c[0]?.status === 'cancelled')).toBe(true);

    expect(notifyAdminOnFailure).not.toHaveBeenCalled();
    expect(supabase._chains['booking_logs']).toBeUndefined();

    // ⚠️ CORRECTIF (audit 22/08) : le dépôt déjà transféré au pro doit être
    // récupéré — même bug que reverse_transfer (d77eaa1), oublié ici aussi.
    expect(stripe.transfers.createReversal).toHaveBeenCalledWith('tr_1', { amount: 1200 });
  });

  it('CORRECTIF 22/08 — réversal du dépôt échoué : alerte admin + trace booking_logs, mais le remboursement client et l’annulation restent acquis', async () => {
    const groupBookings = [
      {
        ...baseBooking,
        booking_members: [
          { id: 'm1', name: 'Alice', status: 'paid', email: 'alice@example.com', deposit: 12, stripe_payment_intent_id: 'pi_1' },
          // Un membre 'invite' est nécessaire pour que la fonction ne prenne
          // pas le raccourci "tout le monde a payé, rien à expirer" (voir
          // ligne 61 de expireGroup.ts) et exécute réellement les refunds.
          { id: 'm2', name: 'Bob', status: 'invite', email: null, deposit: null, stripe_payment_intent_id: null },
        ],
      },
    ];
    const supabase = makeSupabase(groupBookings);
    const stripe: any = {
      refunds: { create: vi.fn(async () => ({ id: 're_1' })) },
      paymentIntents: { retrieve: vi.fn(async () => ({ latest_charge: { transfer: 'tr_1' } })) },
      transfers: { createReversal: vi.fn(async () => { throw new Error('insufficient balance'); }) },
    };

    const result = await expireGroupByRef('ref-4', supabase, stripe);

    expect(result).toEqual({ expired: true });

    // Le remboursement client et l'annulation ont bien eu lieu malgré
    // l'échec du réversal — best-effort strict, jamais un blocage.
    const memberUpdateCalls = supabase._chains['booking_members'].update.mock.calls;
    expect(memberUpdateCalls).toContainEqual([{ status: 'cancelled', montant_rembourse: 12 }]);
    const bookingUpdateCalls = supabase._chains['bookings'].update.mock.calls;
    expect(bookingUpdateCalls.some((c: any[]) => c[0]?.status === 'cancelled')).toBe(true);

    // Mais l'échec de récupération auprès du pro est bien tracé et alerté.
    expect(notifyAdminOnFailure).toHaveBeenCalledWith(
      'expire-groups:reverse_transfer',
      expect.objectContaining({ failed: 1 }),
      'action'
    );
    expect(supabase._chains['booking_logs'].insert).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringMatching(/Réversal du dépôt.*échoué/i) })
    );
  });

  it("retry après échec précédent : un membre déjà 'cancelled' mais qui avait payé (stripe_payment_intent_id présent) empêche le raccourci 'tout payé → completed' de court-circuiter la nouvelle tentative de remboursement", async () => {
    const groupBookings = [
      {
        ...baseBooking,
        booking_members: [
          // Simule un 2e membre déjà remboursé lors d'un passage précédent.
          { id: 'm0', name: 'Zoé', status: 'cancelled', email: 'zoe@example.com', deposit: 15, stripe_payment_intent_id: 'pi_0' },
          // Ce membre reste bloqué 'paid' suite à un échec de refund précédent.
          { id: 'm1', name: 'Alice', status: 'paid', email: 'alice@example.com', deposit: 12, stripe_payment_intent_id: 'pi_1' },
        ],
      },
    ];
    const supabase = makeSupabase(groupBookings);
    const stripe: any = {
      refunds: { create: vi.fn(async () => ({ id: 're_2' })) },
      paymentIntents: { retrieve: vi.fn(async () => ({ latest_charge: { transfer: 'tr_1' } })) },
      transfers: { createReversal: vi.fn(async () => ({ id: 'trr_1' })) },
    };

    await expireGroupByRef('ref-3', supabase, stripe);

    // Le raccourci "completed" ne doit jamais être pris ici : il n'y aurait
    // alors aucune tentative de remboursement pour Alice.
    const bookingUpdateCalls = supabase._chains['bookings'].update.mock.calls;
    expect(bookingUpdateCalls.some((c: any[]) => c[0]?.status === 'completed')).toBe(false);
    expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
  });
});
