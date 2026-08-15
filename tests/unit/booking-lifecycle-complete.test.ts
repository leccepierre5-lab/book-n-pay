// src/lib/booking-lifecycle.ts::completeBookingIfAllArrived — audit du
// 15/08 : le webhook Stripe marquait bookings.status='completed' dès le
// paiement (status==='paid'), avant que le RDV ait lieu. 'arrived' (posé
// par checkin-by-qr et cloturer-prestation quand le client se présente
// réellement) est le seul signal fiable de "service rendu". Prouve :
// 1. Tous les membres actifs 'arrived' → booking passe 'completed'.
// 2. Un seul membre 'arrived' sur deux → reste 'active' (pas d'update).
// 3. Un membre 'cancelled' n'entre pas dans le calcul (actif = non-cancelled).
// 4. Aucun membre actif → pas d'update (rien à compléter).
// 5. 'no_show' est un état TERMINAL comme 'arrived' — ne bloque jamais la
//    complétion (seul, mélangé à un 'arrived', ou même si personne n'est
//    venu) ; seuls 'paid'/'invite' (encore en attente) bloquent.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { completeBookingIfAllArrived } from '@/lib/booking-lifecycle';

function makeMembersChain(data: any[]) {
  const chain: any = Promise.resolve({ data, error: null });
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.neq = vi.fn(() => chain);
  return chain;
}

function makeBookingsUpdateChain() {
  const chain: any = {};
  chain.update = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.then = (resolve: any) => resolve({ error: null });
  return chain;
}

let membersChain: any;
let bookingsChain: any;
let supabase: any;

beforeEach(() => {
  vi.clearAllMocks();
  bookingsChain = makeBookingsUpdateChain();
  supabase = {
    from: (t: string) => (t === 'booking_members' ? membersChain : bookingsChain),
  };
});

describe('completeBookingIfAllArrived', () => {
  it("tous les membres actifs 'arrived' → booking marqué 'completed'", async () => {
    membersChain = makeMembersChain([{ status: 'arrived' }, { status: 'arrived' }]);
    supabase.from = (t: string) => (t === 'booking_members' ? membersChain : bookingsChain);

    const result = await completeBookingIfAllArrived(supabase, 'bk1');

    expect(result).toBe(true);
    expect(bookingsChain.update).toHaveBeenCalledWith({ status: 'completed' });
    expect(bookingsChain.eq).toHaveBeenCalledWith('id', 'bk1');
    expect(bookingsChain.eq).toHaveBeenCalledWith('status', 'active');
  });

  it("un seul membre 'arrived' sur deux → reste 'active', aucun update", async () => {
    membersChain = makeMembersChain([{ status: 'arrived' }, { status: 'paid' }]);
    supabase.from = (t: string) => (t === 'booking_members' ? membersChain : bookingsChain);

    const result = await completeBookingIfAllArrived(supabase, 'bk1');

    expect(result).toBe(false);
    expect(bookingsChain.update).not.toHaveBeenCalled();
  });

  it("un membre 'cancelled' n'entre pas dans le calcul — le reste 'arrived' suffit", async () => {
    membersChain = makeMembersChain([{ status: 'arrived' }]); // .neq('status','cancelled') a déjà filtré côté requête
    supabase.from = (t: string) => (t === 'booking_members' ? membersChain : bookingsChain);

    const result = await completeBookingIfAllArrived(supabase, 'bk1');

    expect(result).toBe(true);
    expect(bookingsChain.update).toHaveBeenCalledWith({ status: 'completed' });
  });

  it("un membre 'no_show' dans un groupe (l'autre 'arrived') → complété quand même, no_show n'est jamais bloquant", async () => {
    membersChain = makeMembersChain([{ status: 'arrived' }, { status: 'no_show' }]);
    supabase.from = (t: string) => (t === 'booking_members' ? membersChain : bookingsChain);

    const result = await completeBookingIfAllArrived(supabase, 'bk1');

    expect(result).toBe(true);
    expect(bookingsChain.update).toHaveBeenCalledWith({ status: 'completed' });
  });

  it("tous les membres 'no_show' (personne n'est venu) → complété quand même, le RDV est passé", async () => {
    membersChain = makeMembersChain([{ status: 'no_show' }]);
    supabase.from = (t: string) => (t === 'booking_members' ? membersChain : bookingsChain);

    const result = await completeBookingIfAllArrived(supabase, 'bk1');

    expect(result).toBe(true);
    expect(bookingsChain.update).toHaveBeenCalledWith({ status: 'completed' });
  });

  it("un membre 'paid' (encore en attente) à côté d'un 'arrived' → reste 'active'", async () => {
    membersChain = makeMembersChain([{ status: 'arrived' }, { status: 'paid' }]);
    supabase.from = (t: string) => (t === 'booking_members' ? membersChain : bookingsChain);

    const result = await completeBookingIfAllArrived(supabase, 'bk1');

    expect(result).toBe(false);
    expect(bookingsChain.update).not.toHaveBeenCalled();
  });

  it('aucun membre actif → pas de complétion, aucun update', async () => {
    membersChain = makeMembersChain([]);
    supabase.from = (t: string) => (t === 'booking_members' ? membersChain : bookingsChain);

    const result = await completeBookingIfAllArrived(supabase, 'bk1');

    expect(result).toBe(false);
    expect(bookingsChain.update).not.toHaveBeenCalled();
  });
});
