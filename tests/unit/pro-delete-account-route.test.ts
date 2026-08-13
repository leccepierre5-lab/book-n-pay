// src/app/api/pro/delete-account/route.ts — suppression de compte pro en
// libre-service (RGPD art. 17). La route la plus destructrice du repo :
// annule un abonnement Stripe, supprime un compte Connect, anonymise/efface
// des données rattachées à un business, puis supprime le compte auth.
//
// Ces tests prouvent, sans toucher de vraie base/API :
// 1. Auth/rôle gardent la route (401, mot de passe incorrect, rôle non-pro).
// 2. Les 4 garde-fous bloquent chacun (réservations à venir, pro_charges
//    pending, overage_charges pending/retry/failed, solde Stripe Connect
//    non nul) — AUCUNE mutation tentée dans ces cas.
// 3. Un échec Stripe (abonnement ou Connect) APRÈS la dépublication arrête
//    tout : alerte admin, 500, deleteUser JAMAIS appelé.
// 4. Un échec de mutation DB (ex: suppression staff) arrête tout de la même
//    façon : alerte admin, 500, deleteUser JAMAIS appelé.
// 5. Cas nominal : anonymisation des bookings faite AVANT deleteUser (ordre
//    vérifié explicitement, pas supposé).
// 6. Un service référencé par une réservation passée n'est JAMAIS supprimé
//    (bookings_service_id est RESTRICT) — seuls les orphelins le sont.
import { describe, it, expect, vi, beforeEach } from 'vitest';

let callLog: string[] = [];

const mockGetUser = vi.fn();
const mockSignIn = vi.fn(
  async (..._args: any[]): Promise<{ error: { message: string } | null }> => ({ error: null })
);

type StripeBalanceEntry = { amount: number; currency: string };
const mockBalanceRetrieve = vi.fn(
  async (..._args: any[]): Promise<{ available: StripeBalanceEntry[]; pending: StripeBalanceEntry[] }> => ({
    available: [{ amount: 0, currency: 'eur' }],
    pending: [],
  })
);
const mockSubscriptionsCancel = vi.fn(async (..._args: any[]) => ({ id: 'sub_test', status: 'canceled' }));
const mockAccountsDel = vi.fn(async (..._args: any[]) => ({ id: 'acct_test', deleted: true }));
vi.mock('@/lib/stripe/client', () => ({
  getStripeClient: vi.fn(async () => ({
    balance: { retrieve: mockBalanceRetrieve },
    subscriptions: { cancel: mockSubscriptionsCancel },
    accounts: { del: mockAccountsDel },
  })),
}));

const mockNotifyAdminOnFailure = vi.fn(async (..._args: any[]) => {});
vi.mock('@/lib/notify-admin', () => ({
  notifyAdminOnFailure: (...args: any[]) => mockNotifyAdminOnFailure(...args),
}));

// Chaque chaîne est "thenable" (awaitable directement, comme le fait le
// vrai supabase-js pour les requêtes sans .single()/.maybeSingle()) ET
// expose .maybeSingle()/.single() pour les requêtes qui en ont besoin — les
// deux résolvent le même `result` configuré à la construction. `logLabel`,
// posé uniquement sur update/insert/delete (les mutations, pas les
// filtres), sert à vérifier l'ORDRE réel des opérations dans les tests.
function makeChain(result: { data?: any; error?: any; count?: any } = { data: null, error: null }, logLabel?: string) {
  const chain: any = Promise.resolve(result);
  for (const m of ['select', 'eq', 'neq', 'gte', 'in']) {
    chain[m] = vi.fn((..._args: any[]) => chain);
  }
  for (const m of ['update', 'insert', 'delete']) {
    chain[m] = vi.fn((..._args: any[]) => {
      if (logLabel) callLog.push(logLabel);
      return chain;
    });
  }
  chain.maybeSingle = vi.fn(async () => result);
  chain.single = vi.fn(async () => result);
  return chain;
}

let queues: Record<string, any[]> = {};
function q(table: string, result: any = { data: null, error: null }, logLabel?: string) {
  (queues[table] ??= []).push(makeChain(result, logLabel));
}

