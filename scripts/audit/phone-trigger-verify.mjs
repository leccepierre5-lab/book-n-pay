// scripts/audit/phone-trigger-verify.mjs
// Preuve par écriture réelle (pas juste "le trigger existe") que
// normalize_phone() + les 4 triggers BEFORE INSERT/UPDATE (migration 0059)
// transforment effectivement les valeurs écrites — sur les 4 tables, avec
// les 3 cas limites (brut "0X", déjà "+33X", null). Fixtures uniquement
// (fixture-client-audit, fixture-pro-audit) ou lignes jetables créées et
// supprimées ; les 2 fixtures permanentes sont restaurées à leur valeur
// d'origine en fin de script, même en cas d'erreur (try/finally).
//
// Usage : node --env-file=.env.local scripts/audit/phone-trigger-verify.mjs

import { createClient } from '@supabase/supabase-js';

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let failures = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? 'OK ' : 'FAIL'} ${label} — attendu ${JSON.stringify(expected)}, obtenu ${JSON.stringify(actual)}`);
}

// ── app_users (fixture-client-audit), UPDATE + restauration ──────────────
async function testAppUsers() {
  const { data: authList } = await admin.auth.admin.listUsers();
  const fixtureAuth = authList.users.find((u) => u.email === 'fixture-client-audit@book-n-pay.invalid');
  if (!fixtureAuth) { console.error('fixture-client-audit introuvable'); failures++; return; }

  const { data: before } = await admin.from('app_users').select('phone').eq('id', fixtureAuth.id).single();
  const original = before.phone;

  try {
    await admin.from('app_users').update({ phone: '0611223344' }).eq('id', fixtureAuth.id);
    const { data: r1 } = await admin.from('app_users').select('phone').eq('id', fixtureAuth.id).single();
    check('app_users: "0611223344" -> normalisé', r1.phone, '+33611223344');

    await admin.from('app_users').update({ phone: '+33611223344' }).eq('id', fixtureAuth.id);
    const { data: r2 } = await admin.from('app_users').select('phone').eq('id', fixtureAuth.id).single();
    check('app_users: "+33611223344" -> inchangé', r2.phone, '+33611223344');

    const { error: nullErr } = await admin.from('app_users').update({ phone: null }).eq('id', fixtureAuth.id);
    check('app_users: null -> pas d\'erreur', nullErr, null);
    const { data: r3 } = await admin.from('app_users').select('phone').eq('id', fixtureAuth.id).single();
    check('app_users: null -> reste null', r3.phone, null);
  } finally {
    await admin.from('app_users').update({ phone: original }).eq('id', fixtureAuth.id);
    console.log(`app_users restauré à sa valeur d'origine (${original})`);
  }
}

// ── businesses (fixture-pro-audit), UPDATE + restauration ────────────────
async function testBusinesses() {
  const { data: biz } = await admin.from('businesses').select('id, phone').eq('slug', 'fixture-pro-audit').single();
  const original = biz.phone;

  try {
    await admin.from('businesses').update({ phone: '0622334455' }).eq('id', biz.id);
    const { data: r1 } = await admin.from('businesses').select('phone').eq('id', biz.id).single();
    check('businesses: "0622334455" -> normalisé', r1.phone, '+33622334455');

    await admin.from('businesses').update({ phone: '+33622334455' }).eq('id', biz.id);
    const { data: r2 } = await admin.from('businesses').select('phone').eq('id', biz.id).single();
    check('businesses: "+33622334455" -> inchangé', r2.phone, '+33622334455');

    const { error: nullErr } = await admin.from('businesses').update({ phone: null }).eq('id', biz.id);
    check('businesses: null -> pas d\'erreur', nullErr, null);
  } finally {
    await admin.from('businesses').update({ phone: original }).eq('id', biz.id);
    console.log(`businesses (fixture-pro-audit) restauré à sa valeur d'origine (${original})`);
  }
}

// ── booking_members + bookings.client_phone, ligne jetable ───────────────
async function testDisposableBooking() {
  const { data: biz } = await admin.from('businesses').select('id, name').eq('slug', 'fixture-pro-audit').single();
  const { data: service } = await admin.from('services').select('id, name').eq('biz_id', biz.id).limit(1).single();

  const { data: booking, error: bookingErr } = await admin
    .from('bookings')
    .insert({
      biz_id: biz.id, service_id: service.id, biz_name: biz.name, service_name: service.name,
      date: '2099-01-01', time: '10:00:00', status: 'active', is_demo: true,
      client_phone: '0633445566',
    })
    .select('id, client_phone')
    .single();
  if (bookingErr) { console.error('création booking jetable:', bookingErr.message); failures++; return; }

  try {
    check('bookings.client_phone: "0633445566" (insert) -> normalisé', booking.client_phone, '+33633445566');

    await admin.from('bookings').update({ client_phone: '+33633445566' }).eq('id', booking.id);
    const { data: r2 } = await admin.from('bookings').select('client_phone').eq('id', booking.id).single();
    check('bookings.client_phone: "+33633445566" (update) -> inchangé', r2.client_phone, '+33633445566');

    const { error: nullErr } = await admin.from('bookings').update({ client_phone: null }).eq('id', booking.id);
    check('bookings.client_phone: null -> pas d\'erreur', nullErr, null);

    const { data: member, error: memberErr } = await admin
      .from('booking_members')
      .insert({ booking_id: booking.id, name: 'Probe trigger jetable', phone: '0644556677', status: 'paid', is_demo: true })
      .select('id, phone')
      .single();
    if (memberErr) { console.error('création booking_member jetable:', memberErr.message); failures++; }
    else {
      check('booking_members.phone: "0644556677" (insert) -> normalisé', member.phone, '+33644556677');

      await admin.from('booking_members').update({ phone: '+33644556677' }).eq('id', member.id);
      const { data: r2 } = await admin.from('booking_members').select('phone').eq('id', member.id).single();
      check('booking_members.phone: "+33644556677" (update) -> inchangé', r2.phone, '+33644556677');

      const { error: nullErr2 } = await admin.from('booking_members').update({ phone: null }).eq('id', member.id);
      check('booking_members.phone: null -> pas d\'erreur', nullErr2, null);

      await admin.from('booking_members').delete().eq('id', member.id);
    }
  } finally {
    await admin.from('bookings').delete().eq('id', booking.id);
    console.log('Booking + membre jetables supprimés.');
  }
}

await testAppUsers();
await testBusinesses();
await testDisposableBooking();

console.log(failures === 0 ? '\nTOUT PASSE.' : `\n${failures} ÉCHEC(S).`);
process.exit(failures === 0 ? 0 : 1);
