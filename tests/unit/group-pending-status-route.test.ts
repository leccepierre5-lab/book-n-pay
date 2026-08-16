// src/app/api/group/pending-status/route.ts — AUCUN test avant ce chantier
// (Lot 2, 16/08) alors que c'est l'un des deux contextes d'appel réels
// d'expireGroupByRef (l'autre étant le cron nocturne, déjà couvert par
// expire-groups-route.test.ts). Contexte hybride documenté dans
// [[project_bnp_dette_technique]] : cron = balayage périodique de TOUS les
// groupes expirés ; ce polling lazy = déclenché par la présence de l'UTILISATEUR
// courant sur le site, ne traite QUE les groupes où il a lui-même un membre.
// expireGroupByRef lui-même est mocké ici (déjà testé en profondeur ailleurs,
// voir expire-group-refund-failure.test.ts) — ce fichier teste uniquement la
// logique propre à CETTE route : filtrage pending/expired, déclenchement
// lazy, comptage payé/total, tri par deadline le plus proche.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/feature-flags', () => ({ GROUP_BOOKING_ENABLED: true }));

const mockExpireGroupByRef = vi.fn(async (..._args: any[]) => ({ expired: true }));
vi.mock('@/lib/group/expireGroup', () => ({
  expireGroupByRef: (...args: any[]) => mockExpireGroupByRef(...args),
}));

vi.mock('@/lib/stripe/client', () => ({
  getStripeClient: vi.fn(async () => ({})),
}));

const mockGetUser = vi.fn();
let memberRows: any[] = [];
let allMembersRows: any[] = [];

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: mockGetUser } })),
  createServiceRoleClient: vi.fn(() => ({
    from: (table: string) => {
      if (table === 'booking_members') {
        return {
          select: (cols: string) => {
            // Deux requêtes différentes sur la même table : la première
            // (avec le join bookings!inner) cherche les groupes de l'email,
            // la seconde (sans join) compte les membres d'UN booking précis.
            if (cols.includes('bookings!inner')) {
              return {
                ilike: () => ({
                  in: () => ({
                    eq: () => ({
                      not: async () => ({ data: memberRows, error: null }),
                    }),
                  }),
                }),
              };
            }
            return {
              eq: () => ({
                neq: async () => ({ data: allMembersRows, error: null }),
              }),
            };
          },
        };
      }
      throw new Error(`table inattendue: ${table}`);
    },
  })),
}));

import { GET } from '@/app/api/group/pending-status/route';

function member(overrides: Record<string, unknown> = {}) {
  return {
    id: 'member-1',
    status: 'invite',
    booking_id: 'booking-1',
    bookings: {
      id: 'booking-1',
      status: 'active',
      group_ref: 'ref-1',
      payment_deadline: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // dans 10 min
      biz_name: 'Biz',
      service_name: 'Svc',
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  memberRows = [];
  allMembersRows = [];
  mockGetUser.mockResolvedValue({ data: { user: { email: 'client@test.fr' } } });
});

describe('GET /api/group/pending-status', () => {
  it('non connecté (pas d\'email) → pending:false, aucune requête déclenchée', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await GET();
    const json = await res.json();
    expect(json).toEqual({ pending: false });
  });

  it("aucun membre correspondant à l'email → pending:false", async () => {
    memberRows = [];
    const res = await GET();
    const json = await res.json();
    expect(json.pending).toBe(false);
  });

  it("deadline dans le futur → pending:true, PAS d'appel à expireGroupByRef (rien à expirer)", async () => {
    memberRows = [member()];
    allMembersRows = [{ id: 'member-1', status: 'invite' }];
    const res = await GET();
    const json = await res.json();
    expect(json.pending).toBe(true);
    expect(json.groupRef).toBe('ref-1');
    expect(mockExpireGroupByRef).not.toHaveBeenCalled();
  });

  it(
    'deadline dépassée → expiration LAZY déclenchée (expireGroupByRef appelé avec le bon ref), puis pending:false (le groupe vient d\'être clôturé)',
    async () => {
      memberRows = [member({
        bookings: { ...member().bookings, payment_deadline: new Date(Date.now() - 60 * 1000).toISOString() },
      })];
      const res = await GET();
      const json = await res.json();
      expect(mockExpireGroupByRef).toHaveBeenCalledWith('ref-1', expect.anything(), expect.anything());
      expect(json.pending).toBe(false);
    }
  );

  it(
    "un échec d'expireGroupByRef ne fait pas planter la route (catch interne), pending reste calculable",
    async () => {
      mockExpireGroupByRef.mockRejectedValueOnce(new Error('stripe down'));
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      memberRows = [member({
        bookings: { ...member().bookings, payment_deadline: new Date(Date.now() - 60 * 1000).toISOString() },
      })];
      const res = await GET();
      expect(res.status).toBe(200);
      expect(errSpy).toHaveBeenCalledWith('[pending-status] expireGroup error:', 'stripe down');
      errSpy.mockRestore();
    }
  );

  it('groupes multiples : sélectionne celui dont le deadline est le PLUS PROCHE', async () => {
    const far = member({
      id: 'member-far',
      booking_id: 'booking-far',
      bookings: { ...member().bookings, group_ref: 'ref-far', payment_deadline: new Date(Date.now() + 20 * 60 * 1000).toISOString() },
    });
    const near = member({
      id: 'member-near',
      booking_id: 'booking-near',
      bookings: { ...member().bookings, group_ref: 'ref-near', payment_deadline: new Date(Date.now() + 5 * 60 * 1000).toISOString() },
    });
    memberRows = [far, near];
    allMembersRows = [{ id: 'member-near', status: 'invite' }];
    const res = await GET();
    const json = await res.json();
    expect(json.groupRef).toBe('ref-near');
  });

  it('compte payés/total en excluant les membres cancelled, payLink présent seulement si selfStatus=invite', async () => {
    memberRows = [member({ status: 'paid' })];
    allMembersRows = [
      { id: 'm1', status: 'paid' },
      { id: 'm2', status: 'invite' },
      { id: 'm3', status: 'arrived' },
    ];
    const res = await GET();
    const json = await res.json();
    expect(json.paidCount).toBe(2); // paid + arrived
    expect(json.totalCount).toBe(3);
    expect(json.payLink).toBeNull(); // selfStatus='paid', pas 'invite'
  });

  it("payLink pointe vers /pay/<memberId> quand selfStatus='invite'", async () => {
    memberRows = [member({ id: 'member-42', status: 'invite' })];
    allMembersRows = [{ id: 'member-42', status: 'invite' }];
    const res = await GET();
    const json = await res.json();
    expect(json.payLink).toBe('/pay/member-42');
  });
});