const mockDeleteUser = vi.fn(async (..._args: any[]) => {
  callLog.push('deleteUser');
  return { error: null };
});

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mockGetUser, signInWithPassword: (...a: any[]) => mockSignIn(...a) },
  })),
  createServiceRoleClient: vi.fn(() => ({
    from: (t: string) => {
      const arr = queues[t];
      if (!arr || arr.length === 0) throw new Error(`appel inattendu (queue vide) sur la table: ${t}`);
      return arr.shift();
    },
    auth: { admin: { deleteUser: (...a: any[]) => mockDeleteUser(...a) } },
  })),
}));

function buildRequest(body: any) {
  return new Request('http://localhost/api/pro/delete-account', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

const BUSINESS = { id: 'biz-1', name: 'Salon Test' };
const SETTINGS_NO_STRIPE = { stripe_customer_id: null, stripe_subscription_id: null, stripe_account_id: null };
const SETTINGS_WITH_STRIPE = {
  stripe_customer_id: 'cus_1',
  stripe_subscription_id: 'sub_1',
  stripe_account_id: 'acct_1',
};

// Empile les 6 premières requêtes communes à TOUS les chemins qui passent
// les garde-fous : profil, business, settings, puis les 3 garde-fous eux-mêmes
// (réservations à venir, pro_charges, overage_charges) — tous "propres" par
// défaut (aucun blocage). Le solde Stripe reste à configurer par le test
// (mockBalanceRetrieve) si stripe_account_id est renseigné.
function queueGuardsPass(settings: any) {
  q('app_users', { data: { biz_id: 'biz-1', role: 'pro' }, error: null });
  q('businesses', { data: BUSINESS, error: null }); // fetch initial
  q('business_settings', { data: settings, error: null }); // fetch initial
  q('bookings', { data: [], error: null }); // upcoming check : aucune
  q('pro_charges', { count: 0, data: null, error: null });
  q('overage_charges', { count: 0, data: null, error: null });
}

beforeEach(() => {
  vi.clearAllMocks();
  queues = {};
  callLog = [];
  mockGetUser.mockResolvedValue({ data: { user: { id: 'pro1', email: 'pro@example.com' } } });
  mockSignIn.mockResolvedValue({ error: null });
  mockBalanceRetrieve.mockResolvedValue({ available: [{ amount: 0, currency: 'eur' }], pending: [] });
  mockSubscriptionsCancel.mockResolvedValue({ id: 'sub_test', status: 'canceled' });
  mockAccountsDel.mockResolvedValue({ id: 'acct_test', deleted: true });
});

describe('POST /api/pro/delete-account', () => {
  it('non authentifié → 401', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const { POST } = await import('@/app/api/pro/delete-account/route');
    const res = await POST(buildRequest({ password: 'x' }) as any);

    expect(res.status).toBe(401);
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it('mot de passe incorrect → 400, rien interrogé ensuite', async () => {
    mockSignIn.mockResolvedValue({ error: { message: 'Invalid login credentials' } });

    const { POST } = await import('@/app/api/pro/delete-account/route');
    const res = await POST(buildRequest({ password: 'wrong' }) as any);

    expect(res.status).toBe(400);
    expect(mockSubscriptionsCancel).not.toHaveBeenCalled();
  });

  it("rôle non-pro (ex: admin) → 403, jamais atteint les garde-fous", async () => {
    q('app_users', { data: { biz_id: 'biz-1', role: 'admin' }, error: null });

    const { POST } = await import('@/app/api/pro/delete-account/route');
    const res = await POST(buildRequest({ password: 'ok' }) as any);

    expect(res.status).toBe(403);
    expect(mockSubscriptionsCancel).not.toHaveBeenCalled();
  });

  it('réservations à venir non annulées → 409 upcoming_bookings, aucune mutation', async () => {
    q('app_users', { data: { biz_id: 'biz-1', role: 'pro' }, error: null });
    q('businesses', { data: BUSINESS, error: null });
    q('business_settings', { data: SETTINGS_NO_STRIPE, error: null });
    q('bookings', { data: [{ id: 'bk1' }, { id: 'bk2' }], error: null });

    const { POST } = await import('@/app/api/pro/delete-account/route');
    const res = await POST(buildRequest({ password: 'ok' }) as any);
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json).toEqual({ error: 'upcoming_bookings', count: 2 });
    expect(mockSubscriptionsCancel).not.toHaveBeenCalled();
    expect(mockDeleteUser).not.toHaveBeenCalled();
  });

  it('pro_charges en attente → 409 pending_charges, aucune mutation', async () => {
    q('app_users', { data: { biz_id: 'biz-1', role: 'pro' }, error: null });
    q('businesses', { data: BUSINESS, error: null });
    q('business_settings', { data: SETTINGS_NO_STRIPE, error: null });
    q('bookings', { data: [], error: null });
    q('pro_charges', { count: 2, data: null, error: null });

    const { POST } = await import('@/app/api/pro/delete-account/route');
    const res = await POST(buildRequest({ password: 'ok' }) as any);
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toBe('pending_charges');
    expect(mockDeleteUser).not.toHaveBeenCalled();
  });

  it('overage_charges pending/retry/failed → 409 pending_overage, aucune mutation', async () => {
    q('app_users', { data: { biz_id: 'biz-1', role: 'pro' }, error: null });
    q('businesses', { data: BUSINESS, error: null });
    q('business_settings', { data: SETTINGS_NO_STRIPE, error: null });
    q('bookings', { data: [], error: null });
    q('pro_charges', { count: 0, data: null, error: null });
    q('overage_charges', { count: 1, data: null, error: null });

    const { POST } = await import('@/app/api/pro/delete-account/route');
    const res = await POST(buildRequest({ password: 'ok' }) as any);
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toBe('pending_overage');
    expect(mockDeleteUser).not.toHaveBeenCalled();
  });

  it('solde Stripe Connect non nul (disponible OU en attente) → 409 stripe_balance, Stripe jamais annulé/supprimé', async () => {
    queueGuardsPass(SETTINGS_WITH_STRIPE);
    mockBalanceRetrieve.mockResolvedValue({ available: [{ amount: 0, currency: 'eur' }], pending: [{ amount: 1500, currency: 'eur' }] });

    const { POST } = await import('@/app/api/pro/delete-account/route');
    const res = await POST(buildRequest({ password: 'ok' }) as any);
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json).toEqual({ error: 'stripe_balance', amountCents: 1500 });
    expect(mockSubscriptionsCancel).not.toHaveBeenCalled();
    expect(mockAccountsDel).not.toHaveBeenCalled();
    expect(mockDeleteUser).not.toHaveBeenCalled();
  });

  it("échec Stripe (annulation abonnement) après dépublication → alerte admin, 500, deleteUser JAMAIS appelé", async () => {
    queueGuardsPass(SETTINGS_WITH_STRIPE);
    q('businesses', { error: null }, 'businesses:depublish'); // dépublication — DOIT réussir avant l'échec Stripe
    mockSubscriptionsCancel.mockRejectedValue(new Error('Stripe API down'));

    const { POST } = await import('@/app/api/pro/delete-account/route');
    const res = await POST(buildRequest({ password: 'ok' }) as any);

    expect(res.status).toBe(500);
    // La dépublication a bien eu lieu AVANT que Stripe échoue.
    expect(callLog).toContain('businesses:depublish');
    expect(mockNotifyAdminOnFailure).toHaveBeenCalledTimes(1);
    expect(mockNotifyAdminOnFailure.mock.calls[0][0]).toBe('pro/delete-account:subscription-cancel');
    // Connect jamais tenté : on s'arrête au premier échec.
    expect(mockAccountsDel).not.toHaveBeenCalled();
    expect(mockDeleteUser).not.toHaveBeenCalled();
  });

  it('retry après échec Stripe déjà partiellement traité (abonnement déjà annulé) : idempotent, ne re-échoue pas', async () => {
    queueGuardsPass(SETTINGS_WITH_STRIPE);
    q('businesses', { error: null }, 'businesses:depublish');
    mockSubscriptionsCancel.mockRejectedValue(new Error('This subscription has already been canceled.'));
    mockAccountsDel.mockResolvedValue({ id: 'acct_1', deleted: true });
    // Reste de la séquence DB — cas nominal complet pour ce test.
    q('bookings', { error: null }, 'bookings:anonymize');
    q('services', { data: [], error: null });
    q('bookings', { data: [], error: null });
    for (const t of ['business_locations', 'business_photos', 'staff', 'flash_slots', 'business_reviews', 'favorites']) {
      q(t, { error: null });
    }
    q('businesses', { error: null }, 'businesses:anonymize');
    q('business_settings', { error: null });
    q('business_deletion_log', { error: null }, 'deletion_log');

    const { POST } = await import('@/app/api/pro/delete-account/route');
    const res = await POST(buildRequest({ password: 'ok' }) as any);

    expect(res.status).toBe(200);
    expect(mockNotifyAdminOnFailure).not.toHaveBeenCalled();
    expect(mockDeleteUser).toHaveBeenCalledTimes(1);
  });

  it('échec de mutation DB (ex: suppression staff) → alerte admin, 500, deleteUser JAMAIS appelé', async () => {
    queueGuardsPass(SETTINGS_NO_STRIPE);
    q('businesses', { error: null }, 'businesses:depublish');
    q('bookings', { error: null }, 'bookings:anonymize');
    q('services', { data: [], error: null });
    q('bookings', { data: [], error: null });
    q('business_locations', { error: null });
    q('business_photos', { error: null });
    q('staff', { error: { message: 'connexion DB perdue' } }); // échec ICI

    const { POST } = await import('@/app/api/pro/delete-account/route');
    const res = await POST(buildRequest({ password: 'ok' }) as any);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toContain('partiellement échoué');
    expect(mockNotifyAdminOnFailure).toHaveBeenCalledTimes(1);
    expect(mockNotifyAdminOnFailure.mock.calls[0][0]).toBe('pro/delete-account:db-mutation');
    expect(mockNotifyAdminOnFailure.mock.calls[0][1].failedDescriptions[0]).toContain('suppression staff');
    // Les tables APRÈS staff dans la séquence ne sont jamais atteintes —
    // sinon la queue vide de flash_slots ferait échouer le test avec une
    // erreur différente ("appel inattendu"), ce qui est déjà une preuve
    // indirecte ; l'assertion explicite ci-dessous le confirme.
    expect(mockDeleteUser).not.toHaveBeenCalled();
  });

  it('cas nominal (sans Stripe) : anonymisation bookings faite AVANT deleteUser, ordre vérifié', async () => {
    queueGuardsPass(SETTINGS_NO_STRIPE);
    q('businesses', { error: null }, 'businesses:depublish');
    q('bookings', { error: null }, 'bookings:anonymize');
    q('services', { data: [{ id: 'svc-1' }, { id: 'svc-2' }], error: null }); // select
    q('bookings', { data: [{ service_id: 'svc-1' }], error: null }); // svc-1 référencé, svc-2 orphelin
    q('services', { error: null }); // delete (svc-2 seul, orphelin)
    q('business_locations', { error: null });
    q('business_photos', { error: null });
    q('staff', { error: null });
    q('flash_slots', { error: null });
    q('business_reviews', { error: null });
    q('favorites', { error: null });
    q('businesses', { error: null }, 'businesses:anonymize');
    q('business_settings', { error: null });
    q('business_deletion_log', { error: null }, 'deletion_log');

    const { POST } = await import('@/app/api/pro/delete-account/route');
    const res = await POST(buildRequest({ password: 'ok' }) as any);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true });

    expect(callLog).toEqual([
      'businesses:depublish',
      'bookings:anonymize',
      'businesses:anonymize',
      'deletion_log',
      'deleteUser',
    ]);
    // Preuve directe de l'exigence de Pierre : anonymiser AVANT deleteUser.
    expect(callLog.indexOf('bookings:anonymize')).toBeLessThan(callLog.indexOf('deleteUser'));
  });

  it('un service référencé par une réservation passée (bookings_service_id RESTRICT) n\'est jamais supprimé — seul l\'orphelin l\'est', async () => {
    queueGuardsPass(SETTINGS_NO_STRIPE);
    q('businesses', { error: null }, 'businesses:depublish');
    q('bookings', { error: null }, 'bookings:anonymize');
    q('services', { data: [{ id: 'svc-referenced' }, { id: 'svc-orphan' }], error: null });
    q('bookings', { data: [{ service_id: 'svc-referenced' }], error: null });
    const servicesDeleteChain = makeChain({ error: null });
    queues.services.push(servicesDeleteChain);
    for (const t of ['business_locations', 'business_photos', 'staff', 'flash_slots', 'business_reviews', 'favorites']) {
      q(t, { error: null });
    }
    q('businesses', { error: null }, 'businesses:anonymize');
    q('business_settings', { error: null });
    q('business_deletion_log', { error: null }, 'deletion_log');

    const { POST } = await import('@/app/api/pro/delete-account/route');
    const res = await POST(buildRequest({ password: 'ok' }) as any);

    expect(res.status).toBe(200);
    // .in() est appelée avec UNIQUEMENT l'orphelin — jamais svc-referenced.
    expect(servicesDeleteChain.in).toHaveBeenCalledWith('id', ['svc-orphan']);
  });
});
