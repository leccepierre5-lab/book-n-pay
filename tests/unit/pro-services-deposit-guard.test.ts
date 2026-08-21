// src/app/api/pro/services/route.ts — LOT 2 #1 (audit tarification 27/07) :
// un service créé avec un dépôt à 0€ était structurellement inréservable en
// ligne (stripe/checkout/route.ts refuse tout paiement Stripe sous 1€) — le
// client tombait sur une erreur en toute fin de tunnel de paiement, après
// avoir déjà choisi son créneau. Ces tests prouvent le garde-fou côté
// serveur, seul point qu'un pro ne peut pas contourner (le formulaire n'est
// qu'une aide UX, pas une garantie).
//
// 11/08 : ajout du plafond MAX_DEPOSIT_EUROS (50€, Stripe prélève sur le
// total débité) et du garde dépôt <= prix, mêmes principes.
//
// 21/08 : le plancher flat 1€ devient minDeposit(price) — 20% du prix,
// plancher 5€ (décision Pierre, remplace la suggestion à 10% du 20/08).
// baseService (price=40) → minimum = 8€ (max(5, 40*0.20)).
import { describe, it, expect, vi, beforeEach } from 'vitest';

let insertPayload: any = null;
let insertCalled = false;
let updatePayload: any = null;
let updateCalled = false;
let existingServiceFixture: any = { id: 'svc1', price: 40, deposit: 15 };

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
  existingServiceFixture = { id: 'svc1', price: 40, deposit: 15 };
});

const baseService = { name: 'Coupe', duration_minutes: 30, price: 40 };

describe('POST /api/pro/services — garde-fou dépôt minimum 20% du prix (plancher 5€)', () => {
  it('deposit omis → 400, rien inséré (ancien comportement: défaultait silencieusement à 0)', async () => {
    const { POST } = await import('@/app/api/pro/services/route');
    const res = await POST(buildRequest({ ...baseService }) as any);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/8€/); // minDeposit(40)
    expect(insertCalled).toBe(false);
  });

  it('deposit = 0 → 400, rien inséré', async () => {
    const { POST } = await import('@/app/api/pro/services/route');
    const res = await POST(buildRequest({ ...baseService, deposit: 0 }) as any);
    expect(res.status).toBe(400);
    expect(insertCalled).toBe(false);
  });

  it('deposit = 7.5 (juste sous le minimum 8€ pour price=40) → 400, rien inséré', async () => {
    const { POST } = await import('@/app/api/pro/services/route');
    const res = await POST(buildRequest({ ...baseService, deposit: 7.5 }) as any);
    expect(res.status).toBe(400);
    expect(insertCalled).toBe(false);
  });

  it('deposit = 8 (minimum exact pour price=40) → accepté, inséré tel quel', async () => {
    const { POST } = await import('@/app/api/pro/services/route');
    const res = await POST(buildRequest({ ...baseService, deposit: 8 }) as any);
    expect(res.status).toBe(201);
    expect(insertCalled).toBe(true);
    expect(insertPayload.deposit).toBe(8);
  });

  it('deposit = 15 → accepté', async () => {
    const { POST } = await import('@/app/api/pro/services/route');
    const res = await POST(buildRequest({ ...baseService, deposit: 15 }) as any);
    expect(res.status).toBe(201);
    expect(insertPayload.deposit).toBe(15);
  });

  it('petit prix (10€) → minimum tombe sur le plancher 5€, pas 20% (2€)', async () => {
    const { POST } = await import('@/app/api/pro/services/route');
    const res = await POST(buildRequest({ ...baseService, price: 10, deposit: 4.5 }) as any);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/5€/);
    expect(insertCalled).toBe(false);
  });

  it('prix très bas (3€) → le minimum ne peut pas dépasser le prix, capé à 3€', async () => {
    const { POST } = await import('@/app/api/pro/services/route');
    const res = await POST(buildRequest({ ...baseService, price: 3, deposit: 3 }) as any);
    expect(res.status).toBe(201);
    expect(insertPayload.deposit).toBe(3);
  });
});

describe('POST /api/pro/services — plafond dépôt 50€ et dépôt <= prix', () => {
  it('deposit = 50 (plafond exact, prix suffisant) → accepté', async () => {
    const { POST } = await import('@/app/api/pro/services/route');
    const res = await POST(buildRequest({ ...baseService, price: 100, deposit: 50 }) as any);
    expect(res.status).toBe(201);
    expect(insertPayload.deposit).toBe(50);
  });

  it('deposit = 50.01 → 400, rien inséré', async () => {
    const { POST } = await import('@/app/api/pro/services/route');
    const res = await POST(buildRequest({ ...baseService, price: 100, deposit: 50.01 }) as any);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/50/);
    expect(insertCalled).toBe(false);
  });

  it('deposit = 0.99 → 400 (garde minimum), rien inséré', async () => {
    const { POST } = await import('@/app/api/pro/services/route');
    const res = await POST(buildRequest({ ...baseService, deposit: 0.99 }) as any);
    expect(res.status).toBe(400);
    expect(insertCalled).toBe(false);
  });

  it('deposit > prix (deposit 45, price 40) → 400, rien inséré', async () => {
    const { POST } = await import('@/app/api/pro/services/route');
    const res = await POST(buildRequest({ ...baseService, price: 40, deposit: 45 }) as any);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/prix/);
    expect(insertCalled).toBe(false);
  });
});

