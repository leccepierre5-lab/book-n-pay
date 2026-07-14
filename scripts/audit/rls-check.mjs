// scripts/audit/rls-check.mjs
// Bloc 1 — preuve d'exécution RLS : interroge Supabase avec la clé ANON
// publique (celle exposée au navigateur) et vérifie table par table ce
// qu'un visiteur non authentifié peut réellement lire.
//
// Lecture seule : uniquement des GET (select) via l'API REST PostgREST.
// Aucune écriture, aucune donnée modifiée.
//
// Usage :
//   node --env-file="<chemin vers .env.local du repo principal>" scripts/audit/rls-check.mjs

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !ANON_KEY) {
  console.error('NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_ANON_KEY requis (via --env-file).');
  process.exit(1);
}

// Attendu déduit de supabase/migrations/0022_rls_snapshot.sql (+ 0014, 0032
// pour staff_schedules/staff_absences, self-contained RLS) :
//   'public'    → SELECT public intentionnel (catalogue affiché aux visiteurs)
//   'private'   → doit renvoyer 0 ligne pour un visiteur anonyme
//   'unknown'   → policy dépend d'une fonction non versionnée (check_booking_access) — à vérifier manuellement
const TABLES = [
  ['app_config', 'public'],
  ['app_users', 'private'],
  ['booking_logs', 'private'],
  ['booking_members', 'unknown'],
  ['bookings', 'private'],
  ['business_photos', 'public'],
  ['business_review_items', 'public'],
  ['business_reviews', 'public'],
  ['business_settings', 'private'],
  ['businesses', 'public'],
  ['chat_messages', 'private'],
  ['favorites', 'private'],
  ['flash_slots', 'public'],
  ['overage_charges', 'private'],
  ['partner_applications', 'private'],
  ['profiles', 'private'],
  ['rate_limits', 'private'],
  ['referral_events', 'private'],
  ['services', 'public'],
  ['staff', 'public'],
  ['staff_schedules', 'public'],
  ['staff_absences', 'public'],
];

function verdict(expected, status, rowCount) {
  if (status >= 400) {
    // PostgREST renvoie une erreur si la table n'existe pas / pas de grant du tout.
    return expected === 'private' ? '✅ bloqué (erreur API)' : `⚠️ erreur inattendue sur table publique (HTTP ${status})`;
  }
  if (expected === 'public') {
    return rowCount > 0 ? '✅ public (attendu)' : 'ℹ️ 0 ligne (table vide ou catalogue vide, pas un trou)';
  }
  if (expected === 'private') {
    return rowCount === 0 ? '✅ bloqué (0 ligne renvoyée)' : `🔴 TROU — ${rowCount} ligne(s) visibles par anon`;
  }
  return rowCount === 0
    ? 'ℹ️ 0 ligne — cohérent avec un accès bloqué, mais fonction non versionnée : à revérifier manuellement'
    : `⚠️ ${rowCount} ligne(s) visibles — dépend de check_booking_access(), non versionnée : vérifier si attendu`;
}

async function checkTable(table) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?select=*&limit=5`;
  const res = await fetch(url, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
  });
  let rows = [];
  try {
    rows = await res.json();
  } catch {
    rows = [];
  }
  const rowCount = Array.isArray(rows) ? rows.length : 0;
  return { status: res.status, rowCount, error: Array.isArray(rows) ? null : rows };
}

const results = [];
for (const [table, expected] of TABLES) {
  const { status, rowCount, error } = await checkTable(table);
  results.push({ table, expected, status, rowCount, verdict: verdict(expected, status, rowCount), error });
}

console.log('\n=== Bloc 1 — RLS en prod, lu via clé anon publique ===\n');
console.log(`Supabase project: ${SUPABASE_URL}\n`);
const colWidth = Math.max(...results.map((r) => r.table.length)) + 2;
for (const r of results) {
  console.log(
    `${r.table.padEnd(colWidth)} HTTP ${r.status}  lignes=${String(r.rowCount).padEnd(2)}  ${r.verdict}`
  );
  if (r.error && r.status >= 400) console.log(`   → ${JSON.stringify(r.error).slice(0, 150)}`);
}

const holes = results.filter((r) => r.verdict.startsWith('🔴'));
console.log(`\n${holes.length} trou(s) détecté(s) sur ${results.length} tables testées.`);
if (holes.length) {
  console.log('Tables en trou :', holes.map((h) => h.table).join(', '));
}
