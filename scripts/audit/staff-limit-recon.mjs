// scripts/audit/staff-limit-recon.mjs
// Lecture seule — liste par business le nombre de staff actifs vs le plan
// souscrit, pour vérifier si des business existants dépasseraient les
// limites envisagées (Starter=1, Business=3, Scale=illimité).
//
// Usage :
//   node --env-file=.env.local scripts/audit/staff-limit-recon.mjs

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const LIMITS = { starter: 1, business: 3, scale: Infinity };

const { data: staffRows, error: staffErr } = await supabase
  .from('staff')
  .select('id, biz_id, is_active');
if (staffErr) throw staffErr;

const { data: businesses, error: bizErr } = await supabase
  .from('businesses')
  .select('id, name, slug, owner_id, business_settings(plan_key)');
if (bizErr) throw bizErr;

const activeCountByBiz = new Map();
for (const s of staffRows ?? []) {
  if (!s.is_active) continue;
  activeCountByBiz.set(s.biz_id, (activeCountByBiz.get(s.biz_id) ?? 0) + 1);
}

console.log(`Total business : ${businesses?.length ?? 0}`);
console.log(`Total staff actifs (tous business confondus) : ${[...activeCountByBiz.values()].reduce((a, b) => a + b, 0)}`);
console.log('');

let overCount = 0;
for (const biz of businesses ?? []) {
  const count = activeCountByBiz.get(biz.id) ?? 0;
  if (count === 0) continue;
  const planKey = biz.business_settings?.[0]?.plan_key ?? biz.business_settings?.plan_key ?? 'starter';
  const limit = LIMITS[planKey] ?? 1;
  const over = count > limit;
  if (over) overCount++;
  console.log(
    `${over ? '⚠️ DÉPASSE' : '  ok'} | ${biz.name} (${biz.slug}) owner_id=${biz.owner_id ?? 'null'} | plan=${planKey} limite=${limit === Infinity ? '∞' : limit} | staff_actifs=${count}`
  );
}

console.log('');
console.log(`Business qui dépasseraient la limite envisagée : ${overCount}`);
