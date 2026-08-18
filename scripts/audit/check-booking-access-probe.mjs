// scripts/audit/check-booking-access-probe.mjs
// Preuve par appel réel (pas juste lecture de code) que la faille
// check_booking_access() décrite dans supabase/migrations/0057_* est
// fermée après application de la migration, sans casser l'accès légitime.
// Utilise exclusivement le fixture client (jamais de vraie donnée) —
// voir scripts/audit/create-fixture-client.mjs.
//
// Usage : node --env-file=.env.local scripts/audit/check-booking-access-probe.mjs

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const FIXTURE_EMAIL = 'fixture-client-audit@book-n-pay.invalid';
const FIXTURE_PHONE = '+33699999999';
const REAL_OTHER_BOOKING_ID = '950b5c6c-de66-43c6-9dfb-49f4772d3d5f'; // booking réel, sans rapport avec le fixture — test d'exploit
const LEGIT_BOOKING_ID = '648a6e6f-cd1f-4c07-935e-d669616bf961'; // booking jetable, fixture-pro-audit + fixture client comme membre — test d'accès légitime

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({ type: 'recovery', email: FIXTURE_EMAIL });
if (linkErr) { console.error('generateLink error:', linkErr.message); process.exit(1); }

const anon = createClient(SUPABASE_URL, ANON_KEY);
const { data: otpData, error: otpErr } = await anon.auth.verifyOtp({ type: 'recovery', token_hash: linkData.properties.hashed_token });
if (otpErr) { console.error('verifyOtp error:', otpErr.message); process.exit(1); }

const authed = createClient(SUPABASE_URL, ANON_KEY, {
  global: { headers: { Authorization: `Bearer ${otpData.session.access_token}` } },
});

const exploit = await authed.rpc('check_booking_access', { p_booking_id: REAL_OTHER_BOOKING_ID, p_phone: FIXTURE_PHONE });
console.log('TEST EXPLOIT (booking d\'un autre client + mon propre téléphone) — attendu false :', exploit.data, exploit.error?.message || '');

const legit = await authed.rpc('check_booking_access', { p_booking_id: LEGIT_BOOKING_ID, p_phone: FIXTURE_PHONE });
console.log('TEST LÉGITIME (mon booking, je suis bien membre avec ce téléphone) — attendu true :', legit.data, legit.error?.message || '');
