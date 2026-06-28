import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const token_hash = searchParams.get('token_hash');
  const type = searchParams.get('type');

  const ALLOWED_TYPES = ['signup', 'recovery'] as const;
  type AllowedType = typeof ALLOWED_TYPES[number];

  if (token_hash && type && (ALLOWED_TYPES as readonly string[]).includes(type)) {
    const redirectDest = type === 'recovery'
      ? new URL('/mon-compte?reset=1', origin)
      : new URL('/recherche', origin);

    const response = NextResponse.redirect(redirectDest);

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

    const { error } = await supabase.auth.verifyOtp({
      type: type as AllowedType,
      token_hash,
    });

    if (!error) {
      return response;
    }
    console.error('[auth/verify] verifyOtp error:', error.message);
  }

  return NextResponse.redirect(new URL('/connexion?error=lien_invalide', origin));
}
