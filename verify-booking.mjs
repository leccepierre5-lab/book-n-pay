import { chromium } from 'playwright';

const BASE = 'https://book-n-pay-next.vercel.app';

async function shot(page, name) {
  const path = `C:/Users/lecce/bnp-next/book-n-pay-next/verify-${name}.png`;
  await page.screenshot({ path, fullPage: true });
  console.log(`📸 ${name}`);
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();

  const consoleErrors = [];
  const networkErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', err => consoleErrors.push(err.message));
  page.on('response', resp => {
    if (resp.status() >= 400) networkErrors.push(`${resp.status()} ${resp.url()}`);
  });

  // ── 1. /recherche ──────────────────────────────────────────────────────
  console.log('\n── STEP 1: /recherche ──');
  await page.goto(`${BASE}/recherche`, { waitUntil: 'networkidle' });
  await shot(page, '01-recherche');
  const bizLinks = await page.locator('a[href^="/etablissement/"]').all();
  console.log(`  ✅ ${bizLinks.length} établissements affichés`);

  // ── 2. Page établissement ───────────────────────────────────────────────
  console.log('\n── STEP 2: page établissement ──');
  const firstHref = await bizLinks[0].getAttribute('href');
  await page.goto(`${BASE}${firstHref}`, { waitUntil: 'networkidle' });
  await shot(page, '02-etablissement');
  const bizName = await page.locator('h1').first().textContent();
  console.log(`  ✅ "${bizName?.trim()}"`);

  // ── 3. Sélection service ────────────────────────────────────────────────
  console.log('\n── STEP 3: sélection service ──');
  await page.locator('button').filter({ hasText: /€/ }).first().click();
  await page.waitForTimeout(500);

  // ── 4. Sélection praticien ──────────────────────────────────────────────
  console.log('\n── STEP 4: praticien ──');
  const noPref = page.locator('button').filter({ hasText: 'Pas de préférence' });
  if (await noPref.count() > 0) {
    await noPref.click();
    console.log('  ✅ Pas de préférence');
  }
  await page.waitForTimeout(500);

  // ── 5. Date ─────────────────────────────────────────────────────────────
  console.log('\n── STEP 5: date ──');
  const stepTitle = await page.locator('h2').first().textContent();
  console.log(`  Étape : "${stepTitle?.trim()}"`);
  const firstOpenDay = page.locator('button:not([disabled])').filter({ hasText: /lun|mar|mer|jeu|ven|sam|dim/i }).first();
  const dateLabel = await firstOpenDay.textContent();
  console.log(`  Date : "${dateLabel?.trim()}"`);
  await firstOpenDay.click();
  await page.waitForTimeout(1200);

  // ── 6. Créneau ─────────────────────────────────────────────────────────
  console.log('\n── STEP 6: créneau ──');
  const slots = page.locator('button:not([disabled])').filter({ hasText: /^\d{2}:\d{2}$/ });
  console.log(`  Disponibles : ${await slots.count()}`);
  await slots.first().click();
  await page.waitForTimeout(400);
  await shot(page, '06-slot-selected');

  // ── 7. Continuer ────────────────────────────────────────────────────────
  console.log('\n── STEP 7: Continuer ──');
  await page.locator('button').filter({ hasText: /Continuer/i }).click();
  await page.waitForTimeout(1000);
  await shot(page, '07-auth-wall');

  // ── 8. Auth wall → login ────────────────────────────────────────────────
  console.log('\n── STEP 8: auth wall → Se connecter ──');
  const authWallVisible = await page.locator('text=Identification').count() > 0;
  console.log(`  Auth wall : ${authWallVisible}`);

  // Basculer en mode login
  const switchToLogin = page.locator('button[type="button"]').filter({ hasText: /Se connecter/i });
  if (await switchToLogin.count() > 0) {
    await switchToLogin.click();
    await page.waitForTimeout(400);
    console.log('  ✅ Basculé en mode "Se connecter"');
  }
  await shot(page, '08-login-mode');

  // Remplir email + password
  await page.locator('input[type="email"]').fill('talentoftheday@gmail.com');
  await page.locator('input[type="password"]').fill('TestBnP2024!');
  await page.locator('button[type="submit"]').click();
  await page.waitForTimeout(3000);
  await shot(page, '08-after-login');

  const afterContent = await page.content();
  const loginError = afterContent.match(/Invalid|incorrect|invalid|mot de passe invalide|user not found/i);
  const authErrorShown = await page.locator('p.text-xs.text-red-400').count() > 0;
  const authErrorText = authErrorShown ? await page.locator('p.text-xs.text-red-400').first().textContent() : null;
  console.log(`  Erreur auth UI : ${authErrorShown ? `"${authErrorText}"` : 'non'}`);
  console.log(`  Paiement visible : ${afterContent.includes('Frais de réservation')}`);

  // ── 9. Étape paiement ───────────────────────────────────────────────────
  console.log('\n── STEP 9: étape paiement ──');
  await shot(page, '09-payment');
  const hasFrais = afterContent.includes('Frais de réservation');
  const hasPayBtn = afterContent.includes('Payer');
  console.log(`  Récap frais : ${hasFrais}`);
  console.log(`  Bouton Payer : ${hasPayBtn}`);

  if (hasPayBtn) {
    console.log('\n── STEP 10: clic Payer → Stripe ──');
    await page.locator('button').filter({ hasText: /Payer/i }).first().click();
    await page.waitForTimeout(6000);
    const finalUrl = page.url();
    const onStripe = finalUrl.includes('stripe.com');
    console.log(`  URL finale : ${finalUrl}`);
    console.log(`  Redirection Stripe : ${onStripe ? '✅' : '❌'}`);
    await shot(page, '10-stripe');
  }

  // ── Résumé erreurs réseau ────────────────────────────────────────────────
  console.log('\n── Erreurs réseau ──');
  if (networkErrors.length === 0) console.log('  ✅ Aucune');
  else networkErrors.forEach(e => console.log(`  ❌ ${e}`));

  console.log('\n── Erreurs console ──');
  if (consoleErrors.length === 0) console.log('  ✅ Aucune');
  else consoleErrors.slice(0, 5).forEach(e => console.log(`  ❌ ${e.slice(0, 150)}`));

  await browser.close();
}

run().catch(e => {
  console.error('\nFATAL:', e.message);
  process.exit(1);
});
