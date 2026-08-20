// scripts/audit/create-reschedule-noshow-fixtures.mjs
// Préconditions jetables pour le parcours navigateur des 3 zones aveugles
// (20/08/2026) — crée 3 réservations réelles sur fixture-pro-audit /
// fixture-client-audit, service "Prestation Test Fixture" (allow_group
// false, pour éviter le bug d'invisibilité agenda trouvé le jour même sur
// les services allow_group=true). Pas de nettoyage automatique : ces
// réservations sont volontairement gardées pour la suite du parcours
// (report de RDV, no-show).
//
// Usage : node --env-file=.env.local scripts/audit/create-reschedule-noshow-fixtures.mjs

import { createClient } from '@supabase/supabase-js';

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const BIZ_ID = 'f0bfc690-e8da-4937-b1ff-9c2237656e3a'; // fixture-pro-audit
const SERVICE_ID = '5ab75520-12f3-4800-b272-1fd39c11767d'; // Prestation Test Fixture (allow_group=false)
const CLIENT_PHONE = '+33699999999';
const CLIENT_NAME = '[FIXTURE PERMANENTE] Client Audit';
const CLIENT_EMAIL = 'fixture-client-audit@book-n-pay.invalid';

async function makeBooking(date, time, label) {
  const { data: booking, error } = await admin.from('bookings').insert({
    biz_id: BIZ_ID, service_id: SERVICE_ID, staff_id: null,
    biz_name: '[FIXTURE PERMANENTE] Institut Audit', service_name: 'Prestation Test Fixture',
    staff_name: null, date, time, status: 'active', client_phone: CLIENT_PHONE,
    client_name: CLIENT_NAME, client_email: CLIENT_EMAIL, is_demo: false,
  }).select('id').single();
  if (error) { console.error(label, 'booking error', error); return; }
  const { error: memberErr } = await admin.from('booking_members').insert({
    booking_id: booking.id, name: CLIENT_NAME, phone: CLIENT_PHONE, email: CLIENT_EMAIL,
    status: 'paid', deposit: 10, is_demo: false,
  });
  if (memberErr) { console.error(label, 'member error', memberErr); return; }
  console.log(label, booking.id, date, time);
}

await makeBooking('2026-08-25', '10:00:00', 'RESCHEDULE-ACCEPT');
await makeBooking('2026-08-26', '10:00:00', 'RESCHEDULE-DECLINE');
await makeBooking('2026-08-18', '10:00:00', 'NO-SHOW (passe)');
