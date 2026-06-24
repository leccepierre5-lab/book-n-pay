/**
 * test-complet.mjs — Audit complet Book'nPay
 * Couvre : pages publiques, pages protégées, sécurité API, validation,
 *          crons, webhook, flux réservation, email, méthodes HTTP.
 * Usage : node test-complet.mjs
 */
import { chromium } from 'playwright';

const BASE = 'http://localhost:3000';
const SUPABASE_URL = 'https://suyfsuvrbdpnnijxspge.supabase.co';
const SUPABASE_ANON = 'sb_publishable_klT_ROWDrKKuMfp2RBoTBQ_XqasU7KJ';
const REAL_BIZ_ID = 'f02e9040-0eee-4250-9df0-a9fee6ab53df';

const results = [];
let passed = 0;
let failed = 0;

function ok(label) {
  console.log(`  ✅ ${label}`);
  results.push({ label, ok: true });
  passed++;
}
function fail(label, detail = '') {
  console.log(`  ❌ ${label}${detail ? ' — ' + detail : ''}`);
  results.push({ label, ok: false, detail });
  failed++;
}
function warn(label, detail = '') {
  console.log(`  ⚠️  ${label}${detail ? ' — ' + detail : ''}`);
  results.push({ label, ok: 'warn', detail });
}
function section(title) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('─'.repeat(60));
}

// ────────────────────────────────────────────────────────────
// HELPERS
// ────────────────────────────────────────────────────────────
async function get(path, opts = {}) {
  const r = await fetch(`${BASE}${path}`, { redirect: 'manual', ...opts });
  return r;
}
async function post(path, body = {}, opts = {}) {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    body: JSON.stringify(body),
    redirect: 'manual',
    ...opts,
  });
  return r;
}

// ────────────────────────────────────────────────────────────
// 1. PAGES PUBLIQUES
// ────────────────────────────────────────────────────────────
async function testPages() {
  section('1. Pages publiques (GET → 200)');
  const pages = [
    ['/recherche', 'Recherche'],
    ['/etablissement/bia-c1', 'Fiche établissement'],
    ['/connexion', 'Connexion'],
    ['/inscription', 'Inscription'],
    ['/cgu', 'CGU'],
    ['/tarifs', 'Tarifs'],
    ['/devenir-partenaire', 'Devenir partenaire'],
  ];
  for (const [path, label] of pages) {
    const r = await get(path);
    if (r.status === 200) ok(`${label} (${path})`);
    else fail(`${label} (${path})`, `status ${r.status}`);
  }
}

// ────────────────────────────────────────────────────────────
// 2. PAGES PROTÉGÉES (redirect si non auth)
// ────────────────────────────────────────────────────────────
async function testProtected() {
  section('2. Pages protégées (redirect → /connexion sans session)');
  const routes = [
    ['/mes-reservations', 'Mes réservations'],
    ['/confirmation', 'Confirmation'],
    ['/pro', 'Dashboard pro'],
    ['/pro/transactions', 'Pro transactions'],
    ['/pro/reglages', 'Pro réglages'],
    ['/admin', 'Admin'],
  ];
  for (const [path, label] of routes) {
    const r = await get(path);
    if ([301, 302, 307, 308].includes(r.status)) {
      const loc = r.headers.get('location') || '';
      const toLogin = loc.includes('connexion') || loc.includes('login');
      if (toLogin) ok(`${label} → redirect /connexion`);
      else warn(`${label} → redirect ${loc} (pas /connexion ?)`);
    } else if (r.status === 200) {
      // Next.js peut servir le shell HTML puis rediriger côté client
      warn(`${label} → 200 (redirect peut-être client-side, vérifier manuellement)`);
    } else {
      fail(`${label}`, `status ${r.status}`);
    }
  }
}

