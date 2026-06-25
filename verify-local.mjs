import { chromium } from 'playwright';

const BASE = 'http://localhost:3000';

async function shot(page, name) {
  const path = `C:/Users/lecce/bnp-next/book-n-pay-next/local-${name}.png`;
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
    if (resp.status() >= 400 && !resp.url().includes('_next/static')) {
      networkErrors.push(`${resp.status()} ${resp.url()}`);
    }
  });

  // ── 1. /recherche ──────────────────────────────────────────────────────
  console.log('\n── STEP 1: /recherche ──');
  await page.goto(`${BASE}/recherche`, { waitUntil: 'networkidle' });
  await shot(page, '01-recherche');
  const bizLinks = await page.locator('a[href^="/etablissement/"]').all();
  console.log(`  ${bizLinks.length > 0 ? '✅' : '❌'} ${bizLinks.length} établissements affichés`);

  if (bizLinks.length === 0) {
    console.log('  ❌ Aucun établissement — arrêt du test');
    await browser.close();
    return;
  }

  // ── 2. Page établissement ───────────────────────────────────────────────
  console.log('\n── STEP 2: page établissement ──');
  const firstHref = await bizLinks[0].getAttribute('href');
  await page.goto(`${BASE}${firstHref}`, { waitUntil: 'networkidle' });
  await shot(page, '02-etablissement');
  const bizName = await page.locator('h1').first().textContent();
  console.log(`  ✅ "${bizName?.trim()}"`);

  // ── 3. Sélection service ────────────────────────────────────────────────
  console.log('\n── STEP 3: sélection service ──');
  const serviceBtn = page.locator('button').filter({ hasText: /€/ }).first();
  if (await serviceBtn.count() === 0) {
    console.log('  ❌ Aucun service avec prix — screenshot pour diagnostic');
    await shot(page, '03-no-service');
    await browser.close();
    return;
  }
  await serviceBtn.click();
  await page.waitForTimeout(600);
  await shot(page, '03-service-selected');

  // ── 4. Sélection praticien (optionnel) ──────────────────────────────────
  console.log('\n── STEP 4: praticien ──');
  const noPref = page.locator('button').filter({ hasText: /Pas de préférence/i });
  if (await noPref.count() > 0) {
    await noPref.click();
    console.log('  ✅ Pas de préférence cliqué');
  } else {
    console.log('  ℹ️  Pas de sélection de praticien sur cet établissement');
  }
  await page.waitForTimeout(500);

  // ── 5. Date ─────────────────────────────────────────────────────────────
  console.log('\n── STEP 5: date ──');
  const stepTitle = await page.locator('h2').first().textContent();
  console.log(`  Étape : "${stepTitle?.trim()}"`);
  await shot(page, '05-date-view');

  const dayBtns = page.locator('button:not([disabled])').filter({ hasText: /lun|mar|mer|jeu|ven|sam|dim/i });
  const dayCount = await dayBtns.count();
  console.log(`  Jours disponibles : ${dayCount}`);
  if (dayCount === 0) {
    console.log('  ⚠️  Aucun jour ouvert — peut-être hors horaires');
    await shot(page, '05-no-day');
  } else {
    const dateLabel = await dayBtns.first().textContent();
    console.log(`  Date choisie : "${dateLabel?.trim()}"`);
    await dayBtns.first().click();
    await page.waitForTimeout(1500);
    await shot(page, '05-day-selected');
  }

  // ── 6. Créneau ─────────────────────────────────────────────────────────
  console.log('\n── STEP 6: créneau horaire ──');
  const slots = page.locator('button:not([disabled])').filter({ hasText: /^\d{2}:\d{2}$/ });
  const slotCount = await slots.count();
  console.log(`  Créneaux disponibles : ${slotCount}`);
  if (slotCount === 0) {
    console.log('  ⚠️  Aucun créneau — fermeture ou complet');
    await shot(page, '06-no-slot');
  } else {
    const slotLabel = await slots.first().textContent();
    console.log(`  Créneau choisi : "${slotLabel?.trim()}"`);
    await slots.first().click();
    await page.waitForTimeout(400);
    await shot(page, '06-slot-selected');

    // ── 7. Continuer ──────────────────────────────────────────────────────
    console.log('\n── STEP 7: bouton Continuer ──');
    const continueBtn = page.locator('button').filter({ hasText: /Continuer/i });
    if (await continueBtn.count() > 0) {
      await continueBtn.click();
      await page.waitForTimeout(1000);
      await shot(page, '07-after-continue');
      console.log('  ✅ Continuer cliqué');
    } else {
      console.log('  ❌ Bouton Continuer introuvable');
      await shot(page, '07-no-continue');
    }

    // ── 8. Auth wall ────────────────────────────────────────────────────
    console.log('\n── STEP 8: auth wall ──');
    const authWall = await page.locator('text=Identification').count() > 0;
    console.log(`  Auth wall affiché : ${authWall ? '✅' : '❌'}`);
    await shot(page, '08-auth-wall');

    if (authWall) {
      // Passer en mode "Se connecter"
      const switchBtn = page.locator('button[type="button"]').filter({ hasText: /Se connecter/i });
      if (await switchBtn.count() > 0) {
        await switchBtn.click();
        await page.waitForTimeout(400);
        console.log('  ✅ Basculé en mode connexion');
      }

      // Remplir login
      await page.locator('input[type="email"]').fill('testbnp@example.com');
      await page.locator('input[type="password"]').fill('TestBnP2024!');
      await shot(page, '08-login-filled');
      await page.locator('button[type="submit"]').click();
      await page.waitForTimeout(3000);
      await shot(page, '08-after-login');

      const errEl = page.locator('p.text-xs.text-red-400');
      if (await errEl.count() > 0) {
        const errText = await errEl.first().textContent();
        console.log(`  ⚠️  Erreur auth : "${errText}"`);
      } else {
        console.log('  ✅ Pas d\'erreur auth');
      }

      // ── 9. Étape paiement ────────────────────────────────────────────
      console.log('\n── STEP 9: étape paiement ──');
      await shot(page, '09-payment');
      const content = await page.content();
      const hasFrais = content.includes('Frais de réservation');
      const hasTotal = content.includes('Total à payer');
      const hasPayBtn = content.includes('Payer ');
      console.log(`  Récap frais de réservation : ${hasFrais ? '✅' : '❌'}`);
      console.log(`  Total à payer : ${hasTotal ? '✅' : '❌'}`);
      console.log(`  Bouton Payer : ${hasPayBtn ? '✅' : '❌'}`);

      if (hasPayBtn) {
        // ── 10. Clic Payer → Stripe ──────────────────────────────────────
        console.log('\n── STEP 10: clic Payer → Stripe Checkout ──');
        await page.locator('button').filter({ hasText: /Payer/i }).first().click();
        await page.waitForTimeout(8000);
        const finalUrl = page.url();
        const onStripe = finalUrl.includes('stripe.com') || finalUrl.includes('checkout.stripe');
        console.log(`  URL finale : ${finalUrl.slice(0, 100)}`);
        console.log(`  Redirection Stripe : ${onStripe ? '✅' : '❌'}`);
        await shot(page, '10-stripe');

        if (onStripe) {
          // Remplir carte de test Stripe
          console.log('\n── STEP 11: paiement test Stripe ──');
          try {
            await page.locator('[placeholder*="1234"]').fill('4242 4242 4242 4242');
            await page.locator('[placeholder="MM / YY"]').fill('12 / 28');
            await page.locator('[placeholder="CVC"]').fill('123');
            await page.locator('[placeholder*="Nom"]').fill('Test Client').catch(() => {});
            await shot(page, '11-stripe-filled');
            console.log('  ✅ Carte test remplie (4242...)');
          } catch (e) {
            console.log(`  ⚠️  Remplissage Stripe : ${e.message.slice(0, 100)}`);
            await shot(page, '11-stripe-form');
          }
        }
      }
    }
  }

  // ── Pages annexes ──────────────────────────────────────────────────────
  console.log('\n── Vérifications pages annexes ──');

  await page.goto(`${BASE}/inscription`, { waitUntil: 'networkidle' });
  const hasRegForm = await page.locator('input[type="email"]').count() > 0;
  console.log(`  /inscription : ${hasRegForm ? '✅' : '❌'}`);

  await page.goto(`${BASE}/tarifs`, { waitUntil: 'networkidle' });
  const tarifContent = await page.content();
  console.log(`  /tarifs : ${tarifContent.length > 1000 ? '✅' : '❌'} (${tarifContent.length} chars)`);

  await page.goto(`${BASE}/cgu`, { waitUntil: 'networkidle' });
  const cguContent = await page.content();
  console.log(`  /cgu : ${cguContent.length > 1000 ? '✅' : '❌'} (${cguContent.length} chars)`);

  await page.goto(`${BASE}/devenir-partenaire`, { waitUntil: 'networkidle' });
  const partnerForm = await page.locator('form').count() > 0;
  console.log(`  /devenir-partenaire : ${partnerForm ? '✅ formulaire présent' : '❌'}`);

  // Test API availability
  console.log('\n── API /bookings/availability ──');
  const apiResp = await page.evaluate(async () => {
    try {
      const r = await fetch('/api/bookings/availability?bizId=test&date=2026-06-25');
      return { status: r.status, ok: r.ok };
    } catch (e) {
      return { error: e.message };
    }
  });
  console.log(`  Status : ${apiResp.status} (attendu: 500 ou 200)`);

  // ── Résumé ──────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════');
  console.log('Erreurs réseau :');
  if (networkErrors.length === 0) console.log('  ✅ Aucune');
  else networkErrors.slice(0, 10).forEach(e => console.log(`  ❌ ${e}`));

  console.log('Erreurs console :');
  if (consoleErrors.length === 0) console.log('  ✅ Aucune');
  else consoleErrors.slice(0, 5).forEach(e => console.log(`  ❌ ${e.slice(0, 160)}`));

  await browser.close();
  console.log('\n✅ Test terminé');
}

run().catch(e => {
  console.error('\nFATAL:', e.message);
  process.exit(1);
});
