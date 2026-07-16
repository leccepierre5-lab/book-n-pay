// scripts/audit/vestiges-recon.mjs
// Reconnaissance en lecture seule des vestiges pré-existants avant audit
// fonctionnel 2026-07-16 : comptes @test.local + businesses "Debug %".
// Aucune écriture. Utilise la clé service_role (Admin API pour auth.users,
// PostgREST pour app_users/businesses qui sont bien en schéma public).
//
// Usage :
//   node --env-file=.env.local scripts/audit/vestiges-recon.mjs

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis (via --env-file).');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function listAllAuthUsers() {
  const all = [];
  let page = 1;
  const perPage = 200;
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    all.push(...data.users);
    if (data.users.length < perPage) break;
    page += 1;
  }
  return all;
}

console.log('--- Comptes @test.local ---');
const authUsers = await listAllAuthUsers();
const testLocalUsers = authUsers.filter((u) => (u.email ?? '').endsWith('@test.local'));

if (testLocalUsers.length === 0) {
  console.log('(aucun)');
} else {
  const ids = testLocalUsers.map((u) => u.id);
  const { data: appUsers, error: appUsersErr } = await supabase
    .from('app_users')
    .select('id, role, biz_id')
    .in('id', ids);
  if (appUsersErr) throw appUsersErr;

  const roleById = new Map((appUsers ?? []).map((r) => [r.id, r]));
  for (const u of testLocalUsers) {
    const r = roleById.get(u.id);
    console.log(
      `${u.id}  ${u.email}  role=${r?.role ?? '(pas dans app_users)'}  biz_id=${r?.biz_id ?? '-'}  created_at=${u.created_at}`
    );
  }
}

console.log('\n--- Businesses "Debug %" ---');
const { data: debugBiz, error: debugBizErr } = await supabase
  .from('businesses')
  .select('id, name, owner_id, created_at')
  .ilike('name', 'Debug %')
  .order('name');
if (debugBizErr) throw debugBizErr;

if (!debugBiz || debugBiz.length === 0) {
  console.log('(aucun)');
} else {
  for (const b of debugBiz) {
    console.log(`${b.id}  ${b.name}  owner_id=${b.owner_id}  created_at=${b.created_at}`);
  }
}
