// בדיקות קבלה ליומן ההפלגות (נתונים מומצאים בלבד). הרצה: node tests/journal.test.js
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs'), os = require('os');
const root = path.join(__dirname, '..');
const url = f => 'file://' + path.join(root, f);
const fx = f => path.join(__dirname, 'fixtures', f);
const tmp = (name, obj) => { const f = path.join(os.tmpdir(), name); fs.writeFileSync(f, typeof obj === 'string' ? obj : JSON.stringify(obj)); return f; };
let pass = 0, fail = 0;
const ok = (c, n, x = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + ' ' + x); } };
const T = s => (s || '').replace(/\s+/g, ' ').trim();

// Open-Meteo מדומה לכל טווח תאריכים: רוח 11–13, גלים 70 ס"מ, ים צולב
let marineFail = false, wxFail = false;
function mockWeather(u) {
  const q = new URL(u).searchParams, d0 = q.get('start_date'), d1 = q.get('end_date');
  const times = [];
  for (let d = Date.parse(d0 + 'T00:00:00Z'); d <= Date.parse(d1 + 'T00:00:00Z'); d += 86400000) for (let h = 0; h < 24; h++) times.push(new Date(d).toISOString().slice(0, 10) + `T${String(h).padStart(2, '0')}:00`);
  if (/marine-api/.test(u)) return { hourly: { time: times,
    wave_height: times.map(() => 0.7), wave_period: times.map(() => 5.5), wave_direction: times.map(() => 300),
    wind_wave_height: times.map(() => 0.32), wind_wave_period: times.map(() => 2.4), wind_wave_direction: times.map(() => 340),
    swell_wave_height: times.map(() => 0.65), swell_wave_period: times.map(() => 7), swell_wave_direction: times.map(() => 288) } };
  const w = times.map(t => { const h = +t.slice(11, 13); return h < 15 ? 10 : h === 15 ? 11 : h === 16 ? 12 : 13; });
  return { hourly: { time: times,
    wind_speed_10m_best_match: w, wind_gusts_10m_best_match: w.map(x => x + 5), wind_direction_10m_best_match: w.map(() => 330),
    precipitation_best_match: w.map(() => 0), weather_code_best_match: w.map(() => 1),
    wind_speed_10m_ecmwf_ifs025: w.map(x => x - 1), wind_speed_10m_icon_seamless: w.map(x => x + 1), wind_speed_10m_gfs_seamless: w.map(x => x - 5) } };
}
const ISO = (d, hm) => new Date(Date.parse(`${d}T${hm}:00+02:00`)).toISOString();
// קובץ הפלגות פשוט (פורמט מסונן) – מסלול כל 2 דקות מהמרינה מערבה וחזרה
function sailFile(trips) {
  return { format: 'marina-weather-sailing/1', trips: trips.map(([d, a, b]) => {
    const s = Date.parse(ISO(d, a)), e = Date.parse(ISO(d, b)), n = Math.max(6, Math.round((e - s) / 120000));
    return { start: new Date(s).toISOString(), end: new Date(e).toISOString(), type: 'SAILING',
      path: Array.from({ length: n + 1 }, (_, i) => { const f = i <= n / 2 ? i / (n / 2) : (n - i) / (n / 2); return [32.1631 + 0.01 * f, 34.7962 - 0.04 * f, new Date(s + (e - s) * i / n).toISOString()]; }) };
  }) };
}

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, acceptDownloads: true, timezoneId: 'Asia/Jerusalem' });
  const reqs = [];
  await ctx.route(/fonts\.|goatcounter|zgo|ensemble-api|\/\/api\.open-meteo/, r => r.abort());
  await ctx.route(/openseamap|arcgisonline/, r => { reqs.push(r.request().url()); r.abort(); });
  await ctx.route(/open-meteo\.com/, r => { const u = r.request().url(); reqs.push(u);
    if (wxFail || (marineFail && /marine-api/.test(u))) return r.fulfill({ status: 500, contentType: 'application/json', body: '{"reason":"תקלה מדומה"}' });
    r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(mockWeather(u)) }); });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  p.on('request', r => { const u = r.url(); if (!u.startsWith('file:') && !/fonts\.|open-meteo|openseamap|arcgisonline|zgo|goatcounter/.test(u)) reqs.push('OTHER ' + u); });
  const J = () => p.evaluate(() => JSON.parse(localStorage.getItem('journal_v1') || 'null'));
  const reset = async () => { await p.evaluate(() => localStorage.clear()); await p.goto(url('journal.html')); await p.waitForTimeout(150); };
  const importFile = async f => { await p.click(await p.isVisible('#empty') ? '#empty [data-open="import"]' : '#full [data-open="import"]'); await p.setInputFiles('#file', f); await p.waitForSelector('#imp-step2:not(.hidden), #imp-status.err', { timeout: 10000 }); };
  const apply = async () => { await p.click('#imp-apply'); await p.waitForTimeout(150); };
  const rows = () => p.$$eval('#imp-list .imp-row', x => x.map(r => ({ status: r.querySelector('.badge').textContent, act: r.querySelector('select').value, txt: r.textContent.replace(/\s+/g, ' ') })));

  console.log('יומן ריק');
  await p.goto(url('journal.html'));
  ok(await p.isVisible('#empty') && !(await p.isVisible('#full')), 'פתיחה קצרה עם שתי פעולות');
  ok(/ההפלגות שלך, במקום אחד/.test(await p.textContent('#empty')) && (await p.$$('#empty [data-open]')).length === 2, 'כותרת ושני כפתורים');
  ok(await p.isHidden('#manual-panel') && await p.isHidden('#import-panel'), 'הטפסים סגורים עד שבוחרים');

  console.log('ייבוא מקובץ Google מלא – תצוגה מקדימה לפני הוספה');
  await importFile(fx('timeline-android.json'));
  let R = await rows();
  ok(R.length === 1 && R[0].status === 'חדשה' && R[0].act === 'add', 'נמצאה הפלגה חדשה אחת', JSON.stringify(R));
  ok(/15:00–17:00/.test(R[0].txt) && /2 ש׳ 0 ד׳/.test(R[0].txt), 'תאריך, שעות ומשך בתצוגה המקדימה', R[0].txt);
  ok(!(await J()) || !(await J()).trips.length, 'שום דבר לא נשמר לפני האישור');
  await apply();
  let j = await J();
  ok(j.trips.length === 1 && await p.isVisible('#full'), 'אחרי אישור – ההפלגה ביומן');
  const HOME = [32.0801, 34.7801];
  ok(!j.trips.some(t => t.path.some(x => Math.hypot((x[0] - HOME[0]) * 111, (x[1] - HOME[1]) * 94) < 2)) && !/HOME|visit|frequent/.test(JSON.stringify(j)), 'רק השייט נשמר – לא הבית ולא ביקורים');
  ok(j.trips[0].createdAt && j.trips[0].updatedAt, 'זמני יצירה ועדכון');
  ok((j.trips[0].notes.role || 'לא צוין') === 'לא צוין', 'תפקיד ברירת מחדל: לא צוין');

  console.log('כפילות מקובץ אחר');
  await importFile(fx('timeline-ios.json'));
  R = await rows();
  ok(R.length === 1 && R[0].status === 'כבר ביומן' && R[0].act === 'skip' && await p.$eval('#imp-apply', x => x.disabled), 'אותה הפלגה – "כבר ביומן", ברירת מחדל דלג');
  await p.click('#import-panel [data-close]');

  console.log('חפיפה קצרה, קטע ומיזוג');
  await reset();
  await importFile(tmp('a.json', sailFile([['2026-09-01', '10:00', '12:00']]))); await apply();
  await importFile(tmp('b.json', sailFile([['2026-09-01', '11:59', '14:00'], ['2026-09-01', '10:30', '11:00'], ['2026-09-01', '11:00', '13:00']])));
  R = await rows();
  const st = R.map(r => r.status);
  ok(st.includes('חדשה') && st.includes('קטע של הפלגה שביומן') && st.includes('חופפת חלקית להפלגה שביומן'), 'חפיפה של דקה = הפלגה נפרדת; קטע פנימי; חפיפה חלקית', st.join(','));
  ok(R.find(r => r.status === 'חופפת חלקית להפלגה שביומן').act === 'skip' && R.find(r => r.status === 'קטע של הפלגה שביומן').act === 'merge', 'ברירות מחדל: חפיפה חלקית – דלג, קטע – מזג');
  await apply();
  j = await J();
  ok(j.trips.length === 2 && j.trips.some(t => t.segments && t.segments.length === 2), 'מוזג הקטע, נוספה ההפלגה הצמודה, לא נזרק מידע בשקט', JSON.stringify(j.trips.map(t => [t.start, t.end, (t.segments || []).length])));

  console.log('חיפוש לפי תאריך ואיחוד קטעים עם פער');
  await reset();
  await importFile(fx('timeline-android.json'));
  await p.fill('#d-from', '2026-10-31'); await p.dispatchEvent('#d-from', 'change'); await p.waitForTimeout(150);
  R = await rows();
  ok(R.length === 3 && R.filter(r => r.act === 'add').length === 1, 'כל סוגי התנועה בתאריך, רק מה שלא ביבשה מסומן', JSON.stringify(R.map(r => r.act)));
  const walkSel = (await p.$$('#imp-list .imp-row select'))[1];
  await walkSel.selectOption('add'); await p.check('#merge'); await p.waitForTimeout(50);
  ok(/יאוחדו להפלגה אחת/.test(await p.textContent('#imp-plan')), 'הסבר: הקטעים יאוחדו');
  await apply();
  j = await J();
  const m = j.trips[0];
  ok(j.trips.length === 1 && m.segments.length === 2, 'הפלגה אחת עם שני קטעים');
  const sMerged = await p.evaluate(() => { const t = loadJournal().trips[0]; const s = tripStats(t); return [s.durMin, s.gapMin, s.spanMin]; });
  ok(sMerged[1] === 10 && sMerged[0] === sMerged[2] - 10, 'הפער לא נספר אוטומטית כזמן הפלגה', JSON.stringify(sMerged));
  await p.click('details.jtrip summary'); await p.waitForSelector('[data-gap]', { state: 'attached' });
  ok(/קו אפור מנוקד/.test(await p.textContent('details.jtrip .t-body')), 'הפער מסומן במפה ולא כמסלול שנרשם');
  await p.click('details.jtrip [data-box="fix"] summary'); await p.check('[data-gap]'); await p.waitForTimeout(200);
  ok(await p.evaluate(() => tripStats(loadJournal().trips[0]).durMin) === sMerged[2], 'אפשר לבחור לספור את הפער');

  console.log('ניקוי מסלול');
  const cl = await p.evaluate(() => {
    const t0 = Date.parse('2026-09-01T10:00:00Z'), step = 60000, k = 20 / 1.943844 * 60 / 111320;   // 20 קשר צפונה
    const fast = Array.from({ length: 5 }, (_, i) => [32 + k * i, 34.7, t0 + i * step]);
    const slow = Array.from({ length: 8 }, (_, i) => [32 + 0.0005 * i, 34.7, t0 + i * step]);
    const spike = slow.map((p, i) => i === 4 ? [p[0] + 0.05, p[1] + 0.05, p[2]] : p);
    const startSpike = [[32.3, 34.4, t0 - step], ...slow];
    return [cleanPath(fast).pts.length, cleanPath(spike).pts.length, cleanPath(spike).suspicious.length, cleanPath(startSpike).pts.length, cleanPath(fast, 30).pts.length];
  });
  ok(cl[0] === 5 && cl[4] === 5, 'מסלול מהיר ועקבי (20 קשר) לא נפגע', JSON.stringify(cl));
  ok(cl[1] === 7 && cl[2] === 1, 'קפיצת GPS בודדת מסוננת כחשודה');
  ok(cl[3] === 8, 'נקודת התחלה רחוקה מסוננת');

  console.log('תצוגה של הפלגה: מפה ונתוני מודלים');
  await reset();
  await importFile(fx('timeline-android.json')); await apply();
  await p.click('details.jtrip summary'); await p.waitForSelector('.wx-tab', { timeout: 5000 });
  ok(/נתוני מודלים מהארכיון לשעות ההפלגה/.test(await p.textContent('.t-body')) && /לא בהכרח התחזית שנראתה/.test(await p.textContent('.t-body')), 'הכותרת וההסבר: ארכיון, לא התחזית שנראתה');
  ok(/נקודה מייצגת/.test(await p.textContent('.t-body [data-wx]')), 'כתוב שזו נקודה מייצגת');
  ok(await p.$('.t-map.leaflet-container') != null, 'מפה נוצרה');
  await p.click('details.jtrip summary'); await p.waitForTimeout(100); await p.click('details.jtrip summary'); await p.waitForTimeout(300);
  await p.click('details.jtrip summary'); await p.waitForTimeout(100); await p.click('details.jtrip summary'); await p.waitForTimeout(300);
  ok(await p.$eval('.t-map', m => m.classList.contains('leaflet-container') && m.querySelectorAll('.leaflet-pane').length > 0 && m.querySelector('path') != null), 'פתיחה, סגירה ופתיחה חוזרת – המפה ממשיכה להופיע');
  const hrsCol = await p.$$eval('.wx-tab tbody tr td:first-child', x => x.map(t => t.textContent));
  ok(hrsCol.join(',') === '15:00,16:00,17:00', 'שעות ההפלגה בטבלה', hrsCol.join(','));

  console.log('נתוני גלים חסרים – הערכה חלקית');
  { marineFail = true;
    await reset(); await importFile(tmp('c.json', sailFile([['2026-09-02', '15:00', '17:00']]))); await apply();
    await p.click('details.jtrip summary'); await p.waitForSelector('.wx-tab', { timeout: 5000 });
    ok(/הערכה חלקית/.test(await p.textContent('.t-body .demand')) && /גלים – \(אין נתונים\)/.test(await p.textContent('.wx-sum')), 'בלי גלים: "הערכה חלקית"');
    await p.click('[data-feel="3"]'); await p.waitForTimeout(150);
    ok(!/התחושה שלך מול נתוני המודלים/.test(await p.textContent('#summary-sec')), 'הערכה חלקית לא נכנסת לתובנות');
    const pd = await p.evaluate(() => seaDemand({ wind: 5, gust: 7, wave: null }));
    ok(pd.partial && pd.missing.includes('גלים'), 'seaDemand בלי גלים מסומן חלקי'); marineFail = false; }

  console.log('כשל שמירה');
  { await p.click('details.jtrip [data-box="more"] summary');
    await p.evaluate(() => { window.__set = Storage.prototype.setItem; Storage.prototype.setItem = function () { throw new DOMException('full', 'QuotaExceededError'); }; });
    await p.fill('[data-note="text"]', 'הערה חשובה'); await p.waitForTimeout(600);
    ok(/לא נשמר/.test(await p.textContent('.t-body .saved-msg')) && await p.isVisible('#save-error'), 'אחסון מלא: "לא נשמר" והודעה ברורה');
    ok(await p.inputValue('[data-note="text"]') === 'הערה חשובה', 'הטקסט שהוקלד נשאר');
    await p.evaluate(() => { Storage.prototype.setItem = window.__set; });
    await p.click('[data-retry-save]'); await p.waitForTimeout(150);
    ok(await p.isHidden('#save-error') && (await J()).trips[0].notes.text === 'הערה חשובה', '"נסה שוב" שומר');
    await p.evaluate(() => { Storage.prototype.setItem = function () { throw new Error('blocked'); }; });
    await p.click('#full [data-open="manual"]'); await p.fill('#m-start', '2026-08-01T10:00'); await p.fill('#m-end', '2026-08-01T12:00'); await p.click('#m-add'); await p.waitForTimeout(150);
    await p.evaluate(() => { Storage.prototype.setItem = window.__set; });
    ok(await p.isVisible('#save-error') && !(await J()).trips.some(t => t.source === 'manual'), 'אחסון חסום: ההוספה לא מוצגת כאילו הצליחה'); await p.click('#manual-panel [data-close]'); }

  console.log('הפלגה ידנית, כלי שיט ושדות יומן');
  await reset();
  await p.click('#empty [data-open="manual"]');
  await p.fill('#m-start', '2026-05-28T08:00'); await p.fill('#m-end', '2026-06-02T18:00');
  await p.selectOption('#m-via', 'מרינה לרנקה (קפריסין)'); await p.fill('#m-label', 'הרצליה – לרנקה – הרצליה');
  await p.click('#m-add'); await p.waitForTimeout(300);
  let sm = T(await p.textContent('details.jtrip summary'));
  ok(/לרנקה/.test(sm) && /מרחק לא הוזן/.test(sm) && /5 ימים/.test(sm) && /ש׳ לילה/.test(sm), 'בלי מרחק – "מרחק לא הוזן", ימים ושעות לילה', sm);
  await p.waitForSelector('details.jtrip[open] .wx-tab, details.jtrip[open] [data-retry]', { timeout: 8000 });
  const lats = [...new Set(reqs.filter(u => /historical-forecast/.test(u) && /2026-05-28/.test(u)).map(u => new URL(u).searchParams.get('latitude')))];
  ok(lats.length >= 2, 'הפלגה ארוכה: נתונים מכמה נקודות לאורך הדרך', lats.join(','));
  ok(/נקודות לאורך המסלול/.test(await p.textContent('details.jtrip[open] [data-wx]')), 'כתוב שזה קירוב לאורך המסלול');
  ok(await p.$eval('details.jtrip[open] .t-map', m => m.classList.contains('leaflet-container') && m.querySelector('path') != null), 'מפה גם להפלגה ידנית (קו מקווקו בין הנמלים)');
  const dupLat = reqs.filter(u => /historical-forecast/.test(u) && /2026-05-28/.test(u)).map(u => new URL(u).searchParams.get('latitude'));
  ok(new Set(dupLat).size === dupLat.length, 'בלי בקשות כפולות לאותה נקודה', dupLat.join(','));
  // מרחק חוצה חצות + אימות
  await p.click('details.jtrip[open] [data-box="fix"] summary');
  await p.fill('[data-dt="end"]', '2026-05-27T10:00'); await p.waitForTimeout(150);
  ok(/הסיום חייב להיות אחרי היציאה/.test(await p.textContent('[data-fix-msg]')) && (await J()).trips[0].end.startsWith('2026-06-02'), 'סיום לפני יציאה – לא נשמר');
  await p.fill('[data-fix="nm"]', '330'); await p.dispatchEvent('[data-fix="nm"]', 'change'); await p.waitForTimeout(200);
  ok(/330\.0 מייל/.test(T(await p.textContent('details.jtrip summary'))), 'מרחק שהוזן ביד');
  // כלי שיט
  await p.click('#more-sec summary'); await p.click('#v-add'); await p.fill('#vessels [data-vf="name"]', 'סירה א'); await p.waitForTimeout(500);
  ok(/שייך/.test(await p.textContent('#vessels')), 'הצעה לשייך הפלגות בלי כלי שיט (לא אוטומטי)');
  j = await J(); ok(!j.trips[0].vesselId, 'כלי שיט חדש לא משויך בדיעבד להפלגות');
  await p.click('#vessels [data-assign]'); await p.waitForTimeout(100);
  const vA = (await J()).vessels[0].id;
  await p.click('#v-add'); await p.fill('#vessels .vessel:nth-child(2) [data-vf="name"]', 'סירה ב'); await p.check('#vessels .vessel:nth-child(2) input[type=radio]'); await p.waitForTimeout(500);
  j = await J(); ok(j.trips[0].vesselId === vA && j.defaultVessel !== vA, 'החלפת ברירת המחדל לא משנה הפלגות קיימות');
  await p.fill('#vessels .vessel:nth-child(1) [data-vf="name"]', 'סירה א משופצת'); await p.waitForTimeout(500);
  ok((await J()).trips[0].vesselId === vA, 'שינוי פרטי סירה – השיוך נשאר');
  await p.click('details.jtrip summary'); await p.waitForTimeout(100); if (!(await p.$('details.jtrip[open]'))) await p.click('details.jtrip summary');
  await p.click('details.jtrip[open] [data-box="more"] summary').catch(() => {});
  await p.selectOption('[data-note="role"]', 'סקיפר'); await p.fill('[data-note="events"]', '=HYPERLINK("http://x","y")'); await p.check('[data-note="safety"]'); await p.waitForTimeout(600);
  ok(/1 כסקיפר/.test(await p.textContent('#summary-sec')), 'תפקיד סקיפר נספר רק כשנבחר');

  console.log('גיבוי ושחזור מלאים');
  await importFile(fx('timeline-android.json')); await apply();
  await p.click('details.jtrip summary'); await p.waitForTimeout(200); await p.click('[data-feel="2"]'); await p.waitForTimeout(100);
  const before = await J();
  const [dl] = await Promise.all([p.waitForEvent('download'), p.evaluate(() => doBackup())]);
  const bkPath = await dl.path(), bk = JSON.parse(fs.readFileSync(bkPath, 'utf8'));
  ok(bk.format === 'marina-weather-journal/2' && bk.vessels.length === 2 && bk.trips.length === 2, 'קובץ גיבוי עם כלי שיט והפלגות');
  await reset();
  await importFile(bkPath);
  ok((await rows()).every(r => r.act === 'add'), 'שחזור ליומן ריק: הכול "הוסף"');
  await apply();
  const after = await J();
  const canon = v => Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])])) : v;
  const strip = t => JSON.stringify(canon(t));
  const eq = before.trips.every(t => { const a = after.trips.find(x => x.id === t.id); return a && strip(a) === strip(t); });
  if (!eq) before.trips.forEach(t => { const a = after.trips.find(x => x.id === t.id); if (a) Object.keys({ ...t, ...a }).forEach(k => { if (JSON.stringify(canon(t[k])) !== JSON.stringify(canon(a[k]))) console.log('    diff', t.id, k, JSON.stringify(t[k]).slice(0, 80), '→', JSON.stringify(a[k]).slice(0, 80)); }); else console.log('    missing', t.id); });
  if (after.vessels.length !== 2) console.log('    vessels', JSON.stringify(after.vessels), JSON.stringify(before.vessels));
  ok(eq && after.trips.length === before.trips.length, 'כל השדות נשמרו: מזהה, נמלים, זמנים, תיקונים, הערות, כלי שיט', JSON.stringify(after.trips.map(t => t.id)));
  const man = after.trips.find(t => t.source === 'manual');
  ok(man.ports.via === 'מרינה לרנקה (קפריסין)' && man.createdAt === before.trips.find(t => t.source === 'manual').createdAt && man.id.startsWith('m-'), 'הפלגה ידנית: נמלים, זמן יצירה ומזהה');
  ok(after.vessels.length === 2 && after.defaultVessel === before.defaultVessel, 'כלי השיט שוחזרו');
  // גרסה מקומית חדשה יותר / מחיקה בגיבוי ישן
  await p.click('details.jtrip summary'); await p.waitForTimeout(150); await p.click('[data-feel="0"]'); await p.waitForTimeout(100);
  const old = JSON.parse(fs.readFileSync(bkPath, 'utf8')); old.trips[1].deleted = true;
  await importFile(tmp('old.json', old));
  R = await rows();
  ok(R.some(r => r.status === 'כאן גרסה חדשה יותר' && r.act === 'skip'), 'גרסה מקומית חדשה – ברירת מחדל: לא לדרוס', JSON.stringify(R.map(r => r.status)));
  ok(R.some(r => r.status === 'בגיבוי היא מחוקה' && r.act === 'skip'), 'מחיקה בגיבוי ישן לא מסתירה אוטומטית');
  ok(await p.$eval('#imp-apply', x => x.disabled), 'אין מה להחיל – הכפתור כבוי');
  await p.click('#import-panel [data-close]');
  ok((await J()).trips.every(t => !t.deleted), 'שום הפלגה לא הוסתרה');

  console.log('מחיקה ושחזור');
  await p.evaluate(() => { const d = document.querySelector('details.jtrip'); if (!d.open) d.open = true; }); await p.waitForTimeout(150);
  await p.click('details.jtrip[open] [data-del]'); await p.click('details.jtrip[open] [data-del]'); await p.waitForTimeout(100);
  ok(await p.$$eval('details.jtrip', x => x.length) === 1 && await p.isVisible('#deleted-sec'), 'נמחקה ומופיעה ב"נמחקו לאחרונה"');
  await p.click('#deleted-sec summary'); await p.click('[data-undel]'); await p.waitForTimeout(100);
  ok(await p.$$eval('details.jtrip', x => x.length) === 2 && await p.isHidden('#deleted-sec'), '"שחזר" מחזיר אותה');

  console.log('ייצוא');
  await p.evaluate(() => { document.getElementById('more-sec').open = true; });
  const [dl2] = await Promise.all([p.waitForEvent('download'), p.click('#csv')]);
  const csv = fs.readFileSync(await dl2.path(), 'utf8');
  ok(csv.charCodeAt(0) === 0xfeff && /"'=HYPERLINK/.test(csv) && /סירה א משופצת/.test(csv) && /הוזן ביד/.test(csv), 'CSV: עברית, כלי שיט, ונוסחה מנוטרלת');
  await p.evaluate(() => { window.print = () => { window.__printed = true; }; }); await p.click('#print');
  ok(await p.evaluate(() => window.__printed) && await p.$$eval('#print-area tbody tr', x => x.length) === 2 && /חתימת הסקיפר/.test(await p.textContent('#print-area')), 'יומן מודפס');

  console.log('תכנית מהמסך "תכנון" → יומן');
  { const fcRows = ['15', '16', '17'].map(h => ({ t: `2026-10-20T${h}:00`, hour: +h, wind: 9, gust: 13, wave: 0.4, models: { ECMWF: { wind: 8 } } }));
    await p.evaluate(rows => localStorage.setItem('trips_v1', JSON.stringify([{ date: '2026-10-20', from: 15, to: 17, course: '', fc: { savedAt: '2026-10-19T08:00:00Z', rows } }, { date: '2099-01-01', from: 9, to: 11 }])), fcRows);
    await p.reload(); await p.waitForTimeout(200);
    ok(/הפלגתם\?/.test(await p.textContent('#plans-sec')) && (await p.$$('[data-plan-add]')).length === 1, 'תכנית שעבר זמנה: "הפלגתם? הוסף ליומן" (ותכנית עתידית לא)');
    await p.click('[data-plan-add]'); await p.waitForTimeout(300);
    const pt = (await J()).trips.find(t => t.source === 'plan');
    ok(pt && pt.planFc.rows.length === 3 && /התחזית ששמרת בתכנון/.test(await p.textContent('details.jtrip[open]')), 'נוספה עם התחזית ששמרת');
    ok(await p.$eval('details.jtrip[open] [data-box="fix"]', d => d.open), 'אפשר לתקן את השעות בפועל מיד');
    await p.reload(); await p.waitForTimeout(150);
    ok(await p.isHidden('#plans-sec'), 'לא מוצעת שוב'); }

  console.log('קבצים לא תקינים והגנה מקוד');
  await importFile(fx('timeline-bad.json'));
  ok(/הקובץ לא נתמך/.test(await p.textContent('#imp-status')), 'קובץ לא נתמך – הודעה שימושית');
  await p.setInputFiles('#file', tmp('x.json', '{not json')); await p.waitForTimeout(200);
  ok(/לא קובץ JSON תקין/.test(await p.textContent('#imp-status')), 'JSON שבור – הודעה');
  const evil = [{ startTime: '2026-07-01T10:00:00+03:00', endTime: '2026-07-01T11:00:00+03:00', activity: { start: 'geo:32.16,34.79', end: 'geo:32.17,34.78', topCandidate: { type: '<img src=x onerror="window.__x=1">', probability: '0.5' } } },
    { startTime: '2026-07-01T12:00:00+03:00', endTime: '2026-07-01T11:00:00+03:00', activity: { start: 'geo:32.16,34.79', topCandidate: { type: 'sailing' } } },
    { startTime: '2026-07-01T12:00:00+03:00', endTime: '2026-07-01T13:00:00+03:00', activity: { start: 'geo:932.16,34.79', topCandidate: { type: 'sailing' } } }];
  await p.setInputFiles('#file', tmp('evil.json', evil)); await p.waitForSelector('#imp-step2:not(.hidden)');
  await p.fill('#d-from', '2026-07-01'); await p.dispatchEvent('#d-from', 'change'); await p.waitForTimeout(150);
  ok(!(await p.$('#imp-list img')) && !(await p.evaluate(() => window.__x)), 'סוג פעילות מהקובץ לא מוזרק לדף');
  ok(/רשומות לא תקינות דולגו/.test(await p.textContent('#imp-found')), 'רשומה עם סוף לפני התחלה – דולגה ונספרה');
  await p.click('#import-panel [data-close]');

  console.log('קובץ גדול');
  { const segs = [], t0 = Date.parse('2025-01-01T06:00:00Z');
    for (let i = 0; i < 4000; i++) {
      const s = t0 + i * 3 * 3600000, e = s + 3600000, sail = i % 50 === 0;
      segs.push({ startTime: new Date(s).toISOString(), endTime: new Date(e).toISOString(), activity: { start: 'geo:32.16,34.79', end: 'geo:32.17,34.78', topCandidate: { type: sail ? 'sailing' : 'in passenger vehicle', probability: '0.8' } } });
      segs.push({ startTime: new Date(s).toISOString(), endTime: new Date(e).toISOString(), timelinePath: Array.from({ length: 40 }, (_, k) => ({ point: `geo:${(32.16 + k * 0.0005).toFixed(5)},34.79`, durationMinutesOffsetFromStartTime: String(k * 1.5) })) });
    }
    const f = tmp('big.json', segs);
    const t = Date.now();
    await importFile(f);
    const ms = Date.now() - t;
    ok(/נמצאו 80 הפלגות/.test(await p.textContent('#imp-found')) && ms < 8000, `קובץ של ${(fs.statSync(f).size / 1048576).toFixed(0)}MB נקרא ב-${ms} מ"ש`, await p.textContent('#imp-found'));
    await apply(); }

  console.log('יומן מלא: חיפוש וסינון');
  ok(await p.$$eval('details.jtrip', x => x.length) >= 80, 'עשרות הפלגות ברשימה');
  await p.selectOption('#f-year', '2025'); await p.waitForTimeout(100);
  const n2025 = await p.$$eval('details.jtrip', x => x.length);
  ok(n2025 > 0 && /מוצגות/.test(await p.textContent('#list-sum')), 'סינון לפי שנה', String(n2025));
  await p.selectOption('#f-year', ''); await p.fill('#q', 'לרנקה'); await p.waitForTimeout(100);
  ok(await p.$$eval('details.jtrip', x => x.length) === 1, 'חיפוש טקסט');
  await p.fill('#q', '');

  console.log('לשוניות');
  ok(await p.$eval('#view-tabs a.tab.active', a => a.textContent.trim()) === 'יומן', 'לשונית "יומן" פעילה');
  await p.click('#view-tabs a[href="index.html#plan"]'); await p.waitForTimeout(1500);
  ok(/index\.html$/.test(p.url()) && await p.$eval('#view-plan', x => x.classList.contains('active')) && !(await p.$eval('#plan-view', x => x.classList.contains('hidden'))), 'מהיומן ל"תכנון"');
  await p.click('#view-journal'); await p.waitForTimeout(400);
  ok(/journal\.html$/.test(p.url()) && await p.$$eval('details.jtrip', x => x.length) >= 80, 'וחזרה ליומן – הנתונים שם');

  console.log('תצוגה');
  ok(await p.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 0, 'אין גלילה לרוחב');
  { const c2 = await b.newContext({ viewport: { width: 390, height: 844 } }); const q = await c2.newPage(); await c2.route(/fonts\.|open-meteo|openseamap|arcgis/, r => r.abort());
    const s = await c2.newCDPSession(q); await s.send('Page.enable'); await s.send('Page.setFontSizes', { fontSizes: { standard: 32, fixed: 26 } });
    await q.goto(url('journal.html')); await q.waitForTimeout(200);
    ok(await q.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 0, 'טקסט מוגדל 200% – בלי גלילה לרוחב');
    await c2.close(); }
  ok(reqs.every(u => !u.startsWith('OTHER')), 'בקשות רק ל-Open-Meteo ולאריחי המפה', reqs.filter(u => u.startsWith('OTHER')).join(' '));
  ok(errs.length === 0, 'אין שגיאות JS', errs.join(' | '));
  await b.close();
  console.log(`\n${pass} עברו, ${fail} נכשלו`); process.exit(fail ? 1 : 0);
})();
