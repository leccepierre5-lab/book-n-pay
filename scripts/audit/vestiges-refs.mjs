// scripts/audit/vestiges-refs.mjs
// Lecture seule : compte les lignes référençant les 2 businesses "Debug %"
// et les 4 comptes @test.local dans toutes les tables candidates, pour
// construire un DELETE dans le bon ordre enfants→parents.
//
// Usage :
//   node --env-file=.env.local scripts/audit/vestiges-refs.mjs

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

async function countBy(table, column, values) {
  const { count, error } = await supabase
    .from(table)
    .select(column, { count: 'exact', head: true })
    .in(column, values);
  if (error) return `ERREUR ${JSON.stringify(error)}`;
  return count;
}

const checks = [
  ['staff', 'biz_id', BIZ_IDS],
  ['staff_schedules', 'biz_id', BIZ_IDS],
  ['staff_absences', 'biz_id', BIZ_IDS],
  ['business_photos', 'biz_id', BIZ_IDS],
  ['business_settings', 'biz_id', BIZ_IDS],
  ['business_reviews', 'biz_id', BIZ_IDS],
  ['business_review_items', 'biz_id', BIZ_IDS],
  ['services', 'biz_id', BIZ_IDS],
  ['flash_slots', 'biz_id', BIZ_IDS],
  ['overage_charges', 'biz_id', BIZ_IDS],
  ['bookings', 'biz_id', BIZ_IDS],
  ['bookings', 'client_id', USER_IDS],
  ['app_users', 'id', USER_IDS],
  ['favorites', 'user_id', USER_IDS],
];

console.log('table | colonne | count (businesses Debug)');
for (const [table, column, values] of checks) {
  const n = await countBy(table, column, values);
  console.log(`${table}.${column} -> ${n}`);
}
