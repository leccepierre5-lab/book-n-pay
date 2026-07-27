// src/app/api/pro/services/route.ts — LOT 2 #1 (audit tarification 27/07) :
// un service créé avec un dépôt à 0€ (ou sous 1€) était structurellement
// inréservable en ligne (stripe/checkout/route.ts refuse tout paiement Stripe
// sous 1€) — le client tombait sur une erreur en toute fin de tunnel de
// paiement, après avoir déjà choisi son créneau. `deposit` défaultait
// silencieusement à 0 (`Number(deposit ?? 0)`) si omis. Ces tests prouvent le
// garde-fou côté serveur, seul point qu'un pro ne peut pas contourner (le
// `required`/`min="1"` du formulaire n'est qu'une aide UX, pas une garantie).
import { describe, it, expect, vi, beforeEach } from 'vitest';

let insertPayload: any = null;
let insertCalled = false;
let updatePayload: any = null;
let updateCalled = false;
let existingServiceFixture: any = { id: 'svc1' };

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'pro-user-1' } } })) },
    from: (table: string) => {
      if (table === 'app_users') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { biz_id: 'biz1', role: 'pro' } }) }) }) };
      }
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) };
    },
  })),
  createServiceRoleClient: vi.fn(() => ({
    from: (table: string) => {
      if (table !== 'services') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) };
      }
      return {
        insert: (payload: any) => {
          insertCalled = true;
          insertPayload = payload;
          return { select: () => ({ single: async () => ({ data: { id: 'svc-new', ...payload }, error: null }) }) };
        },
        update: (payload: any) => {
          updateCalled = true;
          updatePayload = payload;
          return { eq: () => ({ select: () => ({ single: async () => ({ data: { id: 'svc1', ...payload }, error: null }) }) }) };
        },
        select: () => ({
          eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: existingServiceFixture }) }) }),
        }),
      };
    },
  })),
}));

function buildRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/pro/services', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  insertPayload = null;
  insertCalled = false;
  updatePayload = null;
  updateCalled = false;
  existingServiceFixture = { id: 'svc1' };
});

const baseService = { name: 'Coupe', duration_minutes: 30, price: 40 };

describe('POST /api/pro/services — garde-fou dépôt minimum 1€', () => {
  it('deposit omis → 400, rien inséré (ancien comportement: défaultait silencieusement à 0)', async () => {
    const { POST } = await import('@/app/api/pro/services/route');
    const res = await POST(buildRequest({ ...baseService }) as any);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/1€/);
    expect(insertCalled).toBe(false);
  });

  it('deposit = 0 → 400, rien inséré', async () => {
    const { POST } = await import('@/app/api/pro/services/route');
    const res = await POST(buildRequest({ ...baseService, deposit: 0 }) as any);
    expect(res.status).toBe(400);
    expect(insertCalled).toBe(false);
  });

  it('deposit = 0.5 (sous 1€, mais > 0) → 400, rien inséré', async () => {
    const { POST } = await import('@/app/api/pro/services/route');
    const res = await POST(buildRequest({ ...baseService, deposit: 0.5 }) as any);
    expect(res.status).toBe(400);
    expect(insertCalled).toBe(false);
  });

  it('deposit = 1 (plancher exact) → accepté, inséré tel quel', async () => {
    const { POST } = await import('@/app/api/pro/services/route');
    const res = await POST(buildRequest({ ...baseService, deposit: 1 }) as any);
    expect(res.status).toBe(201);
    expect(insertCalled).toBe(true);
    expect(insertPayload.deposit).toBe(1);
  });

  it('deposit = 15 → accepté', async () => {
    const { POST } = await import('@/app/api/pro/services/route');
    const res = await POST(buildRequest({ ...baseService, deposit: 15 }) as any);
    expect(res.status).toBe(201);
    expect(insertPayload.deposit).toBe(15);
  });
});

describe('PATCH /api/pro/services — garde-fou dépôt minimum 1€', () => {
  it('deposit envoyé à 0 sur un service existant → 400, aucune mise à jour', async () => {
    const { PATCH } = await import('@/app/api/pro/services/route');
    const res = await PATCH(buildRequest({ id: 'svc1', deposit: 0 }) as any);
    expect(res.status).toBe(400);
    expect(updateCalled).toBe(false);
  });

  it('deposit envoyé à 0.99 → 400, aucune mise à jour', async () => {
    const { PATCH } = await import('@/app/api/pro/services/route');
    const res = await PATCH(buildRequest({ id: 'svc1', deposit: 0.99 }) as any);
    expect(res.status).toBe(400);
    expect(updateCalled).toBe(false);
  });

  it('deposit non touché (autre champ modifié) → pas de check, mise à jour normale', async () => {
    const { PATCH } = await import('@/app/api/pro/services/route');
    const res = await PATCH(buildRequest({ id: 'svc1', name: 'Nouveau nom' }) as any);
    expect(res.status).toBe(200);
    expect(updateCalled).toBe(true);
    expect(updatePayload.deposit).toBeUndefined();
  });

  it('deposit envoyé à 2 → accepté, mise à jour effectuée', async () => {
    const { PATCH } = await import('@/app/api/pro/services/route');
    const res = await PATCH(buildRequest({ id: 'svc1', deposit: 2 }) as any);
    expect(res.status).toBe(200);
    expect(updatePayload.deposit).toBe(2);
  });
});
