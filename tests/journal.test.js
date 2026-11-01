// בדיקות ליומן ההפלגות (נתונים מומצאים בלבד). הרצה: node tests/journal.test.js
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const root = path.join(__dirname, '..');
const url = f => 'file://' + path.join(root, f);
const fx = f => path.join(__dirname, 'fixtures', f);
let pass = 0, fail = 0;
const ok = (c, n, x = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + ' ' + x); } };

// תשובות Open-Meteo מדומות ל-31/10: רוח 12 עולה ל-16, גלים 70 ס"מ, ים צולב
function mockWeather(u) {
  const times = Array.from({ length: 24 }, (_, h) => `2026-10-31T${String(h).padStart(2, '0')}:00`);
  if (/marine-api/.test(u)) return { hourly: { time: times,
    wave_height: times.map(() => 0.7), wave_period: times.map(() => 5.5), wave_direction: times.map(() => 300),
    wind_wave_height: times.map(() => 0.32), wind_wave_period: times.map(() => 2.4), wind_wave_direction: times.map(() => 340),
    swell_wave_height: times.map(() => 0.65), swell_wave_period: times.map(() => 7), swell_wave_direction: times.map(() => 288) } };
  const w = times.map((_, h) => h < 15 ? 10 : h === 15 ? 11 : h === 16 ? 12 : 13);
  return { hourly: { time: times,
    wind_speed_10m_best_match: w, wind_gusts_10m_best_match: w.map(x => x + 5), wind_direction_10m_best_match: w.map(() => 330),
    precipitation_best_match: w.map(() => 0), weather_code_best_match: w.map(() => 1),
    wind_speed_10m_ecmwf_ifs025: w.map(x => x - 1), wind_speed_10m_icon_seamless: w.map(x => x + 1), wind_speed_10m_gfs_seamless: w.map(x => x - 5) } };
}

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, acceptDownloads: true });
  let failWx = false;
  const reqs = [];
  await ctx.route(/fonts\./, r => r.abort());
  await ctx.route(/openseamap|arcgisonline/, r => { reqs.push(r.request().url()); r.abort(); });
  await ctx.route(/open-meteo\.com/, r => { const u = r.request().url(); reqs.push(u);
    if (failWx) return r.fulfill({ status: 500, contentType: 'application/json', body: '{"reason":"תקלה מדומה"}' });
    r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(mockWeather(u)) }); });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  p.on('request', r => { const u = r.url(); if (!u.startsWith('file:') && !/fonts\.|open-meteo|openseamap|arcgisonline/.test(u)) reqs.push('OTHER ' + u); });

  console.log('יומן ריק');
  await p.goto(url('journal.html'));
  ok(/עדיין אין הפלגות/.test(await p.textContent('#summary-sec')), 'הודעה ליומן ריק');
  ok(await p.$eval('#import-sec', d => d.open), 'אזור ההוספה פתוח כשאין הפלגות');
  ok(await p.$eval('#backup-sec', d => d.classList.contains('hidden')), 'אין גיבוי כשאין הפלגות');

  console.log('הוספה מקובץ Google מלא (אנדרואיד)');
  await p.setInputFiles('#file', fx('timeline-android.json')); await p.waitForTimeout(200);
  ok(/נוספו הפלגה אחת/.test(await p.textContent('#import-msg')), 'נוספה הפלגה אחת', await p.textContent('#import-msg'));
  ok(await p.$$eval('details.jtrip', x => x.length) === 1, 'ההפלגה ברשימה');
  const stored = await p.evaluate(() => localStorage.getItem('journal_v1'));
  const HOME = [32.0801, 34.7801];
  const J = JSON.parse(stored);
  ok(!J.trips.some(t => t.path.some(x => Math.hypot((x[0] - HOME[0]) * 111, (x[1] - HOME[1]) * 94) < 2)) && !/HOME|visit|frequent/.test(stored), 'רק השייט נשמר – לא הבית ולא ביקורים');
  const sum = (await p.textContent('details.jtrip summary')).replace(/\s+/g, ' ');
  ok(/15:00–17:00/.test(sum) && /מרינה הרצליה ובחזרה|הרצליה ובחזרה/.test(sum) && /\d\.\d מייל/.test(sum), 'שורת ההפלגה: שעות, מקום ומרחק', sum);
  ok(/הפלגות\s*1/.test((await p.textContent('#summary-sec')).replace(/\s+/g, ' ')), 'סיכום: הפלגה אחת');

  console.log('כפילות');
  await p.setInputFiles('#file', fx('timeline-ios.json')); await p.waitForTimeout(200);
  ok(/נוספו 0 הפלגות, 1 כבר היו ביומן/.test(await p.textContent('#import-msg')), 'אותה הפלגה מקובץ אחר לא נוספת פעמיים', await p.textContent('#import-msg'));

  console.log('פירוט ותחזית');
  await p.click('details.jtrip summary'); await p.waitForSelector('.wx-tab', { timeout: 5000 });
  ok(await p.$('.t-map.leaflet-container') != null, 'מפה נוצרה');
  const hours = await p.$$eval('.wx-tab tbody tr td:first-child', x => x.map(t => t.textContent));
  ok(hours.join(',') === '15:00,16:00,17:00', 'שעות ההפלגה בטבלה', hours.join(','));
  const dm = await p.textContent('.t-body .demand');
  ok(/ים מאתגר/.test(dm) && /ים צולב/.test(dm), 'אופי הים: מאתגר, עם ים צולב', dm);
  ok(/גלים עד 70 ס״מ/.test(await p.textContent('.wx-sum')), 'גלים בס"מ');
  const wxReq = reqs.filter(u => /historical-forecast/.test(u));
  ok(wxReq.length === 1 && /start_date=2026-10-31/.test(wxReq[0]) && /wind_speed_unit=kn/.test(wxReq[0]) && /cell_selection=sea/.test(wxReq[0]), 'בקשה לארכיון התחזיות לתאריך הנכון');

  console.log('תחושה והערות');
  await p.click('[data-feel="3"]'); await p.waitForTimeout(100);
  ok(await p.$eval('[data-feel="3"]', x => x.getAttribute('aria-pressed')) === 'true', 'כפתור "קשה" מסומן');
  ok(/feel-b f3/.test(await p.innerHTML('details.jtrip summary')), 'תג תחושה בשורת ההפלגה');
  await p.fill('[data-note="text"]', 'ים צולב, ריף ראשון ב-16:00'); await p.fill('[data-note="crew"]', 'אני + 2'); await p.waitForTimeout(700);
  const sTxt = (await p.textContent('#summary-sec')).replace(/\s+/g, ' ');
  ok(/הרגישו קשות מהתחזית/.test(sTxt) || /הרגיש קשה/.test(sTxt), 'תובנה: התחושה מול התחזית', sTxt);
  const nReq = reqs.length;
  await p.reload(); await p.waitForTimeout(200);
  await p.click('details.jtrip summary'); await p.waitForSelector('.wx-tab');
  ok(await p.inputValue('[data-note="text"]') === 'ים צולב, ריף ראשון ב-16:00' && await p.inputValue('[data-note="crew"]') === 'אני + 2', 'ההערות נשמרו אחרי טעינה מחדש');
  ok(!reqs.slice(nReq).some(u => /open-meteo/.test(u)), 'התחזית נשמרה – לא נטענת שוב');

  console.log('גיבוי ושחזור');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#backup')]);
  const bk = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
  ok(bk.format === 'marina-weather-journal/1' && bk.trips.length === 1 && bk.trips[0].notes.feel === 3 && bk.trips[0].wx.rows.length === 3, 'הגיבוי כולל הפלגה, הערות ותחזית');
  const bkPath = await dl.path();

  console.log('מחיקה');
  await p.click('[data-del]');
  ok(await p.$$eval('details.jtrip', x => x.length) === 1 && /בטוח/.test(await p.textContent('[data-del]')), 'לחיצה ראשונה מבקשת אישור');
  await p.click('[data-del]'); await p.waitForTimeout(100);
  ok(await p.$$eval('details.jtrip', x => x.length) === 0, 'לחיצה שנייה מוחקת');
  await p.setInputFiles('#file', fx('timeline-android.json')); await p.waitForTimeout(200);
  ok(await p.$$eval('details.jtrip', x => x.length) === 0, 'הפלגה שנמחקה לא חוזרת מייבוא חוזר של ציר הזמן');
  await p.setInputFiles('#file', bkPath); await p.waitForTimeout(200);
  ok(await p.$$eval('details.jtrip', x => x.length) === 1 && /שוחזרו/.test(await p.textContent('#import-msg')), 'שחזור מגיבוי מחזיר אותה', await p.textContent('#import-msg'));

  console.log('שחזור בטלפון אחר');
  { const c2 = await b.newContext(); await c2.route(/fonts\.|openseamap|arcgisonline|open-meteo/, r => r.abort()); const q = await c2.newPage();
    await q.goto(url('journal.html')); await q.setInputFiles('#file', bkPath); await q.waitForTimeout(200);
    await q.click('details.jtrip summary'); await q.waitForSelector('.wx-tab');
    ok(await q.inputValue('[data-note="text"]') === 'ים צולב, ריף ראשון ב-16:00' && await q.$eval('[data-feel="3"]', x => x.getAttribute('aria-pressed')) === 'true', 'הגיבוי משוחזר עם ההערות והתחזית, בלי רשת');
    await c2.close(); }

  console.log('תקלה בתחזית');
  { await p.evaluate(() => localStorage.clear()); failWx = true;
    await p.reload(); await p.setInputFiles('#file', fx('timeline-takeout.json')); await p.waitForTimeout(200);
    await p.click('details.jtrip summary'); await p.waitForSelector('[data-retry]', { timeout: 5000 });
    ok(/לא הצלחתי לטעון/.test(await p.textContent('.t-body [data-wx]')), 'הודעת שגיאה ברורה');
    failWx = false; await p.click('[data-retry]'); await p.waitForSelector('.wx-tab', { timeout: 5000 });
    ok(true, '"נסה שוב" טוען את התחזית'); }

  console.log('מדף הסינון ישר ליומן');
  { await p.evaluate(() => localStorage.clear());
    await p.goto(url('sailing-export.html')); await p.setInputFiles('#file', fx('timeline-android.json')); await p.waitForTimeout(200);
    await p.click('#to-journal'); await p.waitForTimeout(100);
    ok(/נוספו ליומן הפלגה אחת/.test(await p.textContent('#journal-msg')), 'כפתור "הוסף ליומן"');
    await p.click('#journal-msg a'); await p.waitForTimeout(200);
    ok(await p.$$eval('details.jtrip', x => x.length) === 1, 'היומן נפתח עם ההפלגה'); }

  console.log('תצוגה');
  const ov = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(ov <= 0, 'אין גלילה לרוחב', String(ov));
  ok(reqs.every(u => !u.startsWith('OTHER')), 'בקשות רק ל-Open-Meteo ולאריחי המפה', reqs.filter(u => u.startsWith('OTHER')).join(' '));
  ok(errs.length === 0, 'אין שגיאות', errs.join('|'));
  await b.close();
  console.log(`\n${pass} עברו, ${fail} נכשלו`); process.exit(fail ? 1 : 0);
})();
