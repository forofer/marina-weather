// צילומי מסך דטרמיניסטיים של ארבעת המסכים (שעון קבוע, נתוני דמה, הפונטים האמיתיים).
// הרצה: node tests/shots.js <תיקיית-פלט> [--font=200]   (‎--font=200 מגדיל את גודל הטקסט של הדפדפן ל-200%)
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const { T, fc, md, mr } = require(process.env.MOCK || './mock-data.js');
const out = process.argv[2] || 'shots';
const font = +((process.argv.find(a => a.startsWith('--font=')) || '').split('=')[1] || 100);
const only = (process.argv.find(a => a.startsWith('--only=')) || '').split('=')[1];
fs.mkdirSync(out, { recursive: true });
const FIXED = Date.parse('2026-10-30T10:30:00+02:00');
const FONT_CSS = `@font-face{font-family:'Heebo';src:url(https://fonts.gstatic.com/Heebo.ttf);font-weight:100 900}
@font-face{font-family:'Rubik';src:url(https://fonts.gstatic.com/Rubik.ttf);font-weight:300 900}`;
const configs = [
  ['m-light', { width: 390, height: 844 }, 'light', true],
  ['m-dark', { width: 390, height: 844 }, 'dark', true],
  ['d-light', { width: 1366, height: 900 }, 'light', false],
].filter(c => !only || only.split(',').includes(c[0]));
async function applyFont(p) {
  if (font === 100) return;
  const s = await p.context().newCDPSession(p); await s.send('Page.enable');
  await s.send('Page.setFontSizes', { fontSizes: { standard: 16 * font / 100, fixed: 13 * font / 100 } });
}
async function setup(b, vp, scheme, mobile) {
  const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile, colorScheme: scheme, reducedMotion: 'reduce', timezoneId: 'Asia/Jerusalem' });
  const p = await ctx.newPage();
  await applyFont(p);
  await p.addInitScript(t => {
    const R = Date;
    class D extends R { constructor(...a) { a.length ? super(...a) : super(t); } static now() { return t; } }
    window.Date = D;
    try { localStorage.setItem('introSeen', '1'); } catch (_) {}
  }, FIXED);
  await p.route(/goatcounter|zgo|openseamap|arcgis/, r => r.abort());
  await p.route('**/fonts.googleapis.com/**', r => r.fulfill({ body: FONT_CSS, contentType: 'text/css' }));
  await p.route('**/fonts.gstatic.com/**', r => r.fulfill({ path: path.join(__dirname, 'fonts', path.basename(new URL(r.request().url()).pathname)) }));
  await p.route('**/api.open-meteo.com/**', r => r.fulfill({ json: r.request().url().includes('models=') ? md : fc }));
  await p.route('**/marine-api.open-meteo.com/**', r => r.fulfill({ json: mr }));
  await p.route('**/ensemble-api.open-meteo.com/**', r => r.fulfill({ json: { hourly: { time: T } } }));
  await p.route('**/embed.windy.com/**', r => r.fulfill({ body: '<html><body style="margin:0;background:#3a6f9a;font:16px sans-serif;color:#fff;display:grid;place-items:center;height:100vh">Windy</body></html>', contentType: 'text/html' }));
  await p.goto('file://' + path.join(__dirname, '..', 'index.html')); await p.waitForTimeout(900);
  return { ctx, p };
}
// צילום עמוד מלא. בטקסט מוגדל: צילום fullPage מאפס את גודל הגופן, אז מגדילים את חלון התצוגה ידנית ומחילים שוב
async function shoot(p, file, vp) {
  if (font === 100) return p.screenshot({ path: file, fullPage: true, animations: 'disabled' });
  let h = 0;
  for (let i = 0; i < 4; i++) {
    await applyFont(p); await p.waitForTimeout(150);
    const nh = await p.evaluate(() => document.documentElement.scrollHeight);
    if (nh === h) break;
    h = nh; await p.setViewportSize({ width: vp.width, height: h });
  }
  await applyFont(p); await p.waitForTimeout(150);
  const rf = await p.evaluate(() => getComputedStyle(document.documentElement).fontSize);
  await p.screenshot({ path: file, animations: 'disabled' });
  await p.setViewportSize(vp);
  return rf;
}
module.exports = { setup, FIXED };
if (require.main === module) (async () => {
  const b = await chromium.launch();
  for (const [name, vp, scheme, mobile] of configs) {
    const { ctx, p } = await setup(b, vp, scheme, mobile);
    for (const v of ['brief', 'plan', 'table', 'windy']) {
      await applyFont(p); // צילום עמוד מלא מאפס את גודל הגופן – מחילים מחדש לפני כל מסך
      await p.click('#view-' + v); await p.waitForTimeout(400);
      // תוכן המפה החיצונית (Windy) לא בשליטת האתר – מצלמים רק את המסגרת, כדי שההשוואה תהיה יציבה
      if (v === 'windy' && !process.env.SHOW_EXTERNAL) await p.addStyleTag({ content: '#windy-frame { visibility: hidden !important; } .windy-loading { visibility: hidden !important; }' });
      if (v === 'brief') await p.screenshot({ path: `${out}/${name}-${v}-screen.png`, animations: 'disabled' });
      // בצילום עמוד מלא סרגל הניווט הקבוע מוסתר, כדי שלא יכסה תוכן באמצע התמונה
      const st = await p.addStyleTag({ content: '@media (max-width: 899px) { .view-tabs { display: none !important; } }' });
      const rf = await shoot(p, `${out}/${name}-${v}.png`, vp);
      if (font !== 100) console.log(name, v, 'root font', rf);
      await st.evaluate(e => e.remove());
    }
    await p.click('#settings-btn'); await p.waitForTimeout(250);
    await p.screenshot({ path: `${out}/${name}-settings.png`, animations: 'disabled' });
    await ctx.close();
  }
  await b.close();
})();
