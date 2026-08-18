// scripts/audit/passwordless-login-link.mjs
// Génère un lien de connexion à usage unique pour un compte existant (fixture
// ou autre), sans jamais manipuler ni saisir de mot de passe — ni le nôtre,
// ni celui du compte ciblé. Réutilise `type: 'recovery'` de generateLink(),
// exactement le mécanisme déjà en production pour "mot de passe oublié"
// (src/app/api/auth/forgot-password/route.ts, consommé par
// src/app/auth/verify/route.ts qui l'autorise déjà dans ALLOWED_TYPES).
//
// Zéro code nouveau côté app : ce script ne fait qu'appeler une capacité
// Supabase qui existe déjà en prod. La clé service_role peut de toute façon
// déjà tout faire en base (y compris changer un mot de passe) — ceci n'ouvre
// aucune porte qui ne soit déjà ouverte par cette clé.
//
// Le lien ouvre une vraie session (cookies posés par /auth/verify), puis
// redirige vers /mon-compte?reset=1 — sans intérêt pour un test, navigue
// simplement ailleurs une fois le lien visité, la session reste valide.
//
// Usage :
//   node --env-file=.env.local scripts/audit/passwordless-login-link.mjs <email> [baseUrl]
//   baseUrl par défaut : http://localhost:3000 (PAS NEXT_PUBLIC_SITE_URL, qui
//   pointe volontairement vers la prod pour les emails réels — ici on veut
//   quasi toujours coller le lien dans l'onglet du dev local).

import { createClient } from '@supabase/supabase-js';

const [, , email, baseUrlArg] = process.argv;
if (!email) {
  console.error('Usage: node passwordless-login-link.mjs <email> [baseUrl]');
  process.exit(1);
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis (via --env-file, jamais en dur).');
  process.exit(1);
}
const SITE_URL = baseUrlArg || 'http://localhost:3000';

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data, error } = await supabase.auth.admin.generateLink({
  type: 'recovery',
  email,
});
if (error) {
  console.error('Erreur generateLink:', error.message);
  process.exit(1);
}

const { hashed_token } = data.properties;
const url = `${SITE_URL}/auth/verify?token_hash=${hashed_token}&type=recovery`;
console.log(url);
console.log('Lien à usage unique, expiration Supabase par défaut — ne pas archiver, ne pas partager hors de ce terminal.');