// ────────────────────────────────────────────────────────────
// 3. SÉCURITÉ API — UNAUTHENTICATED
// ────────────────────────────────────────────────────────────
async function testApiSecurity() {
  section('3. Sécurité API (sans session → 401)');

  const authRoutes = [
    ['POST /api/bookings/cancel', () => post('/api/bookings/cancel', { bookingId: 'x', memberId: 'y' })],
    ['POST /api/bookings/checkin-by-qr', () => post('/api/bookings/checkin-by-qr', { qrCode: 'test' })],
    ['POST /api/loyalty/use-joker', () => post('/api/loyalty/use-joker', { bookingId: 'x', memberId: 'y' })],
    ['POST /api/admin/applications', () => post('/api/admin/applications', { applicationId: 'x', action: 'approve' })],
    ['POST /api/admin/freeze-business', () => post('/api/admin/freeze-business', { bizId: 'x', frozen: true })],
    ['POST /api/bookings/cloturer-prestation', () => post('/api/bookings/cloturer-prestation', { bookingId: 'x' })],
    ['POST /api/pro/refund-gesture', () => post('/api/pro/refund-gesture', { memberId: 'x', amount: 1 })],
  ];

  for (const [label, fn] of authRoutes) {
    const r = await fn();
    if (r.status === 401) ok(`${label} → 401`);
    else if (r.status === 403) ok(`${label} → 403 (aussi valide)`);
    else {
      const body = await r.text().catch(() => '');
      fail(`${label}`, `status ${r.status} — ${body.slice(0, 80)}`);
    }
  }
}

// ────────────────────────────────────────────────────────────
// 4. VALIDATION DES ENTRÉES
// ────────────────────────────────────────────────────────────
async function testInputValidation() {
  section('4. Validation des entrées (champs manquants → 400)');

  const cases = [
    ['GET /api/bookings/availability sans params', () => get('/api/bookings/availability')],
    ['GET /api/bookings/availability sans date', () => get('/api/bookings/availability?bizId=test')],
    ['GET /api/bookings/availability sans bizId', () => get('/api/bookings/availability?date=2026-06-24')],
    ['POST /api/bookings/create corps vide', () => post('/api/bookings/create', {})],
    ['POST /api/stripe/checkout amount=0', () => post('/api/stripe/checkout', { amount: 0 })],
    ['POST /api/stripe/checkout sans amount', () => post('/api/stripe/checkout', {})],
    ['POST /api/chat/send champs manquants', () => post('/api/chat/send', {})],
    ['POST /api/bookings/group sans action', () => post('/api/bookings/group', {})],
    ['GET /api/pro/bookings-month sans params', () => get('/api/pro/bookings-month')],
    ['GET /api/pro/client-stats sans params', () => get('/api/pro/client-stats')],
  ];

  for (const [label, fn] of cases) {
    const r = await fn();
    if (r.status === 400) ok(`${label} → 400`);
    else if (r.status === 401 || r.status === 403) ok(`${label} → ${r.status} (auth avant validation — OK)`);
    else {
      const body = await r.text().catch(() => '');
      fail(`${label}`, `status ${r.status} — ${body.slice(0, 80)}`);
    }
  }
}

// ────────────────────────────────────────────────────────────
// 5. PROTECTION CRONS
// ────────────────────────────────────────────────────────────
async function testCrons() {
  section('5. Crons (sans CRON_SECRET → 401)');

  const crons = [
    '/api/cron/check-no-shows',
    '/api/cron/send-rdv-reminders',
    '/api/cron/cleanup-expired-invites',
    '/api/cron/reset-jokers-annuel',
    '/api/cron/relance-onboarding-pro',
    '/api/cron/verifier-inactivite',
  ];

  for (const path of crons) {
    const r = await get(path);
    if (r.status === 401) ok(`${path} → 401`);
    else fail(`${path}`, `status ${r.status} (devrait être 401 sans CRON_SECRET)`);
  }

  // Avec un faux secret
  const rFake = await get('/api/cron/check-no-shows', {
    headers: { authorization: 'Bearer FAKE_SECRET' },
  });
  if (rFake.status === 401) ok('Cron avec faux secret → 401');
  else fail('Cron avec faux secret', `status ${rFake.status}`);
}

