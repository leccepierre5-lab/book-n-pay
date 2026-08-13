// src/lib/auth-errors.ts
// Traduit les messages d'erreur GoTrue (Supabase Auth) en français. Ces
// messages viennent directement du SDK client (supabase.auth.signInWithPassword)
// sur les 2 seuls écrans qui l'appellent en direct (LoginForm, AuthWall) — les
// autres routes passent déjà par un handler serveur qui répond en français
// (voir lib/api-error.ts). Fallback volontairement générique plutôt que
// d'afficher le texte brut d'un cas non mappé.
const KNOWN_ERRORS: { pattern: RegExp; message: string }[] = [
  { pattern: /invalid login credentials/i, message: 'Email ou mot de passe incorrect.' },
  { pattern: /email not confirmed/i, message: 'Merci de confirmer votre email avant de vous connecter (vérifiez votre boîte de réception).' },
  { pattern: /user already registered/i, message: 'Ce compte existe déjà.' },
  { pattern: /password should be at least/i, message: 'Le mot de passe doit contenir au moins 6 caractères.' },
  { pattern: /rate limit/i, message: 'Trop de tentatives — réessayez dans quelques minutes.' },
  { pattern: /network|fetch failed|failed to fetch/i, message: 'Problème de connexion — réessayez.' },
];

export function translateAuthError(rawMessage: string | null | undefined): string {
  if (!rawMessage) return 'Une erreur est survenue. Réessayez.';
  const known = KNOWN_ERRORS.find((entry) => entry.pattern.test(rawMessage));
  return known ? known.message : 'Une erreur est survenue. Réessayez.';
}
