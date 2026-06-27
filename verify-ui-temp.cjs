const { chromium } = require('playwright');
const { mkdirSync } = require('fs');
const OUT = 'C:/Users/lecce/AppData/Local/Temp/claude/C--Users-lecce/ea866916-b871-4fbc-add0-2c0729c55221/scratchpad/screenshots';
mkdirSync(OUT, { recursive: true });
const BASE = 'https://www.book-n-pay.com';
const VIEWPORTS = [
  { name: 'mobile', width: 375, height: 812 },
  { name: 'desktop', width: 1280, height: 800 },
];
async function run() {
  const browser = await chromium.launch();
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await ctx.newPage();
    await page.goto(BASE + '/connexion', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/fixed-connexion-${vp.name}.png` });
    console.log(`OK fixed-connexion-${vp.name}.png`);
    await page.goto(BASE + '/inscription', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/fixed-inscription-${vp.name}.png` });
    console.log(`OK fixed-inscription-${vp.name}.png`);
    await ctx.close();
  }
  await browser.close();
}
run().catch(e => { console.error(e.message); process.exit(1); });