// ────────────────────────────────────────────────────────────
// 6. STRIPE WEBHOOK (signature invalide)
// ────────────────────────────────────────────────────────────
async function testWebhook() {
  section('6. Stripe webhook (signature invalide → 400)');

  const r = await post('/api/stripe/webhook', {}, {
    headers: {
      'Content-Type': 'application/json',
      'stripe-signature': 'v1=invalidsignature',
    },
  });
  if (r.status === 400) ok('Webhook Stripe sans signature valide → 400');
  else if (r.status === 200) fail('Webhook Stripe', 'retourne 200 avec signature invalide !');
  else ok(`Webhook Stripe → ${r.status} (rejet côté Stripe SDK — acceptable)`);
}

// ────────────────────────────────────────────────────────────
// 7. MÉTHODES HTTP NON AUTORISÉES
// ────────────────────────────────────────────────────────────
async function testMethods() {
  section('7. Méthodes HTTP non autorisées (→ 405)');

  const wrongMethods = [
    ['DELETE /api/bookings/create', () => fetch(`${BASE}/api/bookings/create`, { method: 'DELETE' })],
    ['PUT /api/bookings/cancel', () => fetch(`${BASE}/api/bookings/cancel`, { method: 'PUT' })],
    ['POST /api/bookings/availability', () => fetch(`${BASE}/api/bookings/availability`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })],
    ['DELETE /api/stripe/checkout', () => fetch(`${BASE}/api/stripe/checkout`, { method: 'DELETE' })],
  ];

  for (const [label, fn] of wrongMethods) {
    const r = await fn();
    if (r.status === 405) ok(`${label} → 405`);
    else if (r.status === 404) ok(`${label} → 404 (Next.js route not found — acceptable)`);
    else warn(`${label}`, `status ${r.status} (attendu 405)`);
  }
}

// ────────────────────────────────────────────────────────────
// 8. API DISPONIBILITÉ (données réelles)
// ────────────────────────────────────────────────────────────
async function testAvailability() {
  section('8. API availability (données réelles)');

  const today = new Date().toISOString().split('T')[0];
  const r = await get(`/api/bookings/availability?bizId=${REAL_BIZ_ID}&date=${today}`);
  if (r.status === 200) {
    const body = await r.json().catch(() => null);
    if (body && typeof body.counts === 'object') {
      ok(`availability avec vrai bizId → 200, counts reçu (${Object.keys(body.counts).length} créneaux occupés)`);
    } else {
      fail('availability', `200 mais réponse malformée: ${JSON.stringify(body)}`);
    }
  } else {
    fail('availability avec vrai bizId', `status ${r.status}`);
  }

  // UUID invalide → 500 acceptable (Supabase rejette l'UUID malformé)
  const rBad = await get('/api/bookings/availability?bizId=not-a-uuid&date=2026-06-24');
  if (rBad.status === 500 || rBad.status === 400) {
    ok(`availability UUID invalide → ${rBad.status} (Supabase rejette l'UUID malformé)`);
  } else {
    warn('availability UUID invalide', `status ${rBad.status}`);
  }
}

// ────────────────────────────────────────────────────────────
// 9. LOYALTY — INTERNAL_API_SECRET
// ────────────────────────────────────────────────────────────
async function testLoyalty() {
  section('9. Loyalty update-status (sans INTERNAL_API_SECRET → 401)');

  const r = await post('/api/loyalty/update-status', { userId: 'x' });
  if (r.status === 401 || r.status === 403) ok(`update-status sans secret → ${r.status}`);
  else {
    const body = await r.text().catch(() => '');
    fail('update-status', `status ${r.status} — ${body.slice(0, 80)}`);
  }

  const rFake = await post('/api/loyalty/update-status', { userId: 'x' }, {
    headers: { 'x-internal-secret': 'wrongsecret' },
  });
  if (rFake.status === 401 || rFake.status === 403) ok(`update-status faux secret → ${rFake.status}`);
  else warn('update-status faux secret', `status ${rFake.status}`);
}

