// בדיקות דפדפן (Playwright) עם נתוני דמה. הרצה: node tests/e2e.test.js
const { chromium } = require('playwright');
const path = require('path');
const mock = require(process.argv[2] || './mock-data.js');
const { T, fc, md, mr } = mock;
const site = 'file://' + path.join(__dirname, '..', 'index.html');
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + ' ' + extra); } };

async function open(b, { vp = { width: 390, height: 844 }, scheme = 'light', marine = 'ok', ageMs = 0 } = {}) {
  const ctx = await b.newContext({ viewport: vp, isMobile: vp.width < 700, hasTouch: vp.width < 700, colorScheme: scheme, timezoneId: 'America/New_York' });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route(/goatcounter|zgo|fonts\./, r => r.abort());
  await p.route('**/api.open-meteo.com/**', r => r.fulfill({ json: r.request().url().includes('models=') ? md : fc }));
  await p.route('**/marine-api.open-meteo.com/**', r => marine === 'fail' ? r.fulfill({ status: 500, json: { reason: 'down' } }) : r.fulfill({ json: mr }));
  await p.route('**/ensemble-api.open-meteo.com/**', r => r.fulfill({ json: { hourly: { time: T } } }));
  if (ageMs) await p.addInitScript(a => { const n = Date.now; Date.now = () => n() + a; }, ageMs);
  await p.goto(site); await p.waitForTimeout(900);
  return { p, ctx, errs };
}

(async () => {
  const b = await chromium.launch();

  console.log('כשל חלקי ב-API');
  {
    const { p, ctx, errs } = await open(b, { marine: 'fail' });
    const vt = await p.textContent('.hero-badge .vt');
    ok(/אין מספיק נתונים/.test(vt), 'בלי גלים – הכותרת היא "אין מספיק נתונים"', vt);
    ok(!/כן, מתאים/.test(await p.textContent('#hero')), 'אין "כן, מתאים" כשחסרים גלים');
    ok(/תחזית הגלים לא נטענה/.test(await p.textContent('#banner')), 'הודעת שגיאה מוצגת');
    ok(!(await p.$$eval('.day-tab .vglyph.v0', x => x.length)), 'אף יום לא מסומן ✓ בלי גלים');
    ok(errs.length === 0, 'אין שגיאות JS', errs.join(' | '));
    await ctx.close();
  }

  console.log('נתונים ישנים');
  {
    // טעינה רגילה שומרת מטמון; אחר כך מנתקים רשת ומקדמים את השעון ב-5 שעות
    const { p, ctx, errs } = await open(b);
    ok(/התחזית נמשכה/.test(await p.textContent('#updated')), 'מוצג גיל הנתונים');
    await p.unrouteAll(); await p.route(/open-meteo|goatcounter|zgo|fonts\./, r => r.abort('internetdisconnected'));
    await p.addInitScript(() => { const n = Date.now; Date.now = () => n() + 5 * 3600e3; });
    await p.reload(); await p.waitForTimeout(1200);
    const upd = await p.textContent('#updated');
    ok(/לא עדכני/.test(upd), 'בלי רשת ועם נתונים בני 5 שעות – כתוב "לא עדכני"', upd);
    ok(await p.$eval('#updated', e => e.classList.contains('stale')), 'הכיתוב מסומן חזותית כישן');
    const ban = await p.textContent('#banner');
    ok(/אין חיבור – מוצג מידע שמור/.test(ban) && await p.isVisible('#banner'), 'מוצגת הודעה שאין חיבור ושמוצג מידע שמור', ban);
    ok(await p.$$eval('.hero-badge', x => x.length) > 0, 'התחזית השמורה עדיין מוצגת');
    ok(errs.length === 0, 'אין שגיאות JS', errs.join(' | '));
    await ctx.close();
  }

  console.log('שעה נבחרת');
  {
    const { p, ctx, errs } = await open(b);
    const chips = await p.$$('.sh');
    await chips[3].click(); await p.waitForTimeout(150);
    const st = await p.textContent('.sc-status');
    const when = await p.textContent('.sc-when');
    const hh = (when.match(/(\d\d):00/) || [])[1];
    ok(st.includes(hh + ':00'), 'הסטטוס מתייחס לשעה שנבחרה', `${st} / ${when}`);
    const lbl = await chips[3].getAttribute('aria-label');
    ok(/\d\d:00: /.test(lbl), 'לכפתור שעה יש שם נגיש עם שעה וסטטוס', lbl);
    // חצים בתוך שורת השעות לא מחליפים יום
    const dayBefore = await p.textContent('.day-tab.active');
    await p.focus('.sh.on'); await p.keyboard.press('ArrowLeft'); await p.waitForTimeout(150);
    ok((await p.textContent('.day-tab.active')) === dayBefore, 'חץ בשורת השעות לא מחליף יום');
    ok(errs.length === 0, 'אין שגיאות JS', errs.join(' | '));
    await ctx.close();
  }

  console.log('הגדרות');
  {
    const { p, ctx } = await open(b);
    await p.click('#settings-btn'); await p.waitForTimeout(150);
    ok(await p.evaluate(() => document.activeElement.id === 'settings-close'), 'הפוקוס עובר לחלון ההגדרות');
    await p.fill('#s-maxWind', '-3'); await p.click('#settings-save'); await p.waitForTimeout(150);
    ok(await p.isVisible('#settings-errors'), 'ערך לא תקין מציג שגיאה');
    ok(await p.isVisible('#settings'), 'החלון לא נסגר עם ערך שגוי');
    await p.keyboard.press('Escape'); await p.waitForTimeout(150);
    ok(await p.evaluate(() => document.activeElement.id === 'settings-btn'), 'בסגירה הפוקוס חוזר לכפתור');
    await ctx.close();
  }

  console.log('מקלדת במפת השבוע');
  {
    const { p, ctx } = await open(b);
    const rows = await p.$$('table.wk tbody tr');
    await rows[1].focus(); await p.keyboard.press('Enter'); await p.waitForTimeout(200);
    const active = await p.$$eval('.day-tab', t => t.findIndex(x => x.classList.contains('active')));
    ok(active === 1, 'Enter על שורה פותח את היום', 'active=' + active);
    await ctx.close();
  }

  console.log('גדלי מסך וערכות צבע');
  for (const [w, h] of [[360, 740], [390, 844], [768, 1024], [1280, 900]]) for (const scheme of ['light', 'dark']) {
    const { p, ctx, errs } = await open(b, { vp: { width: w, height: h }, scheme });
    let wide = 0;
    for (const v of ['brief', 'plan', 'table', 'windy']) { await p.click('#view-' + v); await p.waitForTimeout(250); wide = Math.max(wide, await p.evaluate(() => document.documentElement.scrollWidth - innerWidth)); }
    ok(wide <= 0 && errs.length === 0, `${w}px ${scheme}: בלי גלילה הצידה ובלי שגיאות`, `wide=${wide} ${errs.join('|')}`);
    await ctx.close();
  }

  await b.close();
  console.log(`\n${pass} עברו, ${fail} נכשלו`);
  process.exit(fail ? 1 : 0);
})();
