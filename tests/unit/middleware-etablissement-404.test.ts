// src/proxy.ts (renommé depuis middleware.ts, Next 16.3 — voir codemod
// middleware-to-proxy) — soft-404 sur /etablissement/[slug] (audit SEO
// 11/08). Le composant de page lève déjà notFound() correctement (contenu
// "Page introuvable"), mais src/app/loading.tsx (racine, toutes les routes)
// fait streamer un premier flush HTTP 200 avant que React n'atteigne ce
// notFound() — status non corrigeable a posteriori depuis la page (vérifié
// en conditions réelles : ni page.tsx ni generateMetadata n'y changent
// rien). Seul le proxy, qui s'exécute avant tout rendu React, peut fixer
// le status. Ces tests prouvent :
// 1. Toute route hors /etablissement/[slug] n'est pas concernée (pas de
//    requête business, laisse passer normalement).
// 2. Slug inexistant → 404.
// 3. Fiche démo (owner_id NULL) pour un visiteur non-testeur → 404.
// 4. Même fiche démo pour un testeur whitelisté (DEMO_TESTER_EMAILS) →
//    laisse passer (comportement de démonstration préservé).
// 5. Vrai business (owner_id non-null, pas une fixture) → laisse passer.
// 6. Fixture pro (owner_id non-null MAIS slug fixture-pro-*) pour un
//    visiteur non-testeur → 404, même règle que isTesterOnlyBusiness.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

let mockGetUser = vi.fn(async (): Promise<{ data: { user: { email: string } | null } }> => ({
  data: { user: null },
}));
let businessRow: { slug: string; owner_id: string | null } | null = null;
const mockMaybeSingle = vi.fn(async () => ({ data: businessRow }));

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(() => ({
    auth: { getUser: () => mockGetUser() },
    from: (table: string) => {
      if (table !== 'businesses') throw new Error('unexpected table on proxy client: ' + table);
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => mockMaybeSingle(),
          }),
        }),
      };
    },
  })),
}));

function buildRequest(pathname: string) {
  return new NextRequest(new Request(`https://book-n-pay-next.vercel.app${pathname}`));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser = vi.fn(async () => ({ data: { user: null } }));
  businessRow = null;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
  process.env.DEMO_TESTER_EMAILS = 'tester@example.com';
});

describe('proxy — soft-404 /etablissement/[slug]', () => {
  it('route non concernée (/recherche) → laisse passer, aucune requête business', async () => {
    const { proxy } = await import('@/proxy');
    const res = await proxy(buildRequest('/recherche') as any);

    expect(res.status).toBe(200);
    expect(mockMaybeSingle).not.toHaveBeenCalled();
  });

  it('slug inexistant → 404', async () => {
    businessRow = null;
    const { proxy } = await import('@/proxy');
    const res = await proxy(buildRequest('/etablissement/ce-slug-nexiste-pas') as any);

    expect(res.status).toBe(404);
  });

  it('fiche démo (owner_id NULL), visiteur non-testeur → 404', async () => {
    businessRow = { slug: 'demo-xyz', owner_id: null };
    const { proxy } = await import('@/proxy');
    const res = await proxy(buildRequest('/etablissement/demo-xyz') as any);

    expect(res.status).toBe(404);
  });

  it('fiche démo, visiteur testeur whitelisté (DEMO_TESTER_EMAILS) → laisse passer', async () => {
    businessRow = { slug: 'demo-xyz', owner_id: null };
    mockGetUser = vi.fn(async () => ({ data: { user: { email: 'tester@example.com' } } }));
    const { proxy } = await import('@/proxy');
    const res = await proxy(buildRequest('/etablissement/demo-xyz') as any);

    expect(res.status).toBe(200);
  });

  it('vrai business (owner_id non-null, pas une fixture) → laisse passer', async () => {
    businessRow = { slug: 'salon-reel', owner_id: 'owner-1' };
    const { proxy } = await import('@/proxy');
    const res = await proxy(buildRequest('/etablissement/salon-reel') as any);

    expect(res.status).toBe(200);
  });

  it('fixture pro (owner_id non-null MAIS slug fixture-pro-*), visiteur non-testeur → 404', async () => {
    businessRow = { slug: 'fixture-pro-audit', owner_id: 'owner-2' };
    const { proxy } = await import('@/proxy');
    const res = await proxy(buildRequest('/etablissement/fixture-pro-audit') as any);

    expect(res.status).toBe(404);
  });
});
