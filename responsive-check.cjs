const { chromium } = require('playwright');
const { mkdirSync } = require('fs');
const OUT = 'C:/Users/lecce/.claude/jobs/7626a44d/tmp/responsive';
mkdirSync(OUT, { recursive: true });
const BASE = 'https://www.book-n-pay.com';
const pages = [
  { path: '/', name: 'home' },
  { path: '/recherche', name: 'recherche' },
  { path: '/etablissement/bia-c1', name: 'fiche' },
  { path: '/connexion', name: 'connexion' },
];
const viewports = [
  { w: 375, h: 812, label: 'mobile' },
  { w: 768, h: 1024, label: 'tablet' },
  { w: 1280, h: 900, label: 'desktop' },
];

async function run() {
  const browser = await chromium.launch();
  for (const vp of viewports) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
    for (const pg of pages) {
      const page = await ctx.newPage();
      await page.goto(BASE + pg.path, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${OUT}/${pg.name}-${vp.label}.png`, fullPage: false });
      console.log(`OK ${pg.name}-${vp.label}.png`);
      await page.close();
    }
    await ctx.close();
  }
  await browser.close();
}
run().catch(e => { console.error(e.message); process.exit(1); });
