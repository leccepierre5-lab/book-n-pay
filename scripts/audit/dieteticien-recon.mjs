// scripts/audit/dieteticien-recon.mjs
// Reconnaissance en lecture seule avant suppression des 49 fiches démo
// 'sante'/'dieteticien' (décision Pierre 11/08, retrait diététicien —
// titre protégé). Vérifie : owner_id non-null, bookings, favorites, et
// toute autre table référençant biz_id, avant de considérer la suppression
// sûre. Aucune écriture.
//
// Usage :
//   node --env-file=.env.local scripts/audit/dieteticien-recon.mjs

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

const { data: biz, error: bizErr } = await supabase
  .from('businesses')
  .select('id, name, slug, owner_id, category, type, is_published, frozen')
  .eq('category', 'sante')
  .eq('type', 'dieteticien')
  .order('slug');
if (bizErr) throw bizErr;

console.log(`--- Fiches sante/dieteticien trouvées : ${biz?.length ?? 0} ---`);

const nonNullOwner = (biz ?? []).filter((b) => b.owner_id !== null);
console.log(`owner_id non-null : ${nonNullOwner.length}`);
if (nonNullOwner.length > 0) {
  console.log(nonNullOwner.map((b) => `  ${b.slug} owner_id=${b.owner_id}`).join('\n'));
}

if (!biz || biz.length === 0) {
  console.log('Rien à vérifier plus loin.');
  process.exit(0);
}

const bizIds = biz.map((b) => b.id);

async function countByBizId(table, col = 'biz_id') {
  const { count, error } = await supabase
    .from(table)
    .select('*', { count: 'exact', head: true })
    .in(col, bizIds);
  if (error) {
    console.log(`  [${table}] erreur : ${error.message}`);
    return null;
  }
  return count;
}

const tables = [
  'bookings',
  'services',
  'staff',
  'favorites',
  'business_reviews',
  'business_photos',
  'business_locations',
  'business_settings',
  'flash_slots',
  'chat_messages',
];

console.log('\n--- Références par biz_id, sur ces 49 fiches ---');
for (const t of tables) {
  const n = await countByBizId(t);
  console.log(`  ${t}: ${n}`);
}

// bookings référence aussi service_id — vérifier qu'aucun booking n'existe
// via un service appartenant à ces business, même si biz_id devrait suffire
// (biz_id est posé directement sur bookings, pas seulement via service_id).
console.log('\nTerminé. Lecture seule, rien modifié.');
