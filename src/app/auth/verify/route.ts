import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const token_hash = searchParams.get('token_hash');
  const type = searchParams.get('type');

  if (token_hash && type === 'signup') {
    // Même pattern que /auth/callback : créer la response AVANT le client Supabase
    // pour que setAll puisse attacher les cookies de session directement dessus.
    const response = NextResponse.redirect(new URL('/recherche', origin));

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
            cookiesToSet.forEach(({ name, value, options }) => {
              request.cookies.set(name, value);
              response.cookies.set(name, value, options);
            });
          },
        },
      }
    );

    // verifyOtp avec token_hash est 100% server-side, pas de PKCE requis.
    // C'est la seule méthode compatible avec les tokens générés par admin.generateLink().
    const { error } = await supabase.auth.verifyOtp({
      type: 'signup',
      token_hash,
    });

    if (!error) {
      return response;
    }
    console.error('[auth/verify] verifyOtp error:', error.message);
  }

  return NextResponse.redirect(new URL('/connexion?error=lien_invalide', origin));
}