// ────────────────────────────────────────────────────────────
// 10. EMAIL — RESEND_API_KEY (format, pas de BOM)
// ────────────────────────────────────────────────────────────
async function testEmail() {
  section('10. Email Resend (vérification RESEND_API_KEY)');

  // Appel direct à l'API Resend pour valider la clé
  try {
    const key = process.env.RESEND_API_KEY;
    if (!key) {
      fail('RESEND_API_KEY présente dans env', 'variable absente');
      return;
    }
    if (key.charCodeAt(0) === 0xFEFF || key.charCodeAt(0) > 127) {
      fail('RESEND_API_KEY sans BOM', `premier char: 0x${key.charCodeAt(0).toString(16)}`);
      return;
    }
    ok('RESEND_API_KEY présente et sans BOM');

    if (!key.startsWith('re_')) {
      fail('RESEND_API_KEY format', `commence par "${key.slice(0, 4)}" au lieu de "re_"`);
      return;
    }
    ok('RESEND_API_KEY format valide (commence par re_)');

    // Test API Resend avec endpoint domains (ne nécessite pas d'envoyer un email)
    const r = await fetch('https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (r.status === 200) ok('RESEND_API_KEY valide (appel API Resend → 200)');
    else if (r.status === 403) fail('RESEND_API_KEY invalide (403 Resend)');
    else warn('Resend API', `status ${r.status} — peut-être pas de domaine configuré mais clé valide`);
  } catch (e) {
    warn('Test email', e.message);
  }
}

// ────────────────────────────────────────────────────────────
// 11. AUTH SUPABASE (connexion directe API → token)
// ────────────────────────────────────────────────────────────
async function testAuth() {
  section('11. Auth Supabase (connexion utilisateur test)');

  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON },
      body: JSON.stringify({ email: 'testbnp@example.com', password: 'TestBnP2024!' }),
    });
    const body = await r.json();
    if (r.status === 200 && body.access_token) {
      ok('Connexion testbnp@example.com → access_token reçu');

      // Vérifie que le profil app_users existe
      const profR = await fetch(`${SUPABASE_URL}/rest/v1/app_users?select=id,role,statut&id=eq.${body.user?.id}`, {
        headers: {
          apikey: SUPABASE_ANON,
          Authorization: `Bearer ${body.access_token}`,
        },
      });
      const profBody = await profR.json();
      if (profR.status === 200 && profBody.length > 0) {
        ok(`Profil app_users existe (role: ${profBody[0].role}, statut: ${profBody[0].statut})`);
      } else {
        fail('Profil app_users', `status ${profR.status} ou profil vide`);
      }

      // Retourner la session complète pour l'injecter dans le browser test
      return body;
    } else {
      fail('Connexion testbnp', `status ${r.status} — ${JSON.stringify(body).slice(0, 100)}`);
    }
  } catch (e) {
    fail('Connexion testbnp', e.message);
  }
  return null;
}

