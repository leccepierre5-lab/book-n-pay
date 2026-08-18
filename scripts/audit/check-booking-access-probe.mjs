// scripts/audit/check-booking-access-probe.mjs
// Preuve par appel réel (pas juste lecture de code) que la faille
// check_booking_access() décrite dans supabase/migrations/0057_* est
// fermée après application de la migration, sans casser l'accès légitime.
// Utilise exclusivement le fixture client (jamais de vraie donnée) —
// voir scripts/audit/create-fixture-client.mjs.
//
// Autonome (18/08) : crée ses deux propres bookings jetables (un dont le
// fixture client est membre, un dont il ne l'est pas) sous
// fixture-pro-audit, et les supprime à la fin — plus de dépendance à un
// UUID en dur qui finit par être nettoyé par ailleurs et rendre le test
// LÉGITIME silencieusement invalide (faux négatif constaté le 18/08).
//
// Usage : node --env-file=.env.local scripts/audit/check-booking-access-probe.mjs

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const FIXTURE_EMAIL = 'fixture-client-audit@book-n-pay.invalid';
const FIXTURE_PRO_SLUG = 'fixture-pro-audit';
const OTHER_PHONE = '+33600000000'; // membre fictif, jamais le fixture client — sert de "booking d'un autre client"

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const { data: fixtureAuthList, error: listErr } = await admin.auth.admin.listUsers();
if (listErr) { console.error('listUsers error:', listErr.message); process.exit(1); }
const fixtureAuth = fixtureAuthList.users.find((u) => u.email === FIXTURE_EMAIL);
if (!fixtureAuth) { console.error(`Fixture client introuvable (${FIXTURE_EMAIL}) — voir create-fixture-client.mjs`); process.exit(1); }

const { data: fixtureUser, error: fixtureUserErr } = await admin.from('app_users').select('phone').eq('id', fixtureAuth.id).single();
if (fixtureUserErr) { console.error('app_users error:', fixtureUserErr.message); process.exit(1); }
const FIXTURE_PHONE = fixtureUser.phone;

const { data: biz, error: bizErr } = await admin.from('businesses').select('id, name').eq('slug', FIXTURE_PRO_SLUG).single();
if (bizErr) { console.error('business fixture introuvable:', bizErr.message); process.exit(1); }

const { data: service, error: serviceErr } = await admin.from('services').select('id, name').eq('biz_id', biz.id).limit(1).single();
if (serviceErr) { console.error('service fixture introuvable:', serviceErr.message); process.exit(1); }

async function createDisposableBooking(memberPhone) {
  const { data: booking, error } = await admin
    .from('bookings')
    .insert({
      biz_id: biz.id,
      service_id: service.id,
      biz_name: biz.name,
      service_name: service.name,
      date: '2099-01-01',
      time: '10:00:00',
      status: 'active',
      is_demo: true,
    })
    .select('id')
    .single();
  if (error) throw new Error(`création booking jetable: ${error.message}`);

  const { error: memberErr } = await admin.from('booking_members').insert({
    booking_id: booking.id,
    name: 'Probe jetable',
    phone: memberPhone,
    status: 'paid',
    is_demo: true,
  });
  if (memberErr) throw new Error(`création booking_member jetable: ${memberErr.message}`);

  return booking.id;
}

async function deleteDisposableBooking(bookingId) {
  await admin.from('booking_members').delete().eq('booking_id', bookingId);
  await admin.from('bookings').delete().eq('id', bookingId);
}

const legitBookingId = await createDisposableBooking(FIXTURE_PHONE);
const otherBookingId = await createDisposableBooking(OTHER_PHONE);

try {
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({ type: 'recovery', email: FIXTURE_EMAIL });
  if (linkErr) throw new Error(`generateLink: ${linkErr.message}`);

  const anon = createClient(SUPABASE_URL, ANON_KEY);
  const { data: otpData, error: otpErr } = await anon.auth.verifyOtp({ type: 'recovery', token_hash: linkData.properties.hashed_token });
  if (otpErr) throw new Error(`verifyOtp: ${otpErr.message}`);

  const authed = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${otpData.session.access_token}` } },
  });

  const exploit = await authed.rpc('check_booking_access', { p_booking_id: otherBookingId, p_phone: FIXTURE_PHONE });
  console.log('TEST EXPLOIT (booking d\'un autre client + mon propre téléphone) — attendu false :', exploit.data, exploit.error?.message || '');

  const legit = await authed.rpc('check_booking_access', { p_booking_id: legitBookingId, p_phone: FIXTURE_PHONE });
  console.log('TEST LÉGITIME (mon booking, je suis bien membre avec ce téléphone) — attendu true :', legit.data, legit.error?.message || '');
} finally {
  await deleteDisposableBooking(legitBookingId);
  await deleteDisposableBooking(otherBookingId);
  console.log('Bookings jetables nettoyés.');
}