describe('PATCH /api/pro/services — garde-fou dépôt minimum 20% du prix (plancher 5€)', () => {
  // existingServiceFixture par défaut : price=40, deposit=15 → minimum = 8€.
  it('deposit envoyé à 0 sur un service existant → 400, aucune mise à jour', async () => {
    const { PATCH } = await import('@/app/api/pro/services/route');
    const res = await PATCH(buildRequest({ id: 'svc1', deposit: 0 }) as any);
    expect(res.status).toBe(400);
    expect(updateCalled).toBe(false);
  });

  it('deposit envoyé à 2 (sous le minimum 8€ pour price=40) → 400, aucune mise à jour', async () => {
    const { PATCH } = await import('@/app/api/pro/services/route');
    const res = await PATCH(buildRequest({ id: 'svc1', deposit: 2 }) as any);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/8€/);
    expect(updateCalled).toBe(false);
  });

  it('deposit non touché (autre champ modifié) → pas de check, mise à jour normale', async () => {
    const { PATCH } = await import('@/app/api/pro/services/route');
    const res = await PATCH(buildRequest({ id: 'svc1', name: 'Nouveau nom' }) as any);
    expect(res.status).toBe(200);
    expect(updateCalled).toBe(true);
    expect(updatePayload.deposit).toBeUndefined();
  });

  it('deposit envoyé à 10 (au-dessus du minimum 8€) → accepté, mise à jour effectuée', async () => {
    const { PATCH } = await import('@/app/api/pro/services/route');
    const res = await PATCH(buildRequest({ id: 'svc1', deposit: 10 }) as any);
    expect(res.status).toBe(200);
    expect(updatePayload.deposit).toBe(10);
  });

  it("prix baissé SEUL (deposit non touché) sous le nouveau minimum → 400, aucune mise à jour (trouvé le 21/08 : baisser le prix seul contournait le garde-fou avant ce correctif)", async () => {
    // Fixture : deposit existant = 15€. Prix baissé à 20€ → minDeposit(20) = 5€
    // (max(5, 20*0.20)=5? 20*0.20=4 < plancher 5 → min=5) : 15 reste au-dessus,
    // donc ce cas ne suffit pas à prouver le garde-fou — on baisse le prix
    // suffisamment pour dépasser un dépôt existant volontairement bas.
    existingServiceFixture = { id: 'svc1', price: 40, deposit: 5 };
    const { PATCH } = await import('@/app/api/pro/services/route');
    // minDeposit(30) = max(5, 6) = 6€ > deposit existant (5€) → doit être rejeté.
    const res = await PATCH(buildRequest({ id: 'svc1', price: 30 }) as any);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/6€/);
    expect(updateCalled).toBe(false);
  });
});

describe('PATCH /api/pro/services — plafond dépôt 50€ et dépôt <= prix', () => {
  it('deposit = 50 (plafond exact, prix existant à 40 mais price aussi mis à jour à 100) → accepté', async () => {
    const { PATCH } = await import('@/app/api/pro/services/route');
    const res = await PATCH(buildRequest({ id: 'svc1', price: 100, deposit: 50 }) as any);
    expect(res.status).toBe(200);
    expect(updatePayload.deposit).toBe(50);
  });

  it('deposit = 50.01 → 400, aucune mise à jour', async () => {
    const { PATCH } = await import('@/app/api/pro/services/route');
    const res = await PATCH(buildRequest({ id: 'svc1', price: 100, deposit: 50.01 }) as any);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/50/);
    expect(updateCalled).toBe(false);
  });

  it('deposit envoyé seul, sans price, au-delà du prix existant (fixture price=40) → 400', async () => {
    const { PATCH } = await import('@/app/api/pro/services/route');
    const res = await PATCH(buildRequest({ id: 'svc1', deposit: 45 }) as any);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/prix/);
    expect(updateCalled).toBe(false);
  });

  it('price abaissé sous le dépôt existant (fixture deposit=15) sans toucher deposit → 400', async () => {
    const { PATCH } = await import('@/app/api/pro/services/route');
    const res = await PATCH(buildRequest({ id: 'svc1', price: 10 }) as any);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/prix/);
    expect(updateCalled).toBe(false);
  });
});
