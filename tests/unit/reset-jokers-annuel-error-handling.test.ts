// src/app/api/cron/reset-jokers-annuel/route.ts — le cas le plus grave
// trouvé dans le balayage "erreur ≠ zéro" du 13/08 (incident pro_charges) :
// avant correctif, `const rdvRecents = count || 0` traitait un ÉCHEC de
// requête exactement comme "0 RDV cette année", déclenchant un vrai
// déclassement de statut fidélité sur la base d'une erreur technique — pas
// un garde-fou contourné, une SANCTION appliquée à tort à un client fidèle.
// Ces tests prouvent : une erreur de comptage ne modifie JAMAIS le statut,
// alerte l'admin, et n'empêche pas le cron de continuer pour les autres
// utilisateurs.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockNotifyAdminOnFailure = vi.fn(async (..._args: any[]) => {});
vi.mock('@/lib/notify-admin', () => ({
  notifyAdminOnFailure: (...args: any[]) => mockNotifyAdminOnFailure(...args),
}));

let usersRow: any[] = [];
// bookingCountByPhone: phone -> number | 'ERROR'
let bookingCountByPhone: Record<string, number | 'ERROR'> = {};
const updateCalls: { id: string; updates: any }[] = [];

function makeAppUsersChain() {
  const chain: any = Promise.resolve({ data: usersRow, error: null });
  chain.select = vi.fn(() => chain);
  chain.update = vi.fn((updates: any) => {
    // capture l'id via le .eq() suivant — voir plus bas
    chain._pendingUpdate = updates;
    return chain;
  });
  chain.eq = vi.fn((_col: string, id: string) => {
    if (chain._pendingUpdate) {
      updateCalls.push({ id, updates: chain._pendingUpdate });
      chain._pendingUpdate = null;
    }
    return Promise.resolve({ data: null, error: null });
  });
  return chain;
}

function makeBookingMembersChain(phone: string) {
  const result = bookingCountByPhone[phone];
  const isError = result === 'ERROR';
  const chain: any = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.gte = vi.fn(() =>
    Promise.resolve(
      isError
        ? { data: null, error: { message: 'connexion DB perdue' }, count: null }
        : { data: null, error: null, count: result as number }
    )
  );
  return chain;
}

vi.mock('@/lib/supabase/server', () => ({
  createServiceRoleClient: vi.fn(() => ({
    from: (t: string) => {
      if (t === 'app_users') return makeAppUsersChain();
      if (t === 'booking_members') {
        // Le phone utilisé est déterminé par l'appelant via .eq('phone', x)
        // — capturé indirectement en réutilisant le closure du user courant,
        // voir currentPhone ci-dessous.
        return makeBookingMembersChain(currentPhone);
      }
      throw new Error('unexpected table: ' + t);
    },
  })),
}));

let currentPhone = '';

