// scripts/audit/check-booking-access-format-drift-probe.mjs
// Répond au point 2 du plan de normalisation téléphone
// (docs/plan-normalisation-telephone.md) par un appel réel, pas une lecture
// de la migration 0057 : check_booking_access(booking_id, phone) refuse-t-il
// l'accès à un membre légitime dont le format stocké diffère de celui de son
// identité app_users, même quand c'est la même personne ?
//
// Utilise exclusivement le fixture client et fixture-pro-audit (jamais de
// vraie donnée) — voir scripts/audit/create-fixture-client.mjs. Bookings
// jetables créés puis supprimés à la fin, même pattern que
// check-booking-access-probe.mjs.
//
// Usage : node --env-file=.env.local scripts/audit/check-booking-access-format-drift-probe.mjs

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const FIXTURE_EMAIL = 'fixture-client-audit@book-n-pay.invalid';
const FIXTURE_PRO_SLUG = 'fixture-pro-audit';

function otherFormat(phone) {
  if (phone.startsWith('+33')) return '0' + phone.slice(3);
  if (phone.startsWith('0')) return '+33' + phone.slice(1);
  throw new Error(`Format de téléphone inattendu, ni "0X" ni "+33X": ${phone}`);
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const { data: fixtureAuthList, error: listErr } = await admin.auth.admin.listUsers();
if (listErr) { console.error('listUsers error:', listErr.message); process.exit(1); }
const fixtureAuth = fixtureAuthList.users.find((u) => u.email === FIXTURE_EMAIL);
if (!fixtureAuth) { console.error(`Fixture client introuvable (${FIXTURE_EMAIL}) — voir create-fixture-client.mjs`); process.exit(1); }

const { data: fixtureUser, error: fixtureUserErr } = await admin.from('app_users').select('phone').eq('id', fixtureAuth.id).single();
if (fixtureUserErr) { console.error('app_users error:', fixtureUserErr.message); process.exit(1); }
const FIXTURE_PHONE = fixtureUser.phone;
const DRIFTED_PHONE = otherFormat(FIXTURE_PHONE);
console.log(`app_users.phone (fixture) = ${FIXTURE_PHONE} — format "drifté" simulé côté booking_members = ${DRIFTED_PHONE}`);

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
    name: 'Probe drift jetable',
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

// Contrôle : booking_members.phone dans le MÊME format que app_users.phone.
const controlBookingId = await createDisposableBooking(FIXTURE_PHONE);
// Cas réel du chantier : booking_members.phone dans l'AUTRE format, même personne.
const driftBookingId = await createDisposableBooking(DRIFTED_PHONE);

try {
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({ type: 'recovery', email: FIXTURE_EMAIL });
  if (linkErr) throw new Error(`generateLink: ${linkErr.message}`);

  const anon = createClient(SUPABASE_URL, ANON_KEY);
  const { data: otpData, error: otpErr } = await anon.auth.verifyOtp({ type: 'recovery', token_hash: linkData.properties.hashed_token });
  if (otpErr) throw new Error(`verifyOtp: ${otpErr.message}`);

  const authed = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${otpData.session.access_token}` } },
  });

  const control = await authed.rpc('check_booking_access', { p_booking_id: controlBookingId, p_phone: FIXTURE_PHONE });
  console.log('CONTRÔLE (même format des deux côtés) — attendu true :', control.data, control.error?.message || '');

  const drift = await authed.rpc('check_booking_access', { p_booking_id: driftBookingId, p_phone: FIXTURE_PHONE });
  console.log('DRIFT (booking_members dans l\'autre format, même personne réelle) — si false, confirme une comparaison brute non normalisée :', drift.data, drift.error?.message || '');
} finally {
  await deleteDisposableBooking(controlBookingId);
  await deleteDisposableBooking(driftBookingId);
  console.log('Bookings jetables nettoyés.');
}
