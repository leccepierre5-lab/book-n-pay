// scripts/audit/dieteticien-delete.mjs
// Suppression des 49 fiches démo 'sante'/'dieteticien' (décision Pierre 11/08 —
// diététicien = titre protégé, retiré du périmètre). Recon préalable
// (dieteticien-recon.mjs) : owner_id null partout, 0 booking, 0 favori, 0 avis,
// 0 staff, 0 slug référencé ailleurs — seuls 147 services rattachés (3 x 49,
// attendu). Suppression explicite en 2 temps (services puis businesses),
// sans compter sur un cascade FK non vérifié.
//
// Usage :
//   node --env-file=.env.local scripts/audit/dieteticien-delete.mjs

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
  .select('id, slug, owner_id')
  .eq('category', 'sante')
  .eq('type', 'dieteticien');
if (bizErr) throw bizErr;

if (!biz || biz.length === 0) {
  console.log('Aucune fiche sante/dieteticien trouvée — rien à faire.');
  process.exit(0);
}

if (biz.some((b) => b.owner_id !== null)) {
  console.error('STOP : au moins un owner_id non-null détecté depuis le recon — relancer dieteticien-recon.mjs.');
  process.exit(1);
}

const bizIds = biz.map((b) => b.id);
console.log(`${bizIds.length} fiches à supprimer.`);

const { error: svcDelErr, count: svcCount } = await supabase
  .from('services')
  .delete({ count: 'exact' })
  .in('biz_id', bizIds);
if (svcDelErr) throw svcDelErr;
console.log(`services supprimés : ${svcCount}`);

const { error: bizDelErr, count: bizCount } = await supabase
  .from('businesses')
  .delete({ count: 'exact' })
  .in('id', bizIds);
if (bizDelErr) throw bizDelErr;
console.log(`businesses supprimés : ${bizCount}`);

const { count: remaining } = await supabase
  .from('businesses')
  .select('id', { count: 'exact', head: true })
  .eq('category', 'sante')
  .eq('type', 'dieteticien');
console.log(`Vérification post-suppression — fiches sante/dieteticien restantes : ${remaining}`);