function buildRequest() {
  return new Request('http://localhost/api/cron/reset-jokers-annuel', {
    headers: { authorization: 'Bearer test-cron-secret' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = 'test-cron-secret';
  usersRow = [];
  bookingCountByPhone = {};
  updateCalls.length = 0;
  currentPhone = '';
});

// derniere_activite VIDE : chaîne vide < toute date ISO réelle, donc satisfait
// systématiquement `derniereActivite < oneYearAgo` et fait entrer dans la
// branche "min RDV/an" — pratique pour isoler ce chemin dans les tests
// nominaux ci-dessous, indépendamment de la vraie date d'activité.
const EMPTY_ACTIVITY = '';

describe('GET /api/cron/reset-jokers-annuel', () => {
  it('non autorisé (mauvais secret) → 401', async () => {
    const { GET } = await import('@/app/api/cron/reset-jokers-annuel/route');
    const res = await GET(new Request('http://localhost/x', { headers: { authorization: 'Bearer wrong' } }) as any);
    expect(res.status).toBe(401);
  });

  it("cas nominal — comptage réussi, moins de 5 RDV/an → déclassement normal (comportement inchangé)", async () => {
    currentPhone = '0600000001';
    usersRow = [{ id: 'u1', name: 'Client Gold', phone: currentPhone, statut: 'Gold', derniere_activite: EMPTY_ACTIVITY }];
    bookingCountByPhone[currentPhone] = 2; // < MIN_RDV_ANNUEL (5)

    const { GET } = await import('@/app/api/cron/reset-jokers-annuel/route');
    const res = await GET(buildRequest() as any);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.degraded).toBe(1);
    expect(updateCalls[0].updates.statut).toBe('Argent'); // DOWNGRADE['Gold']
    expect(mockNotifyAdminOnFailure).not.toHaveBeenCalled();
  });

  it("cas nominal — comptage réussi, assez de RDV/an → statut INCHANGÉ", async () => {
    currentPhone = '0600000002';
    usersRow = [{ id: 'u2', name: 'Client Fidèle', phone: currentPhone, statut: 'Gold', derniere_activite: EMPTY_ACTIVITY }];
    bookingCountByPhone[currentPhone] = 8; // >= MIN_RDV_ANNUEL

    const { GET } = await import('@/app/api/cron/reset-jokers-annuel/route');
    const res = await GET(buildRequest() as any);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.degraded).toBe(0);
    expect(updateCalls[0].updates.statut).toBe('Gold');
  });

  it("LE CAS CRITIQUE — échec du comptage RDV → statut JAMAIS modifié, alerte admin, cron continue (pas un crash)", async () => {
    currentPhone = '0600000003';
    usersRow = [{ id: 'u3', name: 'Client Fidèle Puni À Tort', phone: currentPhone, statut: 'Gold', derniere_activite: EMPTY_ACTIVITY }];
    bookingCountByPhone[currentPhone] = 'ERROR';

    const { GET } = await import('@/app/api/cron/reset-jokers-annuel/route');
    const res = await GET(buildRequest() as any);
    const json = await res.json();

    expect(res.status).toBe(200); // le cron ne plante pas
    expect(json.degraded).toBe(0); // AUCUN déclassement déclenché par l'erreur
    expect(json.readFailures).toBe(1);
    // Le statut écrit reste 'Gold' — jamais rétrogradé sur la base de l'erreur.
    expect(updateCalls[0].updates.statut).toBe('Gold');
    expect(mockNotifyAdminOnFailure).toHaveBeenCalledTimes(1);
    expect(mockNotifyAdminOnFailure.mock.calls[0][0]).toBe('cron/reset-jokers-annuel:rdv-count');
    const failedDescriptions = mockNotifyAdminOnFailure.mock.calls[0][1].failedDescriptions;
    expect(failedDescriptions[0]).toContain('Client Fidèle Puni À Tort');
    expect(failedDescriptions[0]).toContain('statut inchangé par prudence');
  });

  it("règle d'inactivité (60j) SUPPRIMÉE le 21/08 : un client inactif depuis 70j (< 1 an) n'est plus déclassé, aucune requête RDV déclenchée", async () => {
    // Avant le 21/08, ce cas déclenchait un déclassement immédiat à
    // Standard sans même consulter booking_members. Décision produit : un
    // client inactif conserve désormais statut/Jokers/historique — seule
    // la règle des 5 RDV/an (< 1 an d'inactivité ne la déclenche pas non
    // plus, `derniereActivite < oneYearAgo` reste faux à 70j) subsiste.
    const seventyDaysAgo = new Date(Date.now() - 70 * 24 * 3600 * 1000).toISOString();
    currentPhone = '0600000004';
    usersRow = [{ id: 'u4', name: 'Client Inactif', phone: currentPhone, statut: 'Bronze', derniere_activite: seventyDaysAgo }];

    const { GET } = await import('@/app/api/cron/reset-jokers-annuel/route');
    const res = await GET(buildRequest() as any);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.degraded).toBe(0);
    expect(updateCalls[0].updates.statut).toBe('Bronze');
    expect(mockNotifyAdminOnFailure).not.toHaveBeenCalled();
  });

  it("règle des 5 RDV/an (art. 4.3, distincte de l'inactivité supprimée) continue de s'appliquer pour une inactivité > 1 an", async () => {
    // derniereActivite < oneYearAgo redevient atteignable maintenant que la
    // branche inactivité (qui interceptait tout ce qui dépassait 60j,
    // masquant ce chemin pour toute vieille date) a disparu.
    const overOneYearAgo = new Date(Date.now() - 400 * 24 * 3600 * 1000).toISOString();
    currentPhone = '0600000005';
    usersRow = [{ id: 'u5', name: 'Client Très Inactif', phone: currentPhone, statut: 'Bronze', derniere_activite: overOneYearAgo }];
    bookingCountByPhone[currentPhone] = 1; // < MIN_RDV_ANNUEL (5)

    const { GET } = await import('@/app/api/cron/reset-jokers-annuel/route');
    const res = await GET(buildRequest() as any);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.degraded).toBe(1);
    expect(updateCalls[0].updates.statut).toBe('Standard'); // DOWNGRADE['Bronze']
  });
});
