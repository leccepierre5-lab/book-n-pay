// src/app/api/auth/register/route.ts — audit du 15/08 : le téléphone était
// accepté sans aucune validation de format ("okokokok" passait). Prouve :
// 1. Champs requis / CGU non acceptées → 400 (comportement préexistant).
// 2. Téléphone invalide → 400, generateLink jamais appelé.
// 3. Téléphone valide → normalisé avant d'être passé en metadata.
// 4. Pas de téléphone → ok, chaîne vide en metadata (optionnel).
// 5. Téléphone déjà associé à un AUTRE compte (contrainte UNIQUE
//    app_users.phone) → 409 avec message actionnable, generateLink jamais
//    appelé — au lieu de laisser le trigger handle_new_user avorter en
//    exception non gérée puis retomber sur le générique 500.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCheckRateLimit = vi.fn(async (..._args: any[]) => ({ allowed: true, currentCount: 1 }));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: (...args: any[]) => mockCheckRateLimit(...args),
  getClientIp: () => '1.2.3.4',
}));

const mockSendEmail = vi.fn(async (..._args: any[]) => ({ sent: true }));
vi.mock('@/lib/email/send', () => ({
  sendEmail: (...args: any[]) => mockSendEmail(...args),
  emailTemplate: (content: string) => content,
  escapeHtml: (s: string) => s,
}));

const mockGenerateLink = vi.fn(async (..._args: any[]) => ({
  data: {
    properties: { hashed_token: 'tok_abc' },
    user: { id: 'user-1' },
  },
  error: null,
}));

function makeChain(singleData: any = null) {
  const chain: any = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.update = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(async () => ({ data: singleData, error: null }));
  return chain;
}

let appUsersChain: any;
vi.mock('@/lib/supabase/server', () => ({
  createServiceRoleClient: vi.fn(() => ({
    auth: { admin: { generateLink: (...args: any[]) => mockGenerateLink(...args) } },
    from: (t: string) => {
      if (t === 'app_users') return appUsersChain;
      throw new Error('unexpected table: ' + t);
    },
  })),
}));

function buildRequest(body: any) {
  return new Request('http://localhost/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

const VALID_BODY = { email: 'client@example.com', password: 'password123', name: 'Client Test', cguAccepted: true };

beforeEach(() => {
  vi.clearAllMocks();
  mockCheckRateLimit.mockResolvedValue({ allowed: true, currentCount: 1 });
  mockGenerateLink.mockResolvedValue({
    data: { properties: { hashed_token: 'tok_abc' }, user: { id: 'user-1' } },
    error: null,
  });
  // Par défaut : un seul appel .maybeSingle() attendu (lookup existingUser
  // pour le code de parrainage), cas "pas de téléphone" où le pré-check de
  // collision est sauté. Les tests avec téléphone écrasent ce mock pour
  // séquencer 2 appels (pré-check collision PUIS lookup existingUser).
  appUsersChain = makeChain({ id: 'user-1', referral_code: 'BNP-CLIENT1234' });
});

describe('POST /api/auth/register', () => {
  it('email/password manquants → 400', async () => {
    const { POST } = await import('@/app/api/auth/register/route');
    const res = await POST(buildRequest({ cguAccepted: true }) as any);
    expect(res.status).toBe(400);
  });

  it('CGU non acceptées → 400', async () => {
    const { POST } = await import('@/app/api/auth/register/route');
    const res = await POST(buildRequest({ ...VALID_BODY, cguAccepted: false }) as any);
    expect(res.status).toBe(400);
  });

  it('téléphone invalide ("okokokok") → 400, generateLink jamais appelé', async () => {
    const { POST } = await import('@/app/api/auth/register/route');
    const res = await POST(buildRequest({ ...VALID_BODY, phone: 'okokokok' }) as any);
    expect(res.status).toBe(400);
    expect(mockGenerateLink).not.toHaveBeenCalled();
  });

  it('téléphone valide avec séparateurs → normalisé avant metadata', async () => {
    appUsersChain.maybeSingle = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: null }) // pré-check collision : aucun autre compte
      .mockResolvedValueOnce({ data: { id: 'user-1', referral_code: 'BNP-CLIENT1234' }, error: null });
    const { POST } = await import('@/app/api/auth/register/route');
    const res = await POST(buildRequest({ ...VALID_BODY, phone: '06 12 34 56 78' }) as any);
    expect(res.status).toBe(200);
    expect(mockGenerateLink).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          data: expect.objectContaining({ phone: '+33612345678' }),
        }),
      })
    );
  });

  it('pas de téléphone → ok, chaîne vide en metadata', async () => {
    const { POST } = await import('@/app/api/auth/register/route');
    const res = await POST(buildRequest(VALID_BODY) as any);
    expect(res.status).toBe(200);
    expect(mockGenerateLink).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          data: expect.objectContaining({ phone: '' }),
        }),
      })
    );
  });

  it('téléphone déjà associé à un autre compte → 409, message actionnable, generateLink jamais appelé', async () => {
    appUsersChain.maybeSingle = vi.fn().mockResolvedValueOnce({ data: { id: 'other-user' }, error: null });
    const { POST } = await import('@/app/api/auth/register/route');
    const res = await POST(buildRequest({ ...VALID_BODY, phone: '0612345678' }) as any);
    const json = await res.json();
    expect(res.status).toBe(409);
    expect(json.error).toContain('déjà associé à un compte');
    expect(mockGenerateLink).not.toHaveBeenCalled();
  });
});
