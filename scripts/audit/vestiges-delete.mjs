// scripts/audit/vestiges-delete.mjs
// Suppression des vestiges pré-existants confirmés orphelins par
// vestiges-recon.mjs / vestiges-refs.mjs le 16/07/2026 (voir
// docs/test-sessions/vestiges-pre-audit-2026-07-16.md) : 2 businesses
// "Debug %" + 4 comptes @test.local. Ciblage par ID exact (pas de pattern).
// Ordre : businesses -> app_users -> auth.users (Admin API, jamais DELETE
// SQL brut sur auth.users).
//
// Usage :
//   node --env-file=.env.local scripts/audit/vestiges-delete.mjs

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const BIZ_IDS = ['17f56f95-5388-450b-aa44-2b5fc85f5c97', 'a98731eb-f3dc-4907-8395-567fd923fdd2'];
const USER_IDS = [
  '7618472c-24e2-4236-ba61-06dec61b859a',
  '3690923b-6d93-419b-8fec-d346a19ab0e0',
  'b31d794f-3eb1-4539-af6a-601bd1b1bd1c',
  '972afab2-333b-4f24-b847-b00cf8eac04a',
];

console.log('1. DELETE businesses...');
const { error: bizErr, count: bizCount } = await supabase
  .from('businesses')
  .delete({ count: 'exact' })
  .in('id', BIZ_IDS);
if (bizErr) throw bizErr;
console.log(`   -> ${bizCount} ligne(s) supprimée(s)`);

console.log('2. DELETE app_users...');
const { error: appUsersErr, count: appUsersCount } = await supabase
  .from('app_users')
  .delete({ count: 'exact' })
  .in('id', USER_IDS);
if (appUsersErr) throw appUsersErr;
console.log(`   -> ${appUsersCount} ligne(s) supprimée(s)`);

console.log('3. DELETE auth.users (Admin API, un par un)...');
for (const id of USER_IDS) {
  const { error } = await supabase.auth.admin.deleteUser(id);
  if (error) {
    console.log(`   -> ${id} ERREUR: ${error.message}`);
  } else {
    console.log(`   -> ${id} supprimé`);
  }
}

console.log('\nTerminé.');
