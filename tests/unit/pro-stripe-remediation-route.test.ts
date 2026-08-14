// src/app/api/pro/stripe/remediation/route.ts — Bloc C, bouton du bandeau
// dashboard pro. Vérifie : auth, biz_id requis, pas de compte Connect →
// refus, et l'appel accountLinks.create exact (collection_options).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetUser = vi.fn();
let authProfile: any = null;

const mockAccountLinksCreate = vi.fn(async (..._args: any[]) => ({ url: 'https://connect.stripe.com/setup/test' }));
vi.mock('@/lib/stripe/client', () => ({
  getStripeClient: vi.fn(async () => ({
    accountLinks: { create: (...args: any[]) => mockAccountLinksCreate(...args) },
  })),
}));

function makeChain(listData: any[], singleData: any = listData[0] ?? null, error: any = null) {
  const chain: any = Promise.resolve({ data: listData, error });
  for (const m of ['select', 'eq', 'update', 'insert']) {
    chain[m] = vi.fn((..._args: any[]) => chain);
  }
  chain.maybeSingle = vi.fn(async () => ({ data: singleData, error }));
  chain.single = vi.fn(async () => ({ data: singleData, error }));
  return chain;
}

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
  })),
}));

function buildRequest() {
  return new Request('http://localhost/api/pro/stripe/remediation', {
    method: 'POST',
    headers: { origin: 'https://book-n-pay-next.vercel.app' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  chains = {};
  chains.business_settings = makeChain([], { stripe_account_id: 'acct_test_1' });
  authProfile = { biz_id: 'biz-1', role: 'pro' };
  mockGetUser.mockResolvedValue({ data: { user: { id: 'pro1', email: 'pro@example.com' } } });
});

describe('POST /api/pro/stripe/remediation', () => {
  it('non authentifié → 401, rien appelé', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const { POST } = await import('@/app/api/pro/stripe/remediation/route');
    const res = await POST(buildRequest() as any);

    expect(res.status).toBe(401);
    expect(mockAccountLinksCreate).not.toHaveBeenCalled();
  });

  it('profil sans biz_id (ex: admin sans business) → 403', async () => {
    authProfile = { biz_id: null, role: 'admin' };

    const { POST } = await import('@/app/api/pro/stripe/remediation/route');
    const res = await POST(buildRequest() as any);

    expect(res.status).toBe(403);
    expect(mockAccountLinksCreate).not.toHaveBeenCalled();
  });

  it('aucun compte Stripe Connect associé → 400', async () => {
    chains.business_settings = makeChain([], { stripe_account_id: null });

    const { POST } = await import('@/app/api/pro/stripe/remediation/route');
    const res = await POST(buildRequest() as any);

    expect(res.status).toBe(400);
    expect(mockAccountLinksCreate).not.toHaveBeenCalled();
  });

  it("cas nominal : accountLinks.create appelé avec type account_onboarding et collection_options exacts, url renvoyée", async () => {
    const { POST } = await import('@/app/api/pro/stripe/remediation/route');
    const res = await POST(buildRequest() as any);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.url).toBe('https://connect.stripe.com/setup/test');
    expect(mockAccountLinksCreate).toHaveBeenCalledWith({
      account: 'acct_test_1',
      type: 'account_onboarding',
      collection_options: { fields: 'currently_due', future_requirements: 'include' },
      refresh_url: 'https://book-n-pay-next.vercel.app/pro',
      return_url: 'https://book-n-pay-next.vercel.app/pro?stripe_return=1',
    });
  });
});
