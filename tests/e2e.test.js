// בדיקות דפדפן (Playwright) עם נתוני דמה. הרצה: node tests/e2e.test.js
const { chromium } = require('playwright');
const path = require('path');
const mock = require(process.argv[2] || './mock-data.js');
const { T, fc, md, mr } = mock;
const site = 'file://' + path.join(__dirname, '..', 'index.html');
const FIXED = Date.parse('2026-10-30T10:30:00+02:00');
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + ' ' + extra); } };

async function open(b, { vp = { width: 390, height: 844 }, scheme = 'light', marine = 'ok', font = 100, fixed = true } = {}) {
  const mobile = vp.width < 900;
  const ctx = await b.newContext({ viewport: vp, isMobile: mobile, hasTouch: mobile, colorScheme: scheme, timezoneId: 'Asia/Jerusalem', reducedMotion: 'reduce' });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  if (font !== 100) { const s = await ctx.newCDPSession(p); await s.send('Page.enable'); await s.send('Page.setFontSizes', { fontSizes: { standard: 16 * font / 100, fixed: 13 * font / 100 } }); }
  if (fixed) await p.addInitScript(t => { const R = Date; class D extends R { constructor(...a) { a.length ? super(...a) : super(t); } static now() { return t; } } window.Date = D; try { localStorage.setItem('introSeen', '1'); } catch (_) {} }, FIXED);
  await p.route(/goatcounter|zgo|fonts\.|openseamap|arcgis/, r => r.abort());
  await p.route('**/api.open-meteo.com/**', r => r.fulfill({ json: r.request().url().includes('models=') ? md : fc }));
  await p.route('**/marine-api.open-meteo.com/**', r => marine === 'fail' ? r.fulfill({ status: 500, json: { reason: 'down' } }) : r.fulfill({ json: mr }));
  await p.route('**/ensemble-api.open-meteo.com/**', r => r.fulfill({ json: { hourly: { time: T } } }));
  await p.route('**/embed.windy.com/**', r => r.fulfill({ body: '<html></html>', contentType: 'text/html' }));
  await p.goto(site); await p.waitForTimeout(900);
  return { p, ctx, errs };
}
const txt = (p, sel) => p.textContent(sel).then(t => (t || '').replace(/\s+/g, ' ').trim());
// טקסט שנחתך: אלמנט עם overflow מוסתר שהתוכן שלו רחב/גבוה ממנו, או טקסט שיוצא מגבולות המסך
const clipped = p => p.evaluate(() => {
  const out = [], W = innerWidth;
  for (const e of document.querySelectorAll('main:not(.hidden) *, .top *, .days *')) {
    if (!e.offsetParent || e.closest('svg') || e.closest('.hours, .day-tabs, .table-wrap, .week, .windy-wrap')) continue;
    const cs = getComputedStyle(e), b = e.getBoundingClientRect();
    if (!b.width) continue;
    if ((cs.overflowX === 'hidden' || cs.overflowX === 'clip') && e.scrollWidth > e.clientWidth + 1 && !e.matches('.decision, .hc-art')) out.push('overflow:' + e.className);
    if (e.children.length === 0 && e.textContent.trim() && (b.right > W + 1 || b.left < -1)) out.push('offscreen:' + (e.className || e.tagName) + ':' + e.textContent.trim().slice(0, 20));
    const box = e.children.length === 0 && e.textContent.trim() && e.parentElement.closest('.card, .decision, .wk-item, .sumrow, .metric, .day-tab, .btn, .pill');
    if (box) { const c = box.getBoundingClientRect(); if (b.right > c.right + 1 || b.left < c.left - 1) out.push('outside-box:' + (e.className || e.tagName) + ':' + e.textContent.trim().slice(0, 20)); }
  }
  return out.slice(0, 6);
});

