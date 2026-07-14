// scripts/audit/webhook-signature-check.mjs
// Bloc 1 — preuve d'exécution de la vérification de signature Stripe sur
// /api/stripe/webhook. Envoie un payload bidon sans header stripe-signature,
// puis avec un header présent mais invalide. Les deux doivent renvoyer 4xx
// et ne jamais toucher la base (constructEventAsync échoue avant tout accès
// Supabase dans route.ts).
//
// Usage : node scripts/audit/webhook-signature-check.mjs [baseUrl]

const BASE_URL = process.argv[2] || process.env.AUDIT_BASE_URL || 'https://www.book-n-pay.com';
const URL_TARGET = `${BASE_URL}/api/stripe/webhook`;

const fakePayload = JSON.stringify({
  id: 'evt_audit_test',
  object: 'event',
  type: 'checkout.session.completed',
  data: { object: { id: 'cs_audit_test', metadata: {} } },
});

async function run() {
  console.log('\n=== Bloc 1 — Signature webhook Stripe ===');
  console.log(`Cible : ${URL_TARGET}\n`);

  // 1. Sans header stripe-signature du tout
  const res1 = await fetch(URL_TARGET, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: fakePayload,
  });
  const text1 = await res1.text();
  console.log(`1) Sans header stripe-signature → HTTP ${res1.status}`);
  console.log(`   ${res1.status >= 400 && res1.status < 500 ? '✅ rejeté (attendu)' : '🔴 TROU — devrait être 4xx'}`);
  console.log(`   body: ${text1.slice(0, 150)}\n`);

  // 2. Avec un header présent mais invalide (mauvaise signature)
  const res2 = await fetch(URL_TARGET, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'stripe-signature': 't=1700000000,v1=deadbeef0000000000000000000000000000000000000000000000000000',
    },
    body: fakePayload,
  });
  const text2 = await res2.text();
  console.log(`2) Header stripe-signature présent mais faux → HTTP ${res2.status}`);
  console.log(`   ${res2.status >= 400 && res2.status < 500 ? '✅ rejeté (attendu)' : '🔴 TROU — devrait être 4xx'}`);
  console.log(`   body: ${text2.slice(0, 150)}\n`);
}

run();
