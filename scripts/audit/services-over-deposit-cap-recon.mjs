// scripts/audit/services-over-deposit-cap-recon.mjs
// Liste en lecture seule les services déjà en base avec un dépôt > 50€
// (MAX_DEPOSIT_EUROS, src/lib/booking-utils.ts) — le plafond ne contraint
// que les créations/éditions futures, ces services ne sont pas modifiés.
//
// Usage :
//   node --env-file=.env.local scripts/audit/services-over-deposit-cap-recon.mjs

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data, error } = await supabase
  .from('services')
  .select('id, biz_id, name, price, deposit, businesses(name, slug, owner_id)')
  .gt('deposit', 50)
  .order('deposit', { ascending: false });
if (error) throw error;

console.log(`Services avec dépôt > 50€ : ${data?.length ?? 0}`);
for (const s of data ?? []) {
  const biz = s.businesses;
  console.log(`  ${s.name} — deposit=${s.deposit}€ price=${s.price}€ | ${biz?.name} (${biz?.slug}) owner_id=${biz?.owner_id ?? 'null'}`);
}