(async () => {
  const b = await chromium.launch();

  console.log('כשל חלקי ב-API');
  {
    const { p, ctx, errs } = await open(b, { marine: 'fail' });
    const vt = await txt(p, '#decision .dc-title');
    ok(/אין מספיק נתונים/.test(vt), 'בלי גלים – הכותרת היא "אין מספיק נתונים"', vt);
    ok(!/כן, מתאים/.test(await txt(p, '#decision')), 'אין "כן, מתאים" כשחסרים גלים');
    ok(/תחזית הגלים לא נטענה/.test(await txt(p, '#banner')), 'הודעת שגיאה מוצגת');
    ok(!(await p.$$eval('.day-tab .dot.lv0', x => x.length)), 'אף יום לא מסומן "מתאים" בלי גלים');
    ok(errs.length === 0, 'אין שגיאות JS', errs.join(' | '));
    await ctx.close();
  }

  console.log('נתונים ישנים ובלי רשת');
  {
    const { p, ctx, errs } = await open(b, { fixed: false });
    ok(/התחזית נמשכה/.test(await txt(p, '#updated')), 'מוצג גיל הנתונים');
    await p.unrouteAll(); await p.route(/open-meteo|goatcounter|zgo|fonts\./, r => r.abort('internetdisconnected'));
    await p.addInitScript(() => { const n = Date.now; Date.now = () => n() + 5 * 3600e3; });
    await p.reload(); await p.waitForTimeout(1200);
    const upd = await txt(p, '#updated');
    ok(/לא עדכני/.test(upd), 'בלי רשת ועם נתונים בני 5 שעות – כתוב "לא עדכני"', upd);
    ok(await p.$eval('#updated', e => e.classList.contains('stale')), 'הכיתוב מסומן חזותית כישן');
    ok(/אין חיבור – מוצג מידע שמור/.test(await txt(p, '#banner')) && await p.isVisible('#banner'), 'מוצגת הודעה שאין חיבור ושמוצג מידע שמור');
    ok(/לא עודכנה/.test(await txt(p, '#decision')), 'בכרטיס ההחלטה יש אזהרה שהתחזית לא עודכנה');
    ok(errs.length === 0, 'אין שגיאות JS', errs.join(' | '));
    await ctx.close();
  }

  console.log('שעה נבחרת וגרף');
  {
    const { p, ctx, errs } = await open(b);
    const chips = await p.$$('.hr');
    await chips[6].click(); await p.waitForTimeout(150);
    const hh = await p.$eval('.hr.on', e => e.dataset.h.padStart(2, '0'));
    ok((await txt(p, '#hc-title')).includes(hh + ':00'), 'כותרת התנאים מתייחסת לשעה שנבחרה', hh);
    ok((await txt(p, '.trend-read .h')) === hh + ':00', 'הגרף מסמן את אותה שעה');
    const lbl = await p.$eval('.hr.on', e => e.getAttribute('aria-label'));
    ok(/\d\d:00: /.test(lbl), 'לכפתור שעה יש שם נגיש עם שעה וסטטוס', lbl);
    // נגיעה בגרף בוחרת שעה ומעדכנת את כרטיס הנתונים
    const svg = await p.$('#trend svg.trend-svg'); const bb = await svg.boundingBox();
    await p.mouse.click(bb.x + bb.width - 12, bb.y + 60); await p.waitForTimeout(150);
    const last = await p.$$eval('.hr', x => x[x.length - 1].dataset.h.padStart(2, '0'));
    ok((await txt(p, '#hc-title')).includes(last + ':00'), 'לחיצה בקצה הגרף בוחרת את השעה האחרונה ומעדכנת את הכרטיס', await txt(p, '#hc-title'));
    const dayBefore = await txt(p, '.day-tab.active');
    await p.focus('.hr.on'); await p.keyboard.press('ArrowLeft'); await p.waitForTimeout(150);
    ok((await txt(p, '.day-tab.active')) === dayBefore, 'חץ בשורת השעות לא מחליף יום');
    ok(errs.length === 0, 'אין שגיאות JS', errs.join(' | '));
    await ctx.close();
  }

  console.log('עקביות בין המסכים');
  {
    const { p, ctx, errs } = await open(b);
    const title = await txt(p, '#decision .dc-title');
    await p.click('#view-table'); await p.waitForTimeout(200);
    ok((await txt(p, '#summary .pill')) === title, 'אותה החלטה בסיכום ובנתונים', `${title} / ${await txt(p, '#summary .pill')}`);
    // היום והשעה נשמרים בין המסכים
    await p.click('#view-brief'); await p.waitForTimeout(150);
    await p.click('.day-tab:nth-child(2)'); await p.waitForTimeout(150);
    await p.click('.hr:nth-child(5)'); await p.waitForTimeout(150);
    const h = await p.$eval('.hr.on', e => e.dataset.h);
    await p.click('#view-table'); await p.waitForTimeout(200);
    ok(/מחר/.test(await txt(p, '#summary')), 'היום שנבחר נשמר במעבר לנתונים');
    ok(await p.$eval('.fc thead th.sel', e => e.dataset.h) === h, 'השעה שנבחרה מסומנת בטבלה');
    await p.click('.fc thead th[data-h="15"]'); await p.waitForTimeout(150);
    await p.click('#view-brief'); await p.waitForTimeout(150);
    ok((await txt(p, '#hc-title')).includes('15:00'), 'בחירת שעה בטבלה מעדכנת את הסיכום');
    ok(errs.length === 0, 'אין שגיאות JS', errs.join(' | '));
    await ctx.close();
  }

  console.log('תכנון');
  {
    const { p, ctx, errs } = await open(b);
    const win = await txt(p, '#decision .dc-window .v');
    await p.click('#plan-window'); await p.waitForTimeout(250);
    ok(await p.isVisible('#plan-view'), '"תכנן הפלגה בחלון הזה" עובר למסך התכנון');
    const from = await p.$eval('#p-from', e => e.value.padStart(2, '0'));
    ok(win.startsWith(from + ':00'), 'שעת היציאה היא תחילת החלון', `${win} / ${from}`);
    ok((await txt(p, '#p-result .dc-scope')).includes(win.split(' ')[0]), 'כרטיס התכנון מציין את היום והשעות');
    // 09:00–14:00: שום טווח לא נמשך אחרי שעת החזרה
    await p.selectOption('#p-from', '9'); await p.selectOption('#p-to', '14'); await p.waitForTimeout(200);
    const res = await txt(p, '#p-result .dc-why') + ' ' + await txt(p, '.seg-list');
    ok(!/15:00/.test(res), 'בהפלגה 09:00–14:00 אין טווח שמסתיים ב-15:00', res);
    ok(/14:00/.test(await txt(p, '.seg-list')), 'המלצת המפרשים מסתיימת בשעת החזרה');
    ok(!(await p.$('.plan-form .primary')), 'אין כפתור ראשי בטופס – התוצאה מתעדכנת לבד');
    await p.click('#p-save'); await p.waitForTimeout(200);
    ok(/נשמרה/.test(await txt(p, '#p-save')) && await p.isVisible('#p-saved .trip'), 'שמירה מוסיפה הפלגה לרשימה');
    ok(errs.length === 0, 'אין שגיאות JS', errs.join(' | '));
    await ctx.close();
  }

  console.log('נתונים: השוואת מודלים סגורה');
  {
    const { p, ctx } = await open(b);
    await p.click('#view-table'); await p.waitForTimeout(200);
    const has = await p.$('#models-toggle');
    if (has) {
      ok(!(await p.$('.fc tr.mrow')), 'השוואת המודלים סגורה כברירת מחדל');
      await p.click('#models-toggle'); await p.waitForTimeout(150);
      ok(!!(await p.$('.fc tr.mrow')), 'לחיצה פותחת את השוואת המודלים');
    } else ok(true, 'אין נתוני מודלים בדמה – אין כפתור');
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

  console.log('השבוע');
  {
    const { p, ctx } = await open(b);
    await p.click('.wk-item:nth-child(2)'); await p.waitForTimeout(200);
    let active = await p.$$eval('.day-tab', t => t.findIndex(x => x.classList.contains('active')));
    ok(active === 1, 'לחיצה על יום ברשימה פותחת אותו', 'active=' + active);
    await p.click('#week-more summary'); await p.waitForTimeout(100);
    const rows = await p.$$('table.wk tbody tr');
    await rows[0].focus(); await p.keyboard.press('Enter'); await p.waitForTimeout(200);
    active = await p.$$eval('.day-tab', t => t.findIndex(x => x.classList.contains('active')));
    ok(active === 0, 'Enter על שורה בתצוגה המפורטת פותח את היום', 'active=' + active);
    await ctx.close();
  }

  console.log('ניווט: מיקום גלילה ותוכן מתחת לסרגל');
  {
    const { p, ctx } = await open(b);
    await p.evaluate(() => window.scrollTo(0, 700)); await p.waitForTimeout(100);
    await p.click('#view-table'); await p.waitForTimeout(200);
    ok(await p.evaluate(() => scrollY) < 50, 'מסך חדש נפתח מלמעלה');
    await p.click('#view-brief'); await p.waitForTimeout(200);
    const y = await p.evaluate(() => scrollY);
    ok(Math.abs(y - 700) < 30, 'חזרה לסיכום שומרת את מיקום הגלילה', 'y=' + y);
    await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await p.waitForTimeout(100);
    const gap = await p.evaluate(() => document.querySelector('#view-tabs').getBoundingClientRect().top - document.querySelector('.foot').getBoundingClientRect().bottom);
    ok(gap >= 0, 'סוף הדף לא מוסתר מתחת לסרגל הניווט', 'gap=' + gap);
    await ctx.close();
  }

  console.log('מפה');
  {
    const { p, ctx } = await open(b);
    await p.click('#view-windy'); await p.waitForTimeout(300);
    await p.click('.map-bar .seg[data-overlay="waves"]'); await p.waitForTimeout(100);
    ok(await p.$eval('.map-bar .seg[data-overlay="waves"]', e => e.getAttribute('aria-checked') === 'true'), 'בחירת שכבה מסומנת');
    ok(/overlay=waves/.test(await p.$eval('#windy-frame', e => e.src)), 'המפה עוברת לשכבת גלים');
    const gap = await p.evaluate(() => document.querySelector('#view-tabs').getBoundingClientRect().top - document.querySelector('#windy-wrap').getBoundingClientRect().bottom);
    ok(gap >= 0 && gap < 40, 'המפה ממלאת את הגובה שמעל סרגל הניווט', 'gap=' + gap);
    await ctx.close();
  }

  console.log('גדלי מסך וערכות צבע');
  for (const [w, h] of [[360, 740], [390, 844], [768, 1024], [1366, 900]]) for (const scheme of ['light', 'dark']) {
    const { p, ctx, errs } = await open(b, { vp: { width: w, height: h }, scheme });
    let wide = 0, clip = [];
    for (const v of ['brief', 'plan', 'table', 'windy']) {
      await p.click('#view-' + v); await p.waitForTimeout(250);
      wide = Math.max(wide, await p.evaluate(() => document.documentElement.scrollWidth - innerWidth));
      clip = clip.concat((await clipped(p)).map(x => v + ':' + x));
    }
    ok(wide <= 0 && errs.length === 0 && !clip.length, `${w}px ${scheme}: בלי גלילה הצידה, בלי טקסט חתוך ובלי שגיאות`, `wide=${wide} ${clip.join(' | ')} ${errs.join('|')}`);
    await ctx.close();
  }

  console.log('הגדלת טקסט אמיתית ל-200% (הגדרת גודל הגופן של הדפדפן)');
  for (const [w, h] of [[390, 844], [1366, 900]]) {
    const { p, ctx, errs } = await open(b, { vp: { width: w, height: h }, font: 200 });
    const root = await p.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
    const big = await p.$eval('.m-value', e => parseFloat(getComputedStyle(e).fontSize));
    ok(root === 32 && big >= 56, `${w}px: הכתב באמת גדל (בסיס ${root}px, מספר מרכזי ${big}px)`);
    let wide = 0, clip = [];
    for (const v of ['brief', 'plan', 'table', 'windy']) {
      await p.click('#view-' + v); await p.waitForTimeout(250);
      wide = Math.max(wide, await p.evaluate(() => document.documentElement.scrollWidth - innerWidth));
      clip = clip.concat((await clipped(p)).map(x => v + ':' + x));
      const rf = await p.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
      if (rf !== 32) clip.push(v + ': גודל הגופן חזר ל-' + rf);
    }
    ok(wide <= 0 && !clip.length && errs.length === 0, `${w}px בטקסט 200%: בלי גלילה הצידה ובלי טקסט חתוך`, `wide=${wide} ${clip.join(' | ')} ${errs.join('|')}`);
    await ctx.close();
  }

  await b.close();
  console.log(`\n${pass} עברו, ${fail} נכשלו`);
  process.exit(fail ? 1 : 0);
})();
