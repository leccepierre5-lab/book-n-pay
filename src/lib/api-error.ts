// src/lib/api-error.ts
// Log complet côté serveur — error.hint est souvent plus parlant que
// error.message pour un PostgrestError (voir
// node_modules/@supabase/postgrest-js/src/PostgrestError.ts) — et réponse
// générique côté client. Ne jamais renvoyer error.message brut à l'appelant :
// ça expose des détails internes (noms de contraintes, colonnes, etc.).
import { NextResponse } from 'next/server';

export function logAndRespond(context: string, error: unknown, status = 500) {
  console.error(context, error);
  return NextResponse.json(
    { error: 'Une erreur est survenue. Merci de réessayer.' },
    { status }
  );
}

// Codes GoTrue qui révèlent qu'un compte existe déjà (email/téléphone/identité) —
// voir node_modules/@supabase/auth-js/dist/module/lib/error-codes.d.ts. Un
// status < 500 ne suffit pas à garantir qu'un message est safe à afficher :
// ces cas précis permettent l'énumération d'emails et doivent rester génériques
// même si le status est un 4xx par ailleurs "propre".
const ENUMERATION_SENSITIVE_CODES = new Set([
  'email_exists',
  'user_already_exists',
  'identity_already_exists',
  'phone_exists',
]);
// Filet de sécurité si `.code` est absent (ancienne version du SDK, erreur
// enveloppée différemment) — même famille de messages, détectés par motif.
const ENUMERATION_SENSITIVE_PATTERN = /already\s+(been\s+)?registered|already\s+exists|already\s+in\s+use|already\s+taken/i;

// GoTrue (Supabase Auth) renvoie des AuthApiError avec un `status` HTTP —
// status < 500 = erreur de validation destinée à l'utilisateur (mot de passe
// faible/compromis, email invalide...), message conçu par Supabase pour être
// affiché tel quel. status >= 500 (ou absent) = panne interne réelle
// ("Database error saving new user" côté trigger, etc.) — jamais à exposer.
// Exception : même en 4xx, un message qui révèle qu'un compte existe déjà
// (voir ENUMERATION_SENSITIVE_*) reste générique — l'appelant qui a besoin de
// cette info (ex: UX "cet email est déjà utilisé") doit la gérer explicitement
// avant d'atteindre ce helper, comme le fait déjà auth/register/route.ts.
export function logAndRespondAuthError(context: string, error: unknown) {
  console.error(context, error);
  const authError = error as { status?: number; message?: string; code?: string } | null;
  const revealsAccountExistence =
    (!!authError?.code && ENUMERATION_SENSITIVE_CODES.has(authError.code)) ||
    (!!authError?.message && ENUMERATION_SENSITIVE_PATTERN.test(authError.message));
  if (
    authError &&
    typeof authError.status === 'number' &&
    authError.status < 500 &&
    authError.message &&
    !revealsAccountExistence
  ) {
    return NextResponse.json({ error: authError.message }, { status: authError.status });
  }
  return NextResponse.json(
    { error: 'Une erreur est survenue. Merci de réessayer.' },
    { status: 500 }
  );
}

// Stripe distingue StripeCardError (carte refusée, fonds insuffisants...) —
// error.message est alors conçu par Stripe pour être montré au payeur — des
// autres types (StripeAPIError, StripeAuthenticationError...) qui sont des
// pannes d'intégration internes, jamais à exposer tel quel.
export function logAndRespondStripeError(context: string, error: unknown) {
  console.error(context, error);
  const stripeError = error as { type?: string; message?: string } | null;
  if (stripeError?.type === 'StripeCardError' && stripeError.message) {
    return NextResponse.json({ error: stripeError.message }, { status: 402 });
  }
  return NextResponse.json(
    { error: 'Une erreur est survenue. Merci de réessayer.' },
    { status: 500 }
  );
}
