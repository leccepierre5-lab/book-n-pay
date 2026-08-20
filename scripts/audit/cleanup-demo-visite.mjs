// scripts/audit/cleanup-demo-visite.mjs
//
// Nettoyage COMPLET des comptes de démonstration commerciale
// (prepare-demo-visite.mjs) — supprime l'établissement démo (slug
// fixture-pro-demo-visite), ses prestations, toutes ses réservations, et les
// TROIS comptes (demo-pro, demo-client, demo-client-2), auth + app_users.
//
// À NE PAS confondre avec la remise à zéro entre deux visites : relancer
// prepare-demo-visite.mjs suffit pour ça (il purge et recrée déjà les
// réservations). Ce script-ci est la sortie définitive du dispositif —
// à n'utiliser que si la démo commerciale est abandonnée pour de bon.
//
// Les 1000 fiches génériques (supabase/seed/demo_businesses.sql) ne sont
// JAMAIS touchées ici.
//
// Usage : node --env-file=.env.local scripts/audit/cleanup-demo-visite.mjs

import { createClient } from '@supabase/supabase-js';

const BIZ_SLUG = 'fixture-pro-demo-visite';
const EMAILS = ['demo-pro@book-n-pay.invalid', 'demo-client@book-n-pay.invalid', 'demo-client-2@book-n-pay.invalid'];

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis (via --env-file, jamais en dur).');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: biz } = await supabase.from('businesses').select('id').eq('slug', BIZ_SLUG).maybeSingle();

if (biz) {
  const { data: bookings } = await supabase.from('bookings').select('id').eq('biz_id', biz.id);
  const bookingIds = (bookings || []).map((b) => b.id);
  if (bookingIds.length > 0) {
    await supabase.from('booking_members').delete().in('booking_id', bookingIds);
    await supabase.from('booking_logs').delete().in('booking_id', bookingIds);
    await supabase.from('bookings').delete().in('id', bookingIds);
    console.log(`${bookingIds.length} réservation(s) supprimée(s)`);
  }
  await supabase.from('services').delete().eq('biz_id', biz.id);
  await supabase.from('business_locations').delete().eq('biz_id', biz.id);
  await supabase.from('business_settings').delete().eq('biz_id', biz.id);
  await supabase.from('businesses').delete().eq('id', biz.id);
  console.log(`Établissement démo supprimé (${biz.id})`);
} else {
  console.log('Aucun établissement démo trouvé (déjà nettoyé ?)');
}

async function findAuthUserByEmail(email) {
  let page = 1;
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const found = data.users.find((u) => u.email === email);
    if (found) return found;
    if (data.users.length < 200) return null;
    page += 1;
  }
}

for (const email of EMAILS) {
  const user = await findAuthUserByEmail(email);
  if (!user) {
    console.log(`${email} — déjà absent`);
    continue;
  }
  // app_users est supprimé en cascade par la contrainte FK sur auth.users
  // (même mécanisme que les autres suppressions de compte du repo) —
  // supprimer le compte auth suffit.
  const { error } = await supabase.auth.admin.deleteUser(user.id);
  if (error) {
    console.error(`Erreur suppression ${email}:`, error.message);
    continue;
  }
  console.log(`${email} supprimé (${user.id})`);
}

console.log('');
console.log('Nettoyage terminé. Rappel : penser à retirer les deux adresses de DEMO_TESTER_EMAILS si le dispositif est définitivement abandonné.');