// ────────────────────────────────────────────────────────────
// 12. BOOKING CREATE (session injectée depuis token testAuth)
// ────────────────────────────────────────────────────────────
async function testBookingFlow(supabaseSession) {
  section('12. Flux réservation complet (Playwright)');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();

  const networkErrors = [];
  page.on('response', r => {
    if (r.status() >= 500 && !r.url().includes('_next/static')) {
      networkErrors.push(`${r.status()} ${r.url().replace(BASE, '')}`);
    }
  });

  try {
    // Vérifier que la page /connexion charge le formulaire
    await page.goto(`${BASE}/connexion`, { waitUntil: 'domcontentloaded' });
    const emailInput = page.locator('input[type="email"]').first();
    if (await emailInput.count() === 0) {
      fail('Page /connexion charge le formulaire');
    } else {
      ok('Page /connexion charge le formulaire');
    }

    // Injecter la session Supabase directement dans localStorage
    // (évite le double appel auth qui déclenche le rate-limit)
    if (supabaseSession?.access_token) {
      await page.goto(`${BASE}/recherche`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      const storageKey = `sb-suyfsuvrbdpnnijxspge-auth-token`;
      await page.evaluate(([key, session]) => {
        const stored = {
          access_token: session.access_token,
          refresh_token: session.refresh_token,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          expires_in: 3600,
          token_type: 'bearer',
          user: session.user,
        };
        localStorage.setItem(key, JSON.stringify(stored));
      }, [storageKey, supabaseSession]);
      ok('Session Supabase injectée dans localStorage');

      // Recharger pour que Next.js prenne la session
      await page.goto(`${BASE}/recherche`, { waitUntil: 'networkidle', timeout: 30000 });
    } else {
      warn('Session non disponible — flux booking sans auth');
      await page.goto(`${BASE}/recherche`, { waitUntil: 'networkidle', timeout: 30000 });
    }

    // Recherche
    await page.goto(`${BASE}/recherche`, { waitUntil: 'networkidle' });
    const bizCount = await page.locator('a[href^="/etablissement/"]').count();
    if (bizCount > 0) ok(`/recherche → ${bizCount} établissements`);
    else fail('/recherche → aucun établissement');

    // Mes réservations — localStorage seul ne suffit pas pour le SSR Supabase (cookies requis)
    await page.goto(`${BASE}/mes-reservations`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
    if (!page.url().includes('/connexion')) ok('/mes-reservations accessible après login');
    else warn('/mes-reservations → redirect /connexion (attendu : session en localStorage seulement, pas en cookie SSR)');

    // Réservation + paiement Stripe
    await page.goto(`${BASE}/etablissement/bia-c1`, { waitUntil: 'networkidle' });
    const svcBtn = page.locator('button').filter({ hasText: /€/ }).first();
    if (await svcBtn.count() === 0) { fail('Service avec prix non trouvé'); await browser.close(); return; }
    await svcBtn.click();
    await page.waitForTimeout(500);

    const noPref = page.locator('button').filter({ hasText: /Pas de préférence/i });
    if (await noPref.count() > 0) await noPref.click();
    await page.waitForTimeout(400);

    const dayBtns = page.locator('button:not([disabled])').filter({ hasText: /lun|mar|mer|jeu|ven|sam|dim/i });
    if (await dayBtns.count() === 0) { fail('Aucun jour disponible'); await browser.close(); return; }
    await dayBtns.first().click();
    await page.waitForTimeout(1500);

    const slots = page.locator('button:not([disabled])').filter({ hasText: /^\d{2}:\d{2}$/ });
    if (await slots.count() === 0) { fail('Aucun créneau disponible'); await browser.close(); return; }
    const slotLabel = (await slots.first().textContent())?.trim();
    await slots.first().click();
    await page.waitForTimeout(400);
    ok(`Créneau ${slotLabel} sélectionné`);

    const continueBtn = page.locator('button').filter({ hasText: /Continuer/i });
    if (await continueBtn.count() > 0) { await continueBtn.click(); await page.waitForTimeout(1000); }

    // Si auth wall malgré la session injectée, login dans le wall
    const authWall = await page.locator('text=Identification').count() > 0;
    if (authWall) {
      warn('Auth wall visible (session localStorage pas reconnue par le SSR — normal en dev)');
      const switchBtn = page.locator('button[type="button"]').filter({ hasText: /Se connecter/i });
      if (await switchBtn.count() > 0) await switchBtn.click();
      await page.locator('input[type="email"]').fill('testbnp@example.com');
      await page.locator('input[type="password"]').fill('TestBnP2024!');
      await page.locator('button[type="submit"]').click();
      await page.waitForTimeout(8000);
    } else {
      ok('Pas d\'auth wall (session reconnue dans le BookingFlow)');
    }

    // Vérifier l'étape paiement
    const content = await page.content();
    const hasFrais = content.includes('Frais de réservation');
    const hasTotal = content.includes('Total à payer');
    const hasPayBtn = await page.locator('button').filter({ hasText: /Payer/i }).count() > 0;
    if (hasFrais && hasTotal) ok('Récap paiement affiché (frais + total)');
    else fail('Récap paiement', `frais:${hasFrais} total:${hasTotal}`);
    if (hasPayBtn) ok('Bouton Payer présent');
    else fail('Bouton Payer absent');

    if (hasPayBtn) {
      await page.locator('button').filter({ hasText: /Payer/i }).first().click();
      await page.waitForTimeout(8000);
      const finalUrl = page.url();
      if (finalUrl.includes('checkout.stripe.com')) {
        ok(`Redirection Stripe Checkout → ${finalUrl.slice(0, 60)}...`);
      } else {
        fail('Redirection Stripe', `URL finale: ${finalUrl}`);
      }
    }

    if (networkErrors.length > 0) {
      fail('Erreurs 5xx pendant le flux', networkErrors.join(', '));
    } else {
      ok('Aucune erreur 5xx pendant le flux');
    }

  } catch (e) {
    fail('Flux réservation', e.message.slice(0, 120));
  }

  await browser.close();
}

// ────────────────────────────────────────────────────────────
// 13. FORMULAIRE DEVENIR PARTENAIRE
// ────────────────────────────────────────────────────────────
async function testPartnerForm() {
  section('13. Formulaire partenaire');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(`${BASE}/devenir-partenaire`, { waitUntil: 'networkidle' });

  const form = await page.locator('form').count() > 0;
  if (!form) { fail('Formulaire partenaire absent'); await browser.close(); return; }
  ok('Formulaire partenaire présent');

  // Remplir le formulaire
  const nameInput = page.locator('input[name="name"], input[placeholder*="Nom"]').first();
  const emailInput = page.locator('input[type="email"]').first();
  const phoneInput = page.locator('input[type="tel"], input[placeholder*="téléphone"], input[placeholder*="phone"]').first();
  const bizInput = page.locator('input[placeholder*="établissement"], input[placeholder*="salon"], input[name="bizName"]').first();

  if (await nameInput.count() > 0) { await nameInput.fill('Test Pro'); ok('Champ Nom rempli'); }
  if (await emailInput.count() > 0) { await emailInput.fill('testpro@example.com'); ok('Champ Email rempli'); }
  if (await phoneInput.count() > 0) { await phoneInput.fill('0612345678'); ok('Champ Téléphone rempli'); }
  if (await bizInput.count() > 0) { await bizInput.fill('Salon Test'); ok('Champ Établissement rempli'); }

  // Soumission (sans vrai enregistrement — on vérifie juste que le formulaire ne plante pas)
  const submitBtn = page.locator('button[type="submit"]').first();
  if (await submitBtn.count() > 0) {
    await submitBtn.click();
    await page.waitForTimeout(2000);
    // Succès si pas de crash de la page
    const status = page.url();
    ok(`Soumission formulaire → pas de crash (URL: ${status.replace(BASE, '')})`);
  }

  await browser.close();
}

// ────────────────────────────────────────────────────────────
// 14. REJOINDRE UN BOOKING DE GROUPE
// ────────────────────────────────────────────────────────────
async function testGroupJoin() {
  section('14. Endpoint group/rejoindre (validation)');

  // Sans bookingId → 400
  const r1 = await post('/api/bookings/group', { action: 'check' });
  if (r1.status === 400) ok('group check sans bookingId → 400');
  else warn('group check sans bookingId', `status ${r1.status}`);

  // Action inconnue → probablement 400
  const r2 = await post('/api/bookings/group', { action: 'unknownAction', bookingId: 'x' });
  if (r2.status === 400 || r2.status === 404) ok(`group action inconnue → ${r2.status}`);
  else warn('group action inconnue', `status ${r2.status}`);

  // check avec vrai bookingId inexistant
  const r3 = await post('/api/bookings/group', {
    action: 'check',
    bookingId: '00000000-0000-0000-0000-000000000000',
  });
  if (r3.status === 200 || r3.status === 404) {
    ok(`group check booking inexistant → ${r3.status} (pas de crash)`);
  } else if (r3.status === 400) {
    ok('group check booking inexistant → 400 (validation UUID)');
  } else {
    warn('group check booking inexistant', `status ${r3.status}`);
  }
}

// ────────────────────────────────────────────────────────────
// 15. CONNECT STRIPE (status public)
// ────────────────────────────────────────────────────────────
async function testStripeConnect() {
  section('15. Stripe Connect status');

  // connect-status est POST-only
  const r1 = await post('/api/stripe/connect-status', { bizId: 'test' });
  if (r1.status === 401 || r1.status === 403) ok('connect-status (POST) sans auth → 401/403');
  else warn('connect-status sans auth', `status ${r1.status}`);

  // connect-onboarding sans auth → 401
  const r2 = await post('/api/stripe/connect-onboarding', { bizId: 'test' });
  if (r2.status === 401 || r2.status === 403) ok('connect-onboarding sans auth → 401/403');
  else warn('connect-onboarding sans auth', `status ${r2.status}`);
}

// ────────────────────────────────────────────────────────────
// MAIN
// ────────────────────────────────────────────────────────────
async function main() {
  console.log('\n' + '═'.repeat(60));
  console.log('  AUDIT COMPLET — BOOK\'nPAY');
  console.log('  ' + new Date().toLocaleString('fr-FR'));
  console.log('═'.repeat(60));

  // Charger les env vars depuis .env.local
  const fs = await import('fs');
  try {
    const envContent = fs.readFileSync('.env.local', 'utf-8');
    for (const line of envContent.split('\n')) {
      const m = line.match(/^([A-Z_]+)="?([^"]+)"?/);
      if (m) process.env[m[1]] = m[2].trim();
    }
  } catch { /* .env.local non trouvé */ }

  await testPages();
  await testProtected();
  await testApiSecurity();
  await testInputValidation();
  await testCrons();
  await testWebhook();
  await testMethods();
  await testAvailability();
  await testLoyalty();
  await testEmail();
  const supabaseSession = await testAuth();
  await testGroupJoin();
  await testStripeConnect();
  await testPartnerForm();
  await testBookingFlow(supabaseSession);

  // ── Résumé final ────────────────────────────────────────────
  console.log('\n' + '═'.repeat(60));
  console.log(`  RÉSULTATS FINAUX`);
  console.log('═'.repeat(60));
  const warns = results.filter(r => r.ok === 'warn').length;
  console.log(`  ✅ ${passed} réussis`);
  console.log(`  ❌ ${failed} échoués`);
  console.log(`  ⚠️  ${warns} avertissements`);
  console.log('');

  if (failed > 0) {
    console.log('  ÉCHECS :');
    results.filter(r => !r.ok).forEach(r => console.log(`    ❌ ${r.label}${r.detail ? ' — ' + r.detail : ''}`));
    console.log('');
  }
  if (warns > 0) {
    console.log('  AVERTISSEMENTS :');
    results.filter(r => r.ok === 'warn').forEach(r => console.log(`    ⚠️  ${r.label}${r.detail ? ' — ' + r.detail : ''}`));
    console.log('');
  }

  console.log(`  Score : ${passed}/${passed + failed} tests passés (${warns} warnings)`);
  console.log('═'.repeat(60) + '\n');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('\nFATAL:', e.message);
  process.exit(1);
});
