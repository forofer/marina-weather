// בדיקות רגרסיה ללוגיקת ההחלטה – מריצות את app.js האמיתי בסביבה מבודדת.
// הרצה: node tests/logic.test.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
const noop = () => {};
const el = () => ({ addEventListener: noop, classList: { add: noop, remove: noop, toggle: noop, contains: () => false }, querySelectorAll: () => [], style: {}, innerHTML: '', textContent: '', options: [], clientWidth: 0 });
const ctx = {
  console, Intl, Date, Math, JSON, Map, Set, Object, Array, Number, String, Promise, setTimeout, clearTimeout, setInterval, clearInterval,
  document: { addEventListener: noop, querySelectorAll: () => [], querySelector: () => null, getElementById: () => el(), documentElement: { clientWidth: 390, setAttribute: noop, removeAttribute: noop, getAttribute: () => null }, body: { classList: { add: noop, remove: noop } }, createElement: el },
  localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
  navigator: {}, fetch: () => Promise.reject(new Error('offline')),
};
ctx.window = ctx;
vm.createContext(ctx);
for (const f of ['core.js']) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
const run = code => vm.runInContext(code, ctx);

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); }
}
function eq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg || ''} expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`); }
function ok(c, msg) { if (!c) throw new Error(msg || 'assertion failed'); }

// נתוני בסיס: יום שלם 06–22 בתנאים טובים
function day(date, over = {}) {
  const rows = [];
  for (let h = 0; h < 24; h++) rows.push({ t: `${date}T${String(h).padStart(2, '0')}:00`, date, hour: h, models: {}, wind: 10, gust: 14, wave: 0.6, wavePer: 6, dir: 270, waveDir: 280, code: 1, pop: 0, rain: 0, cloud: 10, temp: 24, ...(over[h] || {}) });
  return rows;
}
function setData(rows, now = '2026-11-02T08:00') {
  ctx.__rows = rows;
  run(`settings = { ...DEFAULTS, night: true }; data = { rows: __rows, daily: { '2026-11-02': { sunrise: '2026-11-02T05:58', sunset: '2026-11-02T16:50' }, '2026-11-03': { sunrise: '2026-11-03T05:59', sunset: '2026-11-03T16:49' } }, fetchedAt: Date.now(), errors: [] }; NOW_OVERRIDE = '${now}';`);
}

console.log('החלטה לשעה בודדת');
test('נתונים חסרים לגמרי אינם ירוקים', () => { eq(run('verdict({}).level'), 3); });
test('חסרים גלים בלבד → אין מספיק נתונים', () => { eq(run('verdict({wind:8,gust:10}).level'), 3); });
test('חסרה רוח בלבד → אין מספיק נתונים', () => { eq(run('verdict({gust:10,wave:0.4}).level'), 3); });
test('NaN נחשב חסר', () => { eq(run('verdict({wind:NaN,gust:10,wave:0.4}).level'), 3); });
test('חסר מידע אבל ידוע שמסוכן → לא מומלץ', () => { eq(run('verdict({wind:40,gust:50}).level'), 2); });
test('סופת רעמים מסומנת כסכנה', () => { const v = run('verdict({wind:8,gust:10,wave:0.4,code:95})'); eq(v.level, 2); eq(v.hazard, true); });
test('תנאים טובים → מתאים', () => { eq(run('verdict({wind:10,gust:14,wave:0.6,wavePer:6}).level'), 0); });

console.log('תכנון הפלגה');
test('סופת רעמים בשעה אחת מתוך חמש → לא מומלץ', () => {
  setData(day('2026-11-02', { 11: { code: 95 } }));
  eq(run(`planVerdict(planRows({date:'2026-11-02',from:9,to:13}))`), 2);
});
test('שעה חסרה בתוך ההפלגה → אין מספיק נתונים', () => {
  setData(day('2026-11-02').filter(r => r.hour !== 11));
  const rows = run(`planRows({date:'2026-11-02',from:9,to:13})`);
  eq(rows.length, 5, 'כולל שעת החזרה');
  eq(run(`planVerdict(planRows({date:'2026-11-02',from:9,to:13}))`), 3);
});
test('גלים חסרים בשעה אחת → אין מספיק נתונים', () => {
  setData(day('2026-11-02', { 10: { wave: null } }));
  eq(run(`planVerdict(planRows({date:'2026-11-02',from:9,to:13}))`), 3);
});
test('שעת החזרה כלולה ומתאימה לשעה המוצגת', () => {
  setData(day('2026-11-02', { 14: { wind: 25 } }));
  const rows = run(`planRows({date:'2026-11-02',from:9,to:14})`);
  eq(rows[rows.length - 1].hour, 14);
  eq(rows[rows.length - 1].wind, 25);
});
test('הפלגה שחוצה חצות לוקחת את השעות מהיום הבא', () => {
  setData(day('2026-11-02').concat(day('2026-11-03')));
  const rows = run(`planRows({date:'2026-11-02',from:22,to:24})`);
  eq(rows.map(r => r.t), ['2026-11-02T22:00', '2026-11-02T23:00', '2026-11-03T00:00']);
});

console.log('חלונות ושעות מתאימות');
test('חור בתחזית קוטע חלון (09 ו-12 בלבד)', () => {
  setData(day('2026-11-02').filter(r => r.hour === 9 || r.hour === 12));
  const w = run(`greenWindows(data.rows, 1)`);
  eq(w.length, 2); ok(w.every(x => x.n === 1));
  eq(run(`greenWindows(data.rows, 2).length`), 0);
});
test('רצף אמיתי נשמר', () => {
  setData(day('2026-11-02'));
  const w = run(`greenWindows(data.rows.filter(r => r.hour >= 9 && r.hour <= 12), 2)`);
  eq(w.length, 1); eq([w[0].start, w[0].end], [9, 12]);
});
test('יום שרובו בלי נתונים → אין מספיק נתונים', () => {
  setData(day('2026-11-02', Object.fromEntries([...Array(24).keys()].map(h => [h, { wave: null }]))));
  eq(run(`dayVerdict(activeRows('2026-11-02')).lvl`), 3);
});
test('יום עם רעמים ובלי שום חלון טוב → לא מומלץ', () => {
  setData(day('2026-11-02', Object.fromEntries([...Array(24).keys()].map(h => [h, h % 2 ? { code: 95 } : { wave: 1.5 }]))));
  eq(run(`dayVerdict(activeRows('2026-11-02')).lvl`), 2);
});

console.log('שעה נבחרת מול סיכום היום');
test('כשהשעה הנוכחית לא מתאימה – הכותרת לא ירוקה', () => {
  const o = {}; for (let h = 8; h < 17; h++) o[h] = { wave: 1.5 };
  setData(day('2026-11-02', o), '2026-11-02T12:00');
  const h = run(`heroStatus('2026-11-02')`);
  ok(h.lvl !== 0, 'lvl=' + h.lvl);
  ok(/17:00/.test(h.later || ''), 'later=' + h.later);
});

console.log('עיגול וסף');
test('ערך שמתעגל לסף מוצג בדיוק נוסף', () => {
  run(`settings = { ...DEFAULTS }`);
  const t = run(`overText({k:'wave', v:1.34, max:1.3})`);
  ok(/1\.34/.test(t), t);
});
test('אימות הגדרות דוחה ערכים לא תקינים', () => {
  const s = run(`validateSettings({ ...DEFAULTS, maxWind: -5, maxWave: 99, hourFrom: 20, hourTo: 3, windLat: 'abc' })`);
  ok(s.errors.length >= 3, JSON.stringify(s.errors));
});

console.log('טווחי שעות בהפלגה');
test('הפלגה 09:00–14:00: הסיבות והמלצת המפרשים לא נמשכות אל 15:00', () => {
  run(`settings = { ...DEFAULTS }`);
  // שעות 9..14 (שעת החזרה כלולה כנקודה), עם חריגת גלים בסוף ההפלגה
  const rows = run(`[9,10,11,12,13,14].map(h => ({ t: '2026-10-30T' + String(h).padStart(2,'0') + ':00', date: '2026-10-30', hour: h, wind: 12, gust: 16, wave: h >= 13 ? 1.6 : 0.8, wavePer: 6 }))`);
  ctx.__p = rows;
  const reasons = run(`reasonsByHour(__p, true)`).join(' ');
  const segs = run(`sailPlanSegments(__p, true)`).map(x => x.label).join(' ');
  ok(!/15:00/.test(reasons) && /13:00–14:00/.test(reasons), reasons);
  ok(!/15:00/.test(segs) && /09:00–14:00/.test(segs), segs);
});
test('חריגה רק בשעת החזרה מוצגת כ"ב-14:00"', () => {
  ctx.__p = run(`[9,10,11,12,13,14].map(h => ({ t: '2026-10-30T' + String(h).padStart(2,'0') + ':00', date: '2026-10-30', hour: h, wind: 12, gust: 16, wave: h === 14 ? 1.6 : 0.8, wavePer: 6 }))`);
  const r = run(`reasonsByHour(__p, true)`).join(' ');
  ok(/ב-14:00/.test(r), r);
});
test('בלי הדגל, טווח רגיל ממשיך עד סוף השעה', () => {
  const r = run(`reasonsByHour(__p)`).join(' ');
  ok(/14:00–15:00/.test(r), r);
});

console.log('חלון מתאים מול המתכנן');
test('רגרסיה 4/11: חלון 06–08 ירוק וראות נמוכה ב-09 → החלון מסתיים ב-08:00 ועובר את המתכנן', () => {
  // 06–08 בתוך הספים, ב-09 ראות נמוכה (בזהירות), מ-10 גלים גבוהים
  const over = { 9: { vis: 1500 } };
  for (let h = 10; h < 24; h++) over[h] = { wave: 2.2 };
  setData(day('2026-11-02', over), '2026-11-02T05:00');
  const hs = run(`heroStatus('2026-11-02')`);
  ok(hs.wins.length >= 1, 'יש חלון');
  const w = hs.wins[0];
  eq([w.start, w.end], [6, 8], 'גבולות החלון');
  ok(/06:00–08:00/.test(hs.title + ' ' + hs.later), hs.later);
  ok(!/09:00/.test(hs.later), 'החלון לא מציג 09:00 כשעה מתאימה: ' + hs.later);
  eq(run(`planVerdict(planRows(windowPlan(heroStatus('2026-11-02').wins[0], '2026-11-02')))`), 0, 'המתכנן מאשר את החלון');
  // והפלגה שמסתיימת ב-09:00 אכן לא "מתאים" – בדיוק מה שהמשתמש ראה
  ok(run(`planVerdict(planRows({ date: '2026-11-02', from: 6, to: 9 }))`) > 0, 'עד 09:00 – לא ירוק');
});
test('כל חלון שמוצע כמתאים עובר את בדיקת המתכנן (ימים אקראיים)', () => {
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let checked = 0;
  for (let k = 0; k < 60; k++) {
    const over = {};
    for (let h = 0; h < 24; h++) { const x = rnd(); over[h] = x < 0.15 ? { wave: 1.8 } : x < 0.25 ? { gust: 25 } : x < 0.3 ? { vis: 1500 } : x < 0.33 ? { wave: null } : {}; }
    setData(day('2026-11-02', over), '2026-11-02T05:00');
    const n = run(`heroStatus('2026-11-02').wins.length`);
    for (let i = 0; i < n; i++) {
      eq(run(`planVerdict(planRows(windowPlan(heroStatus('2026-11-02').wins[${i}], '2026-11-02')))`), 0, `יום ${k} חלון ${i}`);
      checked++;
    }
  }
  ok(checked > 20, 'נבדקו מספיק חלונות: ' + checked);
});
test('כמה חלונות: הארוך ביותר מסומן, וכולם מוצגים לפי השעה', () => {
  const over = { 9: { wave: 2 }, 10: { wave: 2 } };
  setData(day('2026-11-02', over), '2026-11-02T05:00');
  const hs = run(`heroStatus('2026-11-02')`);
  ok(hs.wins.length === 2, 'שני חלונות');
  ok(hs.wins[0].start < hs.wins[1].start, 'לפי סדר השעות');
  eq([hs.best.start, hs.best.end], [11, 21], 'הארוך ביותר: ' + JSON.stringify(hs.best));
});

console.log('ניסוח');
test('אין הכללה על חצי רוח לאורך החוף, וזווית ההפלגה מחושבת לכל כיוון', () => {
  const t = run(`coastNote(200)`);
  ok(!/חצי רוח/.test(t), t);
  const c = run(`courseNotes(270).map(x => x.t + ':' + x.p.t).join(' | ')`);
  ok(/צפונה \(נתניה\):חצי רוח/.test(c) && /מערבה – לים הפתוח:מול הרוח/.test(c), c);
  // רוח מצפון: צפונה זה מול הרוח, ולא "חצי רוח"
  ok(/צפונה \(נתניה\):מול הרוח/.test(run(`courseNotes(10).map(x => x.t + ':' + x.p.t).join(' | ')`)));
});
test('ניסוחי נוחות מרוככים', () => {
  const all = [0.1, 0.4, 0.8, 1.2, 2].map(h => run(`comfortText(${h}, 7)`)).join(' | ');
  ok(!/נעים לכולם|ירגיש לא טוב|לא מתאים לאורחים/.test(all), all);
});

console.log(`\n${pass} עברו, ${fail} נכשלו`);
process.exit(fail ? 1 : 0);
