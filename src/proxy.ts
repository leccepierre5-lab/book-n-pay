import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { isDemoTesterEmail } from '@/lib/demo-mode';
import { isTesterOnlyBusiness } from '@/lib/business-helpers';

// Audit SEO 11/08 : /etablissement/[slug] répondait HTTP 200 (soft-404) pour
// toute fiche démo/slug inexistant, confirmé en prod (curl direct sur
// www.book-n-pay.com). Cause réelle, vérifiée en local par élimination : ce
// n'est PAS le loading.tsx du segment (retiré en test, aucun effet) mais
// src/app/loading.tsx (RACINE, s'applique à toutes les routes) qui fait
// streamer un premier flush HTTP 200 dès que le rendu React devient
// asynchrone — une fois ce flush parti, aucun notFound() plus profond dans
// l'arbre (page.tsx ni même generateMetadata, testés tous les deux) ne peut
// plus corriger le status a posteriori. C'est une limite du streaming SSR de
// l'App Router, pas un bug localisé à corriger côté page — seule la couche
// AVANT le rendu React peut fixer le status indépendamment de ce que React
// décide de rendre ensuite, d'où le fix ici plutôt que dans page.tsx.
const ETABLISSEMENT_SLUG_RE = /^\/etablissement\/([^/]+)\/?$/;

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: object }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Valide et rafraîchit le token si expiré — ne pas supprimer.
  const { data: authData } = await supabase.auth.getUser();

  // Rejoue EXACTEMENT la même règle d'éligibilité que le composant de page
  // (isTesterOnlyBusiness/isDemoTesterEmail, business-helpers.ts + demo-mode.ts)
  // — si cette règle change un jour, la changer aussi ici. Le composant de
  // page GARDE son propre notFound() (contenu "Page introuvable" toujours
  // correct, déjà vérifié) ; ce bloc ne fait que forcer le status HTTP en
  // amont via NextResponse.rewrite(..., { status }), Next.js laisse quand
  // même la page s'exécuter normalement ensuite pour produire le contenu.
  // Scope strict à ce seul pattern d'URL : une requête DB supplémentaire par
  // requête serait un coût inutile sur les ~99% de trafic qui ne concerne
  // pas cette route.
  const etablissementMatch = request.nextUrl.pathname.match(ETABLISSEMENT_SLUG_RE);
  if (etablissementMatch) {
    const slug = decodeURIComponent(etablissementMatch[1]);
    const { data: business } = await supabase
      .from('businesses')
      .select('slug, owner_id')
      .eq('slug', slug)
      .maybeSingle();

    const isDemoTester = isDemoTesterEmail(authData.user?.email);
    if (!business || (isTesterOnlyBusiness(business) && !isDemoTester)) {
      const notFoundResponse = NextResponse.rewrite(request.nextUrl, { status: 404 });
      supabaseResponse.cookies.getAll().forEach((c) => notFoundResponse.cookies.set(c));
      return notFoundResponse;
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
