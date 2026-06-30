import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const token_hash = searchParams.get('token_hash');
  const type = searchParams.get('type');

  const ALLOWED_TYPES = ['signup', 'recovery'] as const;
  type AllowedType = typeof ALLOWED_TYPES[number];

  if (!token_hash || !type || !(ALLOWED_TYPES as readonly string[]).includes(type)) {
    return NextResponse.redirect(new URL('/connexion?error=lien_invalide', origin));
  }

  if (type === 'recovery') {
    const response = NextResponse.redirect(new URL('/mon-compte?reset=1', origin));
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return request.cookies.getAll(); },
          setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
            cookiesToSet.forEach(({ name, value, options }) => {
              request.cookies.set(name, value);
              response.cookies.set(name, value, options);
            });
          },
        },
      }
    );
    const { error } = await supabase.auth.verifyOtp({ type: 'recovery', token_hash });
    if (!error) return response;
    console.error('[auth/verify] verifyOtp error:', error.message);
    return NextResponse.redirect(new URL('/connexion?error=lien_invalide', origin));
  }

  // signup : déterminer la destination selon le rôle
  const defaultDest = new URL('/recherche', origin);
  const response = NextResponse.redirect(defaultDest);

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value);
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  const { error } = await supabase.auth.verifyOtp({ type: 'signup', token_hash });
  if (error) {
    console.error('[auth/verify] verifyOtp error:', error.message);
    return NextResponse.redirect(new URL('/connexion?error=lien_invalide', origin));
  }

  // Session établie — vérifier le rôle pour orienter le pro vers l'onboarding
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: profile } = await supabase
        .from('app_users')
        .select('role')
        .eq('id', user.id)
        .maybeSingle();

      if (profile?.role === 'pro') {
        response.headers.set('Location', new URL('/pro/onboarding', origin).toString());
      }
    }
  } catch {
    // En cas d'erreur de lecture du profil, on redirige vers /recherche par défaut
  }

  return response;
}
