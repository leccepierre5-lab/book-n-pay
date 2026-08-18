// scripts/audit/create-fixture-client.mjs
// Crée le compte fixture client permanent (aucun app_users.role='client'
// n'existait avant ce script — les 13 fixtures existantes sont toutes des
// pros, voir scripts/audit/RAPPORT.md). Sert à tester les parcours client
// authentifiés (réservation, groupe, fidélité) sans jamais saisir de mot de
// passe : voir scripts/audit/passwordless-login-link.mjs pour la connexion.
//
// Mot de passe généré aléatoirement et jamais affiché ni loggué — inutile,
// la connexion se fait uniquement via lien recovery (service_role).
//
// Numéro de téléphone 0699999999 : format valide (voir isValidPhoneFormat),
// motif volontairement reconnaissable (répétition de 9), vérifié absent de
// la base au moment de l'écriture de ce script (0 ligne app_users.phone).
//
// Usage : node --env-file=.env.local scripts/audit/create-fixture-client.mjs

import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

// Recopié depuis src/lib/legal.ts (CGU_VERSION) — pas d'import cross TS/mjs
// dans ce repo, aucun autre script ne le fait. Si ce script échoue plus tard
// sur une contrainte liée à la version CGU, vérifier que cette valeur est
// toujours synchro avec src/lib/legal.ts avant de creuser ailleurs.
const CGU_VERSION = '2026-08-2';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis (via --env-file, jamais en dur).');
  process.exit(1);
}

const EMAIL = 'fixture-client-audit@book-n-pay.invalid';
const PHONE = '0699999999';
const NAME = '[FIXTURE PERMANENTE] Client Audit';

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: phoneOwner } = await supabase
  .from('app_users')
  .select('id')
  .eq('phone', PHONE)
  .maybeSingle();
if (phoneOwner) {
  console.error(`Refus : ${PHONE} est déjà utilisé par un autre compte (id=${phoneOwner.id}).`);
  process.exit(1);
}

const { data: created, error: createError } = await supabase.auth.admin.createUser({
  email: EMAIL,
  password: randomUUID(),
  email_confirm: true,
  user_metadata: { name: NAME, phone: PHONE },
});
if (createError) {
  console.error('Erreur createUser:', createError.message);
  process.exit(1);
}
console.log('Compte auth créé:', created.user.id);

// Le trigger handle_new_user (migration 0010) insère déjà app_users avec
// role='client' par défaut — on complète juste l'acceptation CGU pour ne
// pas bloquer les parcours qui la vérifient (ex. stripe/checkout).
const { error: updateError } = await supabase
  .from('app_users')
  .update({ cgu_accepted_at: new Date().toISOString(), cgu_version: CGU_VERSION })
  .eq('id', created.user.id);
if (updateError) {
  console.error('Erreur update app_users (CGU):', updateError.message);
  process.exit(1);
}

console.log(`Fixture client créée : ${EMAIL} (id=${created.user.id}, phone=${PHONE})`);
console.log('Connexion : node scripts/audit/passwordless-login-link.mjs ' + EMAIL);
