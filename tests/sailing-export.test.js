// בדיקות לדף סינון ההפלגות. הרצה: node tests/sailing-export.test.js
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const page = 'file://' + path.join(__dirname, '..', 'sailing-export.html');
let pass = 0, fail = 0;
const ok = (c, n, x = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + ' ' + x); } };
(async () => {
  const b = await chromium.launch();
  for (const [name, file] of [['אנדרואיד', 'timeline-android.json'], ['אייפון', 'timeline-ios.json'], ['Takeout ישן', 'timeline-takeout.json']]) {
    console.log(name);
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, acceptDownloads: true });
    const p = await ctx.newPage();
    const reqs = []; p.on('request', r => { if (!r.url().startsWith('file:') && !/fonts\./.test(r.url())) reqs.push(r.url()); });
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.route(/fonts\./, r => r.abort());
    await p.goto(page);
    await p.setInputFiles('#file', path.join(__dirname, 'fixtures', file));
    await p.waitForTimeout(300);
    ok(new RegExp(name.split(' ')[0]).test(await p.textContent('#status')), 'הפורמט זוהה', await p.textContent('#status'));
    const types = await p.$$eval('#types input', x => x.map(i => [i.value, i.checked]));
    ok(types.some(([t, c]) => t === 'SAILING' && c) && types.every(([t, c]) => t === 'SAILING' || !c), 'רק שייט מסומן מראש', JSON.stringify(types));
    ok(await p.$$eval('#trips .trip-row', x => x.length) === 1, 'נמצאה הפלגה אחת');
    const row = (await p.textContent('#trips .trip-row')).replace(/\s+/g, ' ');
    ok(/15:00–17:00/.test(row) && /2 ש׳ 0 ד׳/.test(row) && /11\.\d ק"מ/.test(row), 'שעות, משך ומרחק נכונים', row);
    const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#download')]);
    const out = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
    ok(out.format === 'marina-weather-sailing/1' && out.trips.length === 1 && out.trips[0].type === 'SAILING', 'הקובץ מכיל רק את ההפלגה');
    const txt = JSON.stringify(out);
    const near = (a, b) => Math.hypot((a[0] - b[0]) * 111, (a[1] - b[1]) * 94) < 2;   // ק"מ, בקירוב
    const HOME = [32.0801, 34.7801];
    ok(!out.trips.some(t => t.path.some(x => near(x, HOME))) && !/HOME|Home|visit|rawSignals|frequent|placeLocation/.test(txt), 'אין בקובץ שום נקודה ליד הבית, ואין ביקורים או מקומות');
    const pts = out.trips[0].path;
    ok(pts.length >= 30 && pts.every(x => !x[2] || (x[2] >= '2026-10-31T13:00' && x[2] <= '2026-10-31T15:00:01')), 'נקודות המסלול רק מזמן ההפלגה', String(pts.length));
    // ביטול סימון → אין מה להוריד
    await p.click('#trips input'); await p.waitForTimeout(100);
    ok(await p.$eval('#download', x => x.disabled), 'בלי הפלגות מסומנות – אי אפשר להוריד');
    ok(reqs.length === 0, 'שום בקשה לרשת – הקובץ לא נשלח לשום מקום', reqs.join(' '));
    ok(errs.length === 0, 'אין שגיאות', errs.join('|'));
    await ctx.close();
  }
  console.log('קובץ שגוי');
  { const ctx = await b.newContext(); const p = await ctx.newPage(); await p.route(/fonts\./, r => r.abort()); await p.goto(page);
    await p.setInputFiles('#file', path.join(__dirname, 'fixtures', 'timeline-bad.json')); await p.waitForTimeout(200);
    ok(/לא נראה כמו קובץ ציר זמן/.test(await p.textContent('#status')), 'הודעה ברורה לקובץ שאינו ציר זמן'); await ctx.close(); }
  await b.close();
  console.log(`\n${pass} עברו, ${fail} נכשלו`); process.exit(fail ? 1 : 0);
})();
