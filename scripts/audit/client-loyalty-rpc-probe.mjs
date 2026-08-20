// scripts/audit/client-loyalty-rpc-probe.mjs
// Preuve par appel réel (pas juste lecture de la migration 0062) que
// get_client_loyalty_for_pro(p_phone) respecte la même règle d'éligibilité
// que booking_members_select (check_booking_access) : un pro qui a une
// réservation réelle avec ce téléphone obtient les 4 colonnes fidélité, un
// pro qui n'en a aucune n'obtient rien — même s'il connaît le téléphone.
//
// Utilise exclusivement fixture-client-audit + 2 fixtures pro (jamais de
// vraie donnée) : fixture-pro-audit (a un booking jetable avec le fixture
// client, créé puis supprimé par ce script) et fixture-pro-coiffure (n'a
// jamais eu de booking avec ce client — sert de cas négatif). Connexion par
// lien recovery (jamais de mot de passe saisi), même pattern que
// check-booking-access-format-drift-probe.mjs.
//
// Usage : node --env-file=.env.local scripts/audit/client-loyalty-rpc-probe.mjs

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const CLIENT_EMAIL = 'fixture-client-audit@book-n-pay.invalid';
const PRO_WITH_BOOKING_SLUG = 'fixture-pro-audit';
const PRO_WITHOUT_BOOKING_SLUG = 'fixture-pro-coiffure';

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

let failures = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? 'OK ' : 'FAIL'} ${label} — attendu ${JSON.stringify(expected)}, obtenu ${JSON.stringify(actual)}`);
}

async function signInAs(email) {
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({ type: 'recovery', email });
  if (linkErr) throw new Error(`generateLink(${email}): ${linkErr.message}`);
  const anon = createClient(SUPABASE_URL, ANON_KEY);
  const { data: otpData, error: otpErr } = await anon.auth.verifyOtp({
    type: 'recovery',
    token_hash: linkData.properties.hashed_token,
  });
  if (otpErr) throw new Error(`verifyOtp(${email}): ${otpErr.message}`);
  return createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${otpData.session.access_token}` } },
  });
}

const { data: fixtureAuthList } = await admin.auth.admin.listUsers();
const clientAuth = fixtureAuthList.users.find((u) => u.email === CLIENT_EMAIL);
if (!clientAuth) { console.error(`${CLIENT_EMAIL} introuvable — voir create-fixture-client.mjs`); process.exit(1); }

const { data: clientUser } = await admin.from('app_users').select('phone').eq('id', clientAuth.id).single();
const CLIENT_PHONE = clientUser.phone;
console.log(`fixture client phone = ${CLIENT_PHONE}`);

const { data: bizWithBooking } = await admin.from('businesses').select('id, name').eq('slug', PRO_WITH_BOOKING_SLUG).single();
const { data: service } = await admin.from('services').select('id, name, deposit').eq('biz_id', bizWithBooking.id).limit(1).single();

const { data: booking, error: bookingErr } = await admin
  .from('bookings')
  .insert({
    biz_id: bizWithBooking.id, service_id: service.id, biz_name: bizWithBooking.name, service_name: service.name,
    date: '2099-06-20', time: '11:00:00', status: 'active', is_demo: true,
  })
  .select('id')
  .single();
if (bookingErr) { console.error('création booking jetable:', bookingErr.message); process.exit(1); }

const { error: memberErr } = await admin.from('booking_members').insert({
  booking_id: booking.id, name: 'Probe loyalty RPC jetable', phone: CLIENT_PHONE, status: 'paid', deposit: service.deposit, is_demo: true,
});
if (memberErr) { console.error('création booking_member jetable:', memberErr.message); process.exit(1); }

try {
  // Sens 1 : le pro qui a un booking réel avec ce client obtient les données.
  const authedWithBooking = await signInAs(`${PRO_WITH_BOOKING_SLUG}@book-n-pay.invalid`);
  const withBooking = await authedWithBooking.rpc('get_client_loyalty_for_pro', { p_phone: CLIENT_PHONE });
  console.log('Pro AVEC booking — réponse brute:', withBooking.data, withBooking.error?.message || '');
  check('pro avec booking : ligne renvoyée', Array.isArray(withBooking.data) && withBooking.data.length === 1, true);

  // Sens 2 : un pro qui n'a jamais eu de booking avec ce client n'obtient rien,
  // même en connaissant le téléphone exact.
  const authedWithoutBooking = await signInAs(`${PRO_WITHOUT_BOOKING_SLUG}@book-n-pay.invalid`);
  const withoutBooking = await authedWithoutBooking.rpc('get_client_loyalty_for_pro', { p_phone: CLIENT_PHONE });
  console.log('Pro SANS booking — réponse brute:', withoutBooking.data, withoutBooking.error?.message || '');
  check('pro sans booking : aucune ligne renvoyée', Array.isArray(withoutBooking.data) && withoutBooking.data.length === 0, true);

  // Cas limite : téléphone brut ("0X") transmis au lieu du format normalisé
  // stocké — la fonction doit normaliser en interne (exigence 2).
  const rawPhone = CLIENT_PHONE.startsWith('+33') ? '0' + CLIENT_PHONE.slice(3) : CLIENT_PHONE;
  const rawFormat = await authedWithBooking.rpc('get_client_loyalty_for_pro', { p_phone: rawPhone });
  console.log(`Pro AVEC booking, téléphone brut transmis (${rawPhone}) — réponse brute:`, rawFormat.data, rawFormat.error?.message || '');
  check('téléphone brut normalisé en interne : ligne renvoyée', Array.isArray(rawFormat.data) && rawFormat.data.length === 1, true);
} finally {
  await admin.from('booking_members').delete().eq('booking_id', booking.id);
  await admin.from('bookings').delete().eq('id', booking.id);
  console.log('Booking + membre jetables supprimés.');
}

console.log(failures === 0 ? '\nTOUT PASSE.' : `\n${failures} ÉCHEC(S).`);
process.exit(failures === 0 ? 0 : 1);
