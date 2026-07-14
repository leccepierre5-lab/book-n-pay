// scripts/audit/rate-limit-check.mjs
// Bloc 1 — preuve d'exécution du rate limiting sur les 5 endpoints listés
// dans SECURITY_TODO.md #3. Envoie des requêtes séquentielles réelles et
// rapporte à quelle requête le HTTP 429 apparaît.
//
// Sécurité des payloads envoyés (aucun effet de bord réel visé) :
//  - register        : body {} → 400 "email/password requis" tant que non bloqué
//                       (le rate limit est vérifié AVANT le parsing du body,
//                       donc aucun compte n'est jamais créé par ce script)
//  - forgot-password  : email au TLD .invalid (RFC 2606, non délivrable) →
//                       generateLink échoue silencieusement, aucun email envoyé
//  - stripe/checkout   : body {} → 400 "successUrl et cancelUrl requis" avant
//                       tout appel à l'API Stripe (rate limit vérifié avant)
//  - bookings/group    : bookingId factice (UUID nul) → 404 "introuvable" ou
//                       400 "memberData requis", jamais d'insertion réelle
//  - checkin-by-qr     : NON TESTABLE sans session pro authentifiée (401 avant
//                       même d'atteindre le rate limiter) — listé pour mémoire,
//                       toujours "non atteint" ci-dessous.
//
// Usage : node scripts/audit/rate-limit-check.mjs [baseUrl]
// (pas besoin de secrets — tout est fait avec des requêtes publiques)

const BASE_URL = process.argv[2] || process.env.AUDIT_BASE_URL || 'https://www.book-n-pay.com';
const N = 20;

const ENDPOINTS = [
  {
    name: 'register',
    limitDoc: '5 / 15min par IP',
    path: '/api/auth/register',
    body: () => ({}),
  },
  {
    name: 'forgot-password',
    limitDoc: '5 / 15min par IP + 3 / 15min par email',
    path: '/api/auth/forgot-password',
    body: () => ({ email: 'audit-ratelimit-test@book-n-pay.invalid' }),
  },
  {
    name: 'stripe/checkout',
    limitDoc: '30 / 10min par IP',
    path: '/api/stripe/checkout',
    body: () => ({}),
  },
  {
    name: 'bookings/group (addMemberAndGetCheckout)',
    limitDoc: '10 / 10min par IP',
    path: '/api/bookings/group',
    body: () => ({
      action: 'addMemberAndGetCheckout',
      bookingId: '00000000-0000-0000-0000-000000000000',
    }),
  },
];

async function fire(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.status;
}

console.log(`\n=== Bloc 1 — Rate limiting, ${N} requêtes séquentielles par endpoint ===`);
console.log(`Cible : ${BASE_URL}\n`);

for (const ep of ENDPOINTS) {
  const url = `${BASE_URL}${ep.path}`;
  const statuses = [];
  let first429 = null;
  for (let i = 1; i <= N; i++) {
    try {
      const status = await fire(url, ep.body());
      statuses.push(status);
      if (status === 429 && first429 === null) first429 = i;
    } catch (e) {
      statuses.push(`ERR(${e.message})`);
    }
  }
  console.log(`— ${ep.name}  [attendu: ${ep.limitDoc}]`);
  console.log(`  statuts : ${statuses.join(' ')}`);
  console.log(
    first429
      ? `  ✅ 429 apparu à la requête #${first429}`
      : `  ⚠️ aucun 429 en ${N} requêtes — soit la limite configurée est > ${N} (attendu pour stripe/checkout à 30), soit le rate limit ne mord pas`
  );
  console.log('');
}

console.log('— checkin-by-qr  [attendu: 30 / 5min par compte pro]');
console.log('  NON TESTABLE depuis ce script : la route exige une session pro authentifiée');
console.log('  (401 avant même le rate limiter). Test manuel requis : boucler 30+ scans QR');
console.log('  depuis un compte pro connecté (devtools console, fetch avec cookie de session).\n');
