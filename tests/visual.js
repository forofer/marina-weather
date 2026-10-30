// צילומי מסך דטרמיניסטיים (שעון קבוע, בלי אנימציה) להשוואה לפני/אחרי שינויים.
// הרצה: node tests/visual.js <תיקיית-פלט>
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const { T, fc, md, mr } = require('./mock-data.js');
const out = process.argv[2] || 'vr-out';
fs.mkdirSync(out, { recursive: true });
const FIXED = Date.parse('2026-10-30T10:30:00+02:00');
(async () => {
  const b = await chromium.launch();
  for (const [name, vp, scheme] of [['m-light', { width: 390, height: 844 }, 'light'], ['m-dark', { width: 390, height: 844 }, 'dark'], ['d-light', { width: 1280, height: 900 }, 'light']]) {
    const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: 1, colorScheme: scheme, reducedMotion: 'reduce', timezoneId: 'Asia/Jerusalem' });
    const p = await ctx.newPage();
    await p.addInitScript(t => {
      const R = Date;
      class D extends R { constructor(...a) { a.length ? super(...a) : super(t); } static now() { return t; } }
      window.Date = D;
      try { localStorage.setItem('introSeen', '1'); } catch (_) {}
    }, FIXED);
    await p.route(/goatcounter|zgo|fonts\.|openseamap|arcgis/, r => r.abort());
    await p.route('**/api.open-meteo.com/**', r => r.fulfill({ json: r.request().url().includes('models=') ? md : fc }));
    await p.route('**/marine-api.open-meteo.com/**', r => r.fulfill({ json: mr }));
    await p.route('**/ensemble-api.open-meteo.com/**', r => r.fulfill({ json: { hourly: { time: T } } }));
    await p.route('**/embed.windy.com/**', r => r.fulfill({ body: '<html></html>', contentType: 'text/html' }));
    await p.goto('file://' + path.join(__dirname, '..', 'index.html')); await p.waitForTimeout(800);
    for (const v of ['brief', 'plan', 'table']) {
      await p.click('#view-' + v); await p.waitForTimeout(300);
      await p.screenshot({ path: `${out}/${name}-${v}.png`, fullPage: true, animations: 'disabled' });
    }
    await p.click('#settings-btn'); await p.waitForTimeout(200);
    await p.screenshot({ path: `${out}/${name}-settings.png`, animations: 'disabled' });
    await ctx.close();
  }
  await b.close();
})();
