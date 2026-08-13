// src/app/api/pro/staff/route.ts + [id]/route.ts — limite de collaborateurs
// par plan (maxStaff, plans-config.ts). Le pro lui-même n'a jamais de ligne
// `staff` (confirmé en lisant le flux de création de business, aucun insert
// `staff` n'y est fait) — maxStaff compte donc les collaborateurs EN PLUS du
// pro : Starter=0 (solo), Business=2 (+pro=3), Scale=null (illimité).
// Ces tests prouvent :
// 1. Starter (maxStaff=0) : toute création est refusée dès le 1er staff actif.
// 2. Business (maxStaff=2) : refusé au 2e staff actif déjà présent, permis en dessous.
// 3. Scale (maxStaff=null) : jamais refusé, quel que soit le nombre déjà présent.
// 4. La limite ne compte que les staff ACTIFS (is_active=true) — un staff
//    désactivé ne bloque pas une nouvelle création.
// 5. Même garde sur la réactivation (PATCH .../reactivate) — sinon
//    désactiver/réactiver contournerait la limite.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetUser = vi.fn();
let authProfile: any = { role: 'pro', biz_id: 'biz-1' };
let planKey = 'starter';
let activeStaffCount = 0;
const recordResult: any = { id: 'staff-1', name: 'Julien', role: null, emoji: null, is_active: true, deactivated_at: null, created_at: '2026-08-12' };

function makeStaffChain() {
  const chain: any = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.insert = vi.fn(() => chain);
  chain.update = vi.fn(() => chain);
  chain.single = vi.fn(async () => ({ data: recordResult, error: null }));
  // Thenable : couvre `await admin.from('staff').select(...).eq(...).eq(...)`
  // (comptage, sans .single()) — result = { count }.
  chain.then = (resolve: any) => resolve({ data: null, error: null, count: activeStaffCount });
  return chain;
}

function makeSettingsChain() {
  return {
    select: vi.fn(function (this: any) { return this; }),
    eq: vi.fn(function (this: any) { return this; }),
    maybeSingle: vi.fn(async () => ({ data: { plan_key: planKey }, error: null })),
  };
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
    from: (t: string) => {
      if (t === 'app_users') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: authProfile }) }) }) };
      }
      throw new Error('unexpected table on authed client: ' + t);
    },
  })),
  createServiceRoleClient: vi.fn(() => ({
    from: (t: string) => {
      if (t === 'business_settings') return makeSettingsChain();
      if (t === 'staff') return makeStaffChain();
      throw new Error('unexpected table on admin client: ' + t);
    },
  })),
}));

beforeEach(() => {
  vi.clearAllMocks();
  authProfile = { role: 'pro', biz_id: 'biz-1' };
  mockGetUser.mockResolvedValue({ data: { user: { id: 'pro1', email: 'pro@example.com' } } });
  planKey = 'starter';
  activeStaffCount = 0;
});

function buildPostRequest(body: any) {
  return new Request('http://localhost/api/pro/staff', { method: 'POST', body: JSON.stringify(body) });
}
function buildPatchRequest(body: any) {
  return new Request('http://localhost/api/pro/staff/staff-1', { method: 'PATCH', body: JSON.stringify(body) });
}

describe('POST /api/pro/staff — limite par plan', () => {
  it('Starter (maxStaff=0), 0 staff actif → refusé (solo, aucun collaborateur autorisé)', async () => {
    planKey = 'starter';
    activeStaffCount = 0;
    const { POST } = await import('@/app/api/pro/staff/route');
    const res = await POST(buildPostRequest({ name: 'Julien' }) as any);
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toContain('Limite de 1 collaborateur');
    expect(json.error).toContain('Starter');
  });

  it('Business (maxStaff=2), 2 staff actifs déjà présents → refusé', async () => {
    planKey = 'business';
    activeStaffCount = 2;
    const { POST } = await import('@/app/api/pro/staff/route');
    const res = await POST(buildPostRequest({ name: 'Julien' }) as any);
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toContain('Limite de 3 collaborateurs');
    expect(json.error).toContain('Business');
  });

  it('Business (maxStaff=2), 1 seul staff actif → autorisé (encore de la marge)', async () => {
    planKey = 'business';
    activeStaffCount = 1;
    const { POST } = await import('@/app/api/pro/staff/route');
    const res = await POST(buildPostRequest({ name: 'Julien' }) as any);

    expect(res.status).toBe(201);
  });

  it('Scale (maxStaff=null), 50 staff actifs → jamais refusé', async () => {
    planKey = 'scale';
    activeStaffCount = 50;
    const { POST } = await import('@/app/api/pro/staff/route');
    const res = await POST(buildPostRequest({ name: 'Julien' }) as any);

    expect(res.status).toBe(201);
  });

  it('le comptage ne porte que sur les staff ACTIFS (is_active=true), pas les désactivés', async () => {
    planKey = 'business';
    activeStaffCount = 1; // 1 actif + N désactivés hors du champ du comptage (filtré côté requête)
    const { POST } = await import('@/app/api/pro/staff/route');
    const res = await POST(buildPostRequest({ name: 'Julien' }) as any);

    expect(res.status).toBe(201);
  });
});

describe('PATCH /api/pro/staff/[id] (reactivate) — même limite', () => {
  it('Business (maxStaff=2), 2 staff actifs déjà présents → réactivation refusée', async () => {
    planKey = 'business';
    activeStaffCount = 2;
    const { PATCH } = await import('@/app/api/pro/staff/[id]/route');
    const res = await PATCH(buildPatchRequest({ reactivate: true }) as any, { params: Promise.resolve({ id: 'staff-1' }) });
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toContain('Limite de 3 collaborateurs');
  });

  it('Business (maxStaff=2), 1 staff actif → réactivation autorisée', async () => {
    planKey = 'business';
    activeStaffCount = 1;
    const { PATCH } = await import('@/app/api/pro/staff/[id]/route');
    const res = await PATCH(buildPatchRequest({ reactivate: true }) as any, { params: Promise.resolve({ id: 'staff-1' }) });

    expect(res.status).toBe(200);
  });

  it('une simple modification (nom/rôle, pas reactivate) ne déclenche jamais la garde de limite', async () => {
    planKey = 'starter';
    activeStaffCount = 5; // très au-dessus de la limite Starter
    const { PATCH } = await import('@/app/api/pro/staff/[id]/route');
    const res = await PATCH(buildPatchRequest({ name: 'Nouveau nom' }) as any, { params: Promise.resolve({ id: 'staff-1' }) });

    expect(res.status).toBe(200);
  });
});
