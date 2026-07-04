/**
 * test-paiement-4242.mjs
 * Flow complet : login → service → date → créneau → paiement Stripe → confirmation
 * Carte test : 4242 4242 4242 4242
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const EMAIL = process.env.TEST_ACCOUNT_EMAIL || 'testbnp@example.com';
const PASSWORD = process.env.TEST_ACCOUNT_PASSWORD;
if (!PASSWORD) {
  console.error('❌ Variable TEST_ACCOUNT_PASSWORD requise (mot de passe du compte de test).');
  process.exit(1);
}
const SUPABASE_URL = 'https://suyfsuvrbdpnnijxspge.supabase.co';
const SUPABASE_ANON = 'sb_publishable_klT_ROWDrKKuMfp2RBoTBQ_XqasU7KJ';

function log(emoji, msg) { console.log(`  ${emoji}  ${msg}`); }
function ok(msg) { log('✅', msg); }
function fail(msg, detail = '') { log('❌', `${msg}${detail ? ' — ' + detail : ''}`); }
function info(msg) { log('ℹ️ ', msg); }
function step(msg) { console.log(`\n  ─── ${msg} ───`); }

async function run() {
  console.log('\n════════════════════════════════════════════════════════════');
  console.log('  TEST PAIEMENT COMPLET — CARTE 4242 4242 4242 4242');
  console.log(`  ${new Date().toLocaleString('fr-FR')}`);
  console.log('════════════════════════════════════════════════════════════\n');

  const browser = await chromium.launch({ headless: true, slowMo: 100 });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
  });
  const page = await context.newPage();

  // Capturer les erreurs réseau 5xx
  const errors5xx = [];
  page.on('response', r => { if (r.status() >= 500 && !r.url().includes('stripe.com')) errors5xx.push(`${r.status()} ${r.url()}`); });

  try {
    // ─── 1. Auth Supabase ──────────────────────────────────────────────────────
    step('1. Authentification');
    const authRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    const session = await authRes.json();
    if (!session.access_token) { fail('Login Supabase échoué', JSON.stringify(session).slice(0, 80)); await browser.close(); return; }
    ok(`Login ${EMAIL} → token reçu`);

    // Injecter la session dans le localStorage (format Supabase SSR)
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    const storageKey = `sb-${SUPABASE_URL.split('//')[1].split('.')[0]}-auth-token`;
    await page.evaluate(([key, s]) => {
      localStorage.setItem(key, JSON.stringify({
        access_token: s.access_token,
        refresh_token: s.refresh_token,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        expires_in: 3600,
        token_type: 'bearer',
        user: s.user,
      }));
    }, [storageKey, session]);
    ok('Session injectée dans localStorage');

    // ─── 2. Choisir un établissement ──────────────────────────────────────────
    step('2. Sélection établissement');
    await page.goto(`${BASE}/etablissement/bia-c1`, { waitUntil: 'networkidle', timeout: 30000 });
    const bizTitle = await page.locator('h1').first().textContent();
    ok(`Page établissement : "${bizTitle?.trim()}"`);

    // ─── 3. Choisir une prestation ────────────────────────────────────────────
    step('3. Sélection prestation');
    const serviceBtns = page.locator('button').filter({ hasText: /€/ });
    const svcCount = await serviceBtns.count();
    if (svcCount === 0) { fail('Aucune prestation trouvée'); await browser.close(); return; }
    const svcText = await serviceBtns.first().textContent();
    await serviceBtns.first().click();
    await page.waitForTimeout(600);
    ok(`Prestation sélectionnée : "${svcText?.trim().slice(0, 40)}"`);

    // Si praticien proposé → "Pas de préférence"
    const noPref = page.locator('button').filter({ hasText: /Pas de préférence/i });
    if (await noPref.count() > 0) {
      await noPref.click();
      await page.waitForTimeout(400);
      ok('Praticien : pas de préférence');
    }

    // ─── 4. Choisir date + heure ──────────────────────────────────────────────
    step('4. Sélection date & heure');
    const dayBtns = page.locator('button:not([disabled])').filter({ hasText: /lun|mar|mer|jeu|ven|sam|dim/i });
    const dayCount = await dayBtns.count();
    if (dayCount === 0) { fail('Aucun jour disponible'); await browser.close(); return; }

    // Essayer jusqu'à trouver un jour avec des créneaux
    let slotLabel = null;
    for (let i = 0; i < Math.min(dayCount, 7); i++) {
      await dayBtns.nth(i).click();
      await page.waitForTimeout(1500);
      const slots = page.locator('button:not([disabled])').filter({ hasText: /^\d{2}:\d{2}$/ });
      if (await slots.count() > 0) {
        const dayText = await dayBtns.nth(i).textContent();
        ok(`Jour sélectionné : "${dayText?.trim()}"`);
        slotLabel = (await slots.first().textContent())?.trim();
        await slots.first().click();
        await page.waitForTimeout(400);
        ok(`Créneau sélectionné : ${slotLabel}`);
        break;
      }
    }
    if (!slotLabel) { fail('Aucun créneau disponible sur les 7 prochains jours'); await browser.close(); return; }

    // Bouton Continuer
    const continueBtn = page.locator('button').filter({ hasText: /Continuer/i });
    if (await continueBtn.count() > 0) {
      await continueBtn.click();
      await page.waitForTimeout(1200);
      ok('Bouton "Continuer" cliqué');
    }

    // ─── 5. Auth wall (si session localStorage non reconnue par SSR) ──────────
    const isAuthWall = await page.locator('text=Identification').count() > 0;
    if (isAuthWall) {
      step('5. Auth wall → connexion email/password');
      // Basculer sur "Se connecter" si nécessaire
      const switchBtn = page.locator('button[type="button"]').filter({ hasText: /Se connecter/i });
      if (await switchBtn.count() > 0) {
        await switchBtn.click();
        await page.waitForTimeout(300);
      }
      await page.locator('input[type="email"]').fill(EMAIL);
      await page.locator('input[type="password"]').fill(PASSWORD);
      await page.locator('button[type="submit"]').click();
      await page.waitForTimeout(8000);
      ok('Connexion via auth wall effectuée');
    } else {
      step('5. Auth wall');
      ok('Pas d\'auth wall — session reconnue');
    }

    // ─── 6. Récapitulatif paiement ────────────────────────────────────────────
    step('6. Récapitulatif paiement');
    const content = await page.content();
    const hasFrais = content.includes('Frais de réservation');
    const hasTotal = content.includes('Total à payer');
    if (hasFrais) ok('Frais de réservation affichés');
    else fail('Frais de réservation absents');
    if (hasTotal) ok('Total à payer affiché');
    else fail('Total à payer absent');

    // Extraire le montant du bouton Payer
    const payBtn = page.locator('button').filter({ hasText: /Payer/i }).first();
    const payBtnText = await payBtn.textContent();
    ok(`Bouton : "${payBtnText?.trim()}"`);

    // ─── 7. Déclenchement Stripe Checkout ────────────────────────────────────
    step('7. Stripe Checkout');
    await payBtn.click();
    info('Clic sur Payer — attente redirection Stripe...');
    await page.waitForURL(/checkout\.stripe\.com/, { timeout: 20000 }).catch(() => null);
    const stripeUrl = page.url();

    if (!stripeUrl.includes('checkout.stripe.com')) {
      fail('Redirection Stripe non atteinte', `URL: ${stripeUrl.slice(0, 80)}`);
      await browser.close(); return;
    }
    ok(`Stripe Checkout atteint : ${stripeUrl.slice(0, 70)}...`);

    // Attendre que la page Stripe se charge (Stripe génère du trafic continu → pas networkidle)
    await page.waitForLoadState('domcontentloaded', { timeout: 20000 });
    await page.waitForTimeout(5000);
    info('Page Stripe chargée');

    // ─── 8. Remplir le formulaire Stripe ──────────────────────────────────────
    step('8. Remplissage formulaire Stripe');

    // Stripe utilise des iframes pour les champs de carte
    // Champ email (si demandé)
    const emailInput = page.locator('input[name="email"], input[autocomplete="email"], input[placeholder*="mail" i]').first();
    if (await emailInput.count() > 0 && await emailInput.isVisible()) {
      await emailInput.fill(EMAIL);
      ok('Email rempli');
    }

    // Champ numéro de carte — peut être dans un iframe Stripe
    const cardFrame = page.frameLocator('iframe[name*="card"], iframe[src*="stripe"], iframe[title*="card" i]').first();

    // Essai 1 : champ carte dans iframe
    const cardInFrame = cardFrame.locator('input[name="cardnumber"], input[placeholder*="4242" i], input[autocomplete*="cc-number"]');
    if (await cardInFrame.count() > 0) {
      await cardInFrame.fill('4242424242424242');
      ok('Numéro de carte rempli (iframe)');
    } else {
      // Essai 2 : champ carte direct sur la page (Stripe Checkout new UI)
      const cardDirect = page.locator('input[name="cardnumber"], input[placeholder*="1234" i], [data-testid="card-number"]').first();
      if (await cardDirect.count() > 0) {
        await cardDirect.fill('4242424242424242');
        ok('Numéro de carte rempli (direct)');
      } else {
        // Essai 3 : chercher tous les inputs visibles et identifier le champ carte
        const allInputs = await page.locator('input:visible').all();
        info(`${allInputs.length} inputs visibles sur la page Stripe`);

        // Stripe Checkout 2024 : utilise data-elements-stable-field-name
        const cardField = page.locator('[data-elements-stable-field-name="cardNumber"]');
        if (await cardField.count() > 0) {
          await cardField.fill('4242424242424242');
          ok('Numéro de carte rempli (data-elements)');
        } else {
          fail('Champ numéro de carte introuvable');
        }
      }
    }

    await page.waitForTimeout(500);

    // Expiration
    const expFields = [
      page.locator('[data-elements-stable-field-name="cardExpiry"]'),
      cardFrame.locator('input[name="exp-date"], input[placeholder*="MM"]'),
      page.locator('input[name="exp-date"], input[placeholder*="MM / AA" i], input[autocomplete*="cc-exp"]').first(),
    ];
    for (const f of expFields) {
      try {
        if (await f.count() > 0 && await f.isVisible()) {
          await f.fill('1228');
          ok('Expiration remplie (12/28)');
          break;
        }
      } catch {}
    }

    await page.waitForTimeout(500);

    // CVC
    const cvcFields = [
      page.locator('[data-elements-stable-field-name="cardCvc"]'),
      cardFrame.locator('input[name="cvc"], input[placeholder*="CVC" i]'),
      page.locator('input[name="cvc"], input[placeholder*="CVC" i], input[autocomplete*="cc-csc"]').first(),
    ];
    for (const f of cvcFields) {
      try {
        if (await f.count() > 0 && await f.isVisible()) {
          await f.fill('123');
          ok('CVC rempli (123)');
          break;
        }
      } catch {}
    }

    await page.waitForTimeout(500);

    // Nom du titulaire
    const nameFields = [
      page.locator('input[name="billingName"], input[placeholder*="Nom complet" i], input[placeholder*="Full name" i], input[autocomplete*="name"]').first(),
      page.locator('[data-elements-stable-field-name="billingName"]').first(),
    ];
    for (const f of nameFields) {
      try {
        if (await f.count() > 0 && await f.isVisible()) {
          await f.fill('Test BnP');
          ok('Nom du titulaire rempli (Test BnP)');
          break;
        }
      } catch {}
    }

    // Code postal / billing zip (parfois demandé)
    const zipField = page.locator('input[name="postalCode"], input[placeholder*="postal" i], input[autocomplete*="postal"]').first();
    if (await zipField.count() > 0 && await zipField.isVisible()) {
      await zipField.fill('75001');
      ok('Code postal rempli (75001)');
    }

    // Screenshot avant soumission
    await page.screenshot({ path: 'stripe-avant-paiement.png' });
    info('Screenshot sauvegardé → stripe-avant-paiement.png');

    // ─── 9. Soumettre le paiement ─────────────────────────────────────────────
    step('9. Soumission paiement Stripe');

    // Bouton Pay/Payer sur Stripe
    const submitSelectors = [
      'button[type="submit"]',
      'button[data-testid="hosted-payment-submit-button"]',
      'button[data-qa="pay-button"]',
      'button[class*="SubmitButton"]',
    ];
    let submitBtn = null;
    for (const sel of submitSelectors) {
      const btn = page.locator(sel).first();
      if (await btn.count() > 0 && await btn.isVisible()) {
        submitBtn = btn;
        const btnText = await btn.textContent();
        info(`Bouton soumission trouvé : "${btnText?.trim().slice(0, 40)}"`);
        break;
      }
    }

    if (!submitBtn) {
      fail('Bouton de soumission Stripe introuvable');
      await page.screenshot({ path: 'stripe-debug.png' });
      info('Screenshot debug → stripe-debug.png');
      await browser.close(); return;
    }

    await submitBtn.click();
    info('Soumission effectuée — attente confirmation...');

    // Attendre le retour sur le site Book'nPay
    await page.waitForURL(/localhost:3000/, { timeout: 30000 }).catch(async () => {
      // Peut prendre plus de temps
      await page.waitForTimeout(10000);
    });

    await page.waitForTimeout(3000);
    const finalUrl = page.url();
    info(`URL finale : ${finalUrl}`);

    // ─── 10. Vérification confirmation ───────────────────────────────────────
    step('10. Page de confirmation');

    if (finalUrl.includes('/confirmation')) {
      const confirmContent = await page.content();
      if (confirmContent.includes('confirmée')) ok('✨ Réservation confirmée affichée');
      else if (confirmContent.includes('confirmation')) ok('Page /confirmation atteinte');
      else fail('Texte confirmation absent');

      if (finalUrl.includes('booking=')) {
        const bookingId = new URL(finalUrl).searchParams.get('booking');
        ok(`Booking ID : ${bookingId}`);
      }

      await page.screenshot({ path: 'confirmation-final.png' });
      ok('Screenshot → confirmation-final.png');
    } else if (finalUrl.includes('localhost:3000')) {
      fail('Retour sur le site mais pas sur /confirmation', finalUrl.slice(0, 80));
      await page.screenshot({ path: 'retour-site.png' });
    } else if (finalUrl.includes('checkout.stripe.com')) {
      // Encore sur Stripe — peut-être une erreur de carte ou le paiement n'a pas abouti
      const stripeContent = await page.content();
      const hasError = stripeContent.toLowerCase().includes('error') || stripeContent.toLowerCase().includes('erreur');
      if (hasError) fail('Erreur sur Stripe Checkout', 'Vérifier screenshot stripe-avant-paiement.png');
      else fail('Toujours sur Stripe après soumission', 'Timeout ou formulaire incomplet');
      await page.screenshot({ path: 'stripe-apres-soumission.png' });
      info('Screenshot → stripe-apres-soumission.png');
    } else {
      fail('URL finale inattendue', finalUrl.slice(0, 80));
    }

    // ─── Erreurs réseau ───────────────────────────────────────────────────────
    step('Synthèse');
    if (errors5xx.length > 0) fail(`${errors5xx.length} erreur(s) 5xx`, errors5xx.join(' | '));
    else ok('Aucune erreur 5xx tout au long du flux');

  } catch (e) {
    console.error('\n  EXCEPTION :', e.message);
    try { await page.screenshot({ path: 'stripe-exception.png' }); } catch {}
  } finally {
    await browser.close();
  }

  console.log('\n════════════════════════════════════════════════════════════\n');
}

run();
