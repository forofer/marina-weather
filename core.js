'use strict';
/* ים הרצליה – מנוע ההחלטה: הגדרות, ניסוחים וחישובים טהורים (בלי DOM). נבדק ב-tests/logic.test.js */
/* ===================== הגדרות ברירת מחדל ===================== */
const DEFAULTS = {
  windLat: 32.165, windLon: 34.785,   // מרינה הרצליה
  waveLat: 32.170, waveLon: 34.760,   // ים פתוח ~2.5 ק"מ מערבית למרינה
  maxWind: 16, maxGust: 22, maxWave: 1.3, minPeriod: 5,
  hourFrom: 6, hourTo: 21, step: 1, showModels: true, night: true
};
const TZ = 'Asia/Jerusalem';
const CACHE_MAX_AGE = 30 * 60 * 1000; // 30 דקות
const DAYS = 7;
const MODELS = [
  { id: 'ecmwf_ifs025', name: 'ECMWF' },
  { id: 'icon_seamless', name: 'ICON' },
  { id: 'gfs_seamless', name: 'GFS' }
];
const HEB_DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const COMPASS = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];

let settings = { ...DEFAULTS };
let data = null;         // { rows, daily, current, fetchedAt, hasModels }
let selectedDate = null;

const fmt = (v, d = 0) => (v == null || Number.isNaN(v)) ? '–' : Number(v).toFixed(d);
const compass = deg => deg == null ? '' : COMPASS[Math.round(deg / 22.5) % 16];
const VERDICT = [{ t: 'מתאים להפלגה', g: '✓', long: 'כן, מתאים להפלגה' }, { t: 'אפשר, בזהירות', g: '!', long: 'אפשר, אבל בזהירות' }, { t: 'לא מומלץ', g: '✕', long: 'לא מומלץ להפליג' }, { t: 'אין מספיק נתונים', g: '?', long: 'אין מספיק נתונים להמלצה' }];
// "האם מתאים להפליג מחר?" / "...בשבת?" / "...ביום ראשון?"
function whenWords(date) {
  const l = dayLabel(date, nowLocal().slice(0, 10)).name;
  return l === 'היום' || l === 'מחר' ? l : l === 'שבת' ? 'בשבת' : 'ביום ' + l;
}
// סיבות בשפה פשוטה, עם המספר הרלוונטי
// ערך מול הסף – עם דיוק נוסף כשהעיגול היה מסתיר את החריגה
// ערך מול סף: כשהערך מעל הסף אבל העיגול היה משווה אותו לסף – מוסיפים ספרה (1.34 ולא 1.3)
const THR_KEY = { wind: 'maxWind', gust: 'maxGust', wave: 'maxWave' };
function fmtTh(v, k, d0 = 0) {
  const max = settings[THR_KEY[k]];
  if (!isNum(v) || !isNum(max) || v <= max) return fmt(v, d0);
  let d = d0; while (d < d0 + 2 && +Number(v).toFixed(d) <= +Number(max).toFixed(d)) d++;
  return fmt(v, d);
}
const OVER_NAME = { wind: ['רוח', 'קשר', 0], gust: ['משבים', 'קשר', 0], wave: ['גלים', 'מ׳', 1] };
function overText(o) {
  const [name, unit, d0] = OVER_NAME[o.k];
  let d = d0;
  while (d < d0 + 2 && +Number(o.v).toFixed(d) <= +Number(o.max).toFixed(d)) d++;
  return `${name} ${fmt(o.v, d)} ${unit} – מעל הסף שלך (${o.max})`;
}
// סיבות בשפה פשוטה: לכל סוג חריגה – הערך הגבוה ביותר מול הסף
function plainReasons(rows) {
  const worst = {}, other = new Set();
  rows.forEach(r => { const v = verdict(r); v.over.forEach(o => { if (!worst[o.k] || o.v > worst[o.k].v) worst[o.k] = o; }); v.reasons.forEach(x => { if (!/מעל הסף/.test(x)) other.add(x); }); });
  const order = ['wave', 'gust', 'wind'].filter(k => worst[k]).map(k => overText(worst[k]));
  const extra = [...other].map(x => x === 'ים קצר ותלול' ? 'גלים קצרים וצפופים' : x);
  return [...extra.filter(x => /רעמים/.test(x)), ...order, ...extra.filter(x => !/רעמים/.test(x))];
}
// מצב לשעה הנבחרת/הנוכחית מול סיכום היום – כדי שהכותרת לא תאשר "לצאת עכשיו" בטעות
function heroStatus(date) {
  const rows = activeRows(date);
  const isToday = date === nowLocal().slice(0, 10);
  if (rows.length < 2) return { late: true, rows };
  const dv = dayVerdict(rows);
  // חלון = שעות מתאימות רצופות, כולל שעת החזרה. "06:00–08:00" אומר שגם ב-08:00 התנאים בתוך הספים –
  // בדיוק כמו שהמתכנן בודק הפלגה 06:00–08:00. כך חלון שמוצע כמתאים תמיד עובר את בדיקת המתכנן.
  const best = dv.wins[0] || null;                                   // החלון הארוך ביותר
  const wins = dv.wins.slice().sort((a, b) => a.start - b.start);   // כל החלונות לפי שעה
  const winTxt = wins.slice(0, 3).map(w => `${hm(w.start)}–${hm(w.end)}`).join(' , ');
  let lvl = dv.lvl, title = VERDICT[lvl].long, why = '', later = '';
  if (lvl === NODATA) {
    why = 'חסרים נתוני ' + [...new Set(rows.flatMap(r => verdict(r).missing))].join(' ו') + ' – נסו לרענן בעוד כמה דקות';
  } else if (isToday && wins.length && verdict(rows[0]).level !== 0) {
    // היום יש חלון טוב – אבל לא עכשיו
    lvl = 1;
    title = `מתאים רק מ-${hm(wins[0].start)}`;
    why = 'כרגע: ' + (plainReasons([rows[0]]).slice(0, 2).join(' · ') || 'לא בתוך הספים');
    later = `חלון מתאים: ${winTxt}`;
  } else if (lvl === 0) {
    later = `${isToday ? 'השעות המתאימות שנותרו היום' : 'השעות המתאימות'}: ${winTxt}`;
  } else {
    why = 'כי צפויים: ' + plainReasons(rows).slice(0, 2).join(' · ');
    later = wins.length ? `שעות מתאימות בכל זאת: ${winTxt}` : 'אין שעות מתאימות ביום הזה';
  }
  return { lvl, title, why, later, wins, best, rows, dv };
}
function dayLabel(dateStr, todayStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const diff = Math.round((d - new Date(todayStr + 'T12:00:00')) / 86400000);
  const name = diff === 0 ? 'היום' : diff === 1 ? 'מחר' : HEB_DAYS[d.getDay()];
  return { name, sub: (diff <= 1 ? HEB_DAYS[d.getDay()] + ' ' : '') + `${d.getDate()}/${d.getMonth() + 1}` };
}

let NOW_OVERRIDE = null; // לבדיקות בלבד
function nowLocal() {
  // מחזיר 'YYYY-MM-DDTHH:00' לפי שעון ישראל
  if (NOW_OVERRIDE) return NOW_OVERRIDE;
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date()).reduce((a, x) => (a[x.type] = x.value, a), {});
  return `${p.year}-${p.month}-${p.day}T${p.hour}:00`;
}

const RAIN_MM = 0.5;    // גשם "אמיתי": לפחות 0.5 מ"מ בשעה
const DRIZZLE_MM = 0.1; // טפטוף / טיפות בודדות
/* ===================== לוגיקת "יוצאים / לא יוצאים" ===================== */
// 0 מתאים · 1 בזהירות · 2 לא מומלץ · 3 אין מספיק נתונים
const NODATA = 3;
const isNum = v => typeof v === 'number' && Number.isFinite(v);
function verdict(r) {
  const s = settings;
  const reasons = [], over = [];
  let level = 0, hazard = false;
  const bump = (lvl, why, o) => { if (lvl > level) level = lvl; if (!reasons.includes(why)) reasons.push(why); if (o) over.push(o); };
  const missing = [];
  if (!isNum(r.wind)) missing.push('רוח');
  if (!isNum(r.gust)) missing.push('משבים');
  if (!isNum(r.wave)) missing.push('גלים');

  if (isNum(r.code) && r.code >= 95) { bump(2, 'סופת רעמים'); hazard = true; }
  if (isNum(r.wind) && r.wind > s.maxWind) bump(r.wind > s.maxWind * 1.25 ? 2 : 1, 'רוח מעל הסף', { k: 'wind', v: r.wind, max: s.maxWind });
  if (isNum(r.gust) && r.gust > s.maxGust) bump(r.gust > s.maxGust * 1.25 ? 2 : 1, 'משבים מעל הסף', { k: 'gust', v: r.gust, max: s.maxGust });
  if (isNum(r.wave)) {
    if (r.wave > s.maxWave) bump(r.wave > s.maxWave * 1.3 ? 2 : 1, 'גלים מעל הסף', { k: 'wave', v: r.wave, max: s.maxWave });
    // ים קצר ותלול: גל משמעותי במחזור קצר
    if (isNum(r.wavePer) && r.wave >= s.maxWave * 0.7 && r.wavePer < s.minPeriod) bump(1, 'ים קצר ותלול');
  }
  if (isNum(r.vis) && r.vis < 2000) bump(1, 'ראות נמוכה');
  if (isNum(r.cape) && r.cape > 1000 && (r.pop ?? 0) > 30) bump(1, 'סיכון לרעמים');
  // נתון חיוני חסר: אי אפשר להמליץ – אלא אם כבר ידוע שזה "לא מומלץ"
  if (missing.length) {
    reasons.unshift('חסרים נתוני ' + missing.join(' ו'));
    if (level < 2) level = NODATA;
  }
  return { level, reasons, over, hazard, missing, cls: ['v-go', 'v-maybe', 'v-nogo', 'v-none'][level] };
}

function isNight(r) {
  const d = data.daily[r.date];
  if (!d) return r.hour < 6 || r.hour >= 18;
  const sr = +d.sunrise.slice(11, 13) + d.sunrise.slice(14, 16) / 60;
  const ss = +d.sunset.slice(11, 13) + d.sunset.slice(14, 16) / 60;
  return (r.hour + 0.5) < sr || r.hour > ss;
}

// שעה "שמישה" להפלגה: באור יום, ומסתיימת לכל המאוחר כרבע שעה אחרי השקיעה
function sunH(date, k) { const d = data.daily[date]; return d ? +d[k].slice(11, 13) + d[k].slice(14, 16) / 60 : (k === 'sunset' ? 17.5 : 6); }
// גם שעות ערב ולילה נחשבות – ההחלטה לפי רוח, משבים וגלים. החושך רק מסומן (☾) ומזכיר אורות ניווט.
function sailable(r) { return settings.night !== false || (!isNight(r) && r.hour + 1 <= sunH(r.date, 'sunset') + 0.25); }

// החלטה אחת לכל האתר (לשוניות ימים, סיכום, פירוט, מפת שבוע)
function dayVerdict(rows) {
  if (!rows.length) return { lvl: null, wins: [] };
  const vs = rows.map(verdict), n = vs.length;
  const known = vs.filter(v => v.level !== NODATA).length;
  const green = vs.filter(v => v.level === 0).length, red = vs.filter(v => v.level === 2).length;
  const hazard = vs.some(v => v.hazard);
  const wins = greenWindows(rows, 2);
  let lvl;
  if (known / n < 0.5) lvl = NODATA;
  else if (red / n > 0.5) lvl = 2;
  else if (green / n >= 0.5 && wins.length) lvl = 0;
  else if (!wins.length && hazard) lvl = 2;
  else lvl = 1;
  return { lvl, wins, hazard };
}

function dayRows(date) {
  return data.rows.filter(r => r.date === date && r.hour >= settings.hourFrom && r.hour <= settings.hourTo
    && (r.hour - settings.hourFrom) % settings.step === 0);
}

function daySummary(date) {
  const all = data.rows.filter(r => r.date === date);
  const win = all.filter(r => r.hour >= settings.hourFrom && r.hour <= settings.hourTo);
  const max = (arr, k) => arr.reduce((m, r) => r[k] != null && (m == null || r[k] > m) ? r[k] : m, null);
  const avg = (arr, k) => { const v = arr.map(r => r[k]).filter(x => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };

  // חלון ירוק רצוף הארוך ביותר בשעות האור
  let best = null, cur = null;
  for (const r of win) {
    const ok = verdict(r).level === 0 && !isNight(r);
    if (ok) { cur = cur ? { ...cur, end: r.hour } : { start: r.hour, end: r.hour }; if (!best || cur.end - cur.start > best.end - best.start) best = cur; }
    else cur = null;
  }
  // ירידת לחץ חדה (≥3hPa ב-3 שעות)
  let maxDrop = 0;
  const allIdx = data.rows.findIndex(r => r.date === date);
  for (let i = allIdx; i < allIdx + all.length; i++) {
    const a = data.rows[i - 3], b = data.rows[i];
    if (a && b && a.pres != null && b.pres != null) maxDrop = Math.max(maxDrop, a.pres - b.pres);
  }
  const act = activeRows(date);
  const late = date === nowLocal().slice(0, 10) && act.length < 2;
  const dv = dayVerdict(act);
  const dayLevel = dv.lvl == null ? 1 : dv.lvl;
  best = dv.wins.length ? dv.wins[0] : null; // החלון הארוך ביותר

  return {
    maxWind: max(win, 'wind'), maxGust: max(win, 'gust'), maxWave: max(win, 'wave'),
    avgPer: avg(win, 'wavePer'), sst: avg(all, 'sst'), maxDrop,
    thunder: all.some(r => r.code >= 95), best, dayLevel, late,
    sun: data.daily[date]
  };
}

// "נמשך לפני X דק׳" – לפי שעון ישראל, מתעדכן כל דקה
function ageText(ms) {
  const m = Math.round(ms / 60000);
  if (m < 1) return 'עכשיו';
  if (m < 60) return `לפני ${m} דק׳`;
  const h = Math.floor(m / 60);
  return h < 24 ? `לפני ${h === 1 ? 'שעה' : h + ' שעות'}` : `לפני ${Math.floor(h / 24)} ימים`;
}
/* ===================== סיכום סקיפר ===================== */
const HEB_DIR8 = ['צפונית', 'צפון-מזרחית', 'מזרחית', 'דרום-מזרחית', 'דרומית', 'דרום-מערבית', 'מערבית', 'צפון-מערבית'];
const dir8 = deg => deg == null ? '' : HEB_DIR8[Math.round(deg / 45) % 8];
function dirShift(rows) {
  const ds = rows.filter(r => r.dir != null);
  if (ds.length < 2) return '';
  const half = Math.ceil(ds.length / 2);
  const a = meanDir(ds.slice(0, half)), b = meanDir(ds.slice(half));
  if (a == null || b == null) return '';
  const d = Math.abs(((b - a) % 360 + 540) % 360 - 180);
  return d >= 45 && dir8(a) !== dir8(b) ? `מסתובבת מ${dir8(a)} ל${dir8(b)}` : '';
}
const COAST_NORMAL = 290; // חוף הרצליה פונה למערב-צפון-מערב
const pad2 = h => String(h).padStart(2, '0');
const range = (a, b, d = 0) => (a == null) ? '–' : (Math.abs(a - b) < (d ? 0.15 : 1.5) ? fmt(b, d) : `\u2066${fmt(a, d)}\u2060–\u2060${fmt(b, d)}\u2069`);

function meanDir(rows) {
  let x = 0, y = 0;
  rows.forEach(r => { if (r.dir != null && r.wind != null) { x += Math.sin(r.dir * Math.PI / 180) * (r.wind + 0.1); y += Math.cos(r.dir * Math.PI / 180) * (r.wind + 0.1); } });
  return (x === 0 && y === 0) ? null : (Math.atan2(x, y) * 180 / Math.PI + 360) % 360;
}
// ניסוחים פשוטים – מה מרגישים בפועל
function beaufortText(kt) {
  if (kt < 4) return 'כמעט בלי רוח';
  if (kt < 8) return 'רוח חלשה';
  if (kt < 12) return 'רוח נוחה';
  if (kt < 17) return 'רוח טובה להפלגה';
  if (kt < 22) return 'רוח חזקה';
  if (kt < 28) return 'רוח חזקה מאוד';
  return 'סערה';
}
function seaText(h) {
  if (h < 0.3) return 'ים שטוח';
  if (h < 0.6) return 'גלים קטנים';
  if (h < 1.0) return 'גלים בינוניים';
  if (h < 1.5) return 'גלים גבוהים';
  if (h < 2.5) return 'גלים גבוהים מאוד';
  return 'ים סוער';
}
function comfortText(h, T) {
  if (h == null) return '';
  if (h < 0.3) return 'כמעט בלי תנועה';
  if (T != null && T < 5 && h >= 0.6) return 'גלים קצרים וצפופים – תנועה חדה, עלול להיות לא נוח לרגישים לבחילה';
  if (h < 0.6) return 'צפויה תנועה קלה';
  if (h < 1.0) return 'הסירה מתנדנדת – לרוב נסבל';
  if (h < 1.5) return 'טלטולים – עלול להיות לא נוח לרגישים לבחילה';
  return 'טלטולים משמעותיים – לשקול התאמה לאורחים';
}
function sailAdvice(wind, gust) { // יאכטת מפרשים 12 מ'
  const w = wind ?? 0, g = gust ?? w;
  if (w >= 27 || g >= 34) return { t: 'לא לשייט פנאי – רוח חזקה מדי', lvl: 2 };
  if (w >= 21 || g >= 28) return { t: 'ריף שני + ג׳נואה מקוצרת · צוות מנוסה בלבד', lvl: 2 };
  if (w >= 16 || g >= 22) return { t: 'ריף ראשון במפרש הראשי, ג׳נואה חלקית', lvl: 1 };
  if (w >= 9) return { t: 'מפרשים מלאים – רוח טובה להפלגה', lvl: 0 };
  if (w >= 5) return { t: 'רוח קלה – מפרשים מלאים, הפלגה איטית', lvl: 0 };
  return { t: 'כמעט אין רוח – בעיקר מנוע', lvl: 0 };
}
// עצת מפרשים שלא סותרת את ההחלטה
function sailLine(wind, gust, lvl, waveMax) {
  const a = sailAdvice(wind, gust);
  if (a.lvl === 0 && (lvl > 0 || (waveMax ?? 0) > settings.maxWave)) {
    const base = a.t.replace(' – רוח טובה להפלגה', '');
    return { t: (waveMax ?? 0) > settings.maxWave ? base + ' · הים גבוה – לא נוח' : base, lvl: Math.max(a.lvl, lvl > 0 ? 1 : 0) };
  }
  return a;
}
// הרוח ביחס לקו החוף בלבד – בלי הכללות על זווית ההפלגה (זו מחושבת לכל כיוון בנפרד ב-courseNotes)
function coastNote(deg) {
  if (deg == null) return '';
  const d = Math.abs(((deg - COAST_NORMAL) % 360 + 540) % 360 - 180);
  if (d < 60) return 'רוח מהים לכיוון החוף';
  if (d > 120) return 'רוח מהיבשה – הרוח עלולה להתחזק בהתרחקות מהחוף';
  return 'רוח בערך לאורך קו החוף';
}
// כיוון הגלים – מנתוני הגלים עצמם (לא נגזר מכיוון הרוח)
function waveNote(rows) {
  const wd = rows.map(r => r.waveDir).filter(isNum);
  if (!wd.length) return '';
  let x = 0, y = 0; wd.forEach(d => { x += Math.sin(d * Math.PI / 180); y += Math.cos(d * Math.PI / 180); });
  const m = (Math.atan2(x, y) * 180 / Math.PI + 360) % 360;
  const d = Math.abs(((m - COAST_NORMAL) % 360 + 540) % 360 - 180);
  return `הגלים מגיעים ${from8(m)}${d < 60 ? ' – מהים הפתוח לכיוון החוף' : ''} (לפי תחזית הגלים)`;
}
// זווית ההפלגה בפועל לכל כיוון נפוץ, לפי כיוון הרוח – אותו חישוב בכל ההסברים
const HEADINGS = [{ t: 'צפונה (נתניה)', h: 15 }, { t: 'דרומה (ת"א / יפו)', h: 195 }, { t: 'מערבה – לים הפתוח', h: 285 }, { t: 'חזרה מזרחה – לכיוון החוף', h: 105 }];
function courseNotes(deg) {
  if (deg == null) return [];
  return HEADINGS.map(x => ({ ...x, p: pointOfSail(deg, x.h) }));
}
/* ===================== גשם – מודל אחד לכל המסכים =====================
 זמן: ב-Open-Meteo הכמות (precipitation) וההסתברות מתייחסות לשעה שקדמה לחותמת הזמן –
   השורה של 16:00 מתארת את 15:00–16:00. כל הטווחים שמוצגים מחושבים כך.
 הסתברות: אם יש אנסמבל לשעה – אחוז התרחישים התקינים באותה שעה עם ≥0.5 מ"מ (popEns, מתוך ensN);
   אחרת – precipitation_probability של Open-Meteo (>0.1 מ"מ, popOM). אלה שני מדדים שונים, והמקור מוצג.
   "הסתברות מרבית בשעה בודדת" איננה ההסתברות שיירד גשם במהלך כל הטווח.
 עוצמה: לפי כמות בשעה (AMS Glossary of Meteorology): עד 2.5 מ"מ קל, 2.5–7.6 בינוני, מעל 7.6 חזק.
   זו כמות ממוצעת לשעה – לא עוצמת שיא רגעית. בלי נתון כמות לא קובעים עוצמה. כמות קטנה לבדה לא מוגדרת "טפטוף".
 כללי הצגה – שעה נחשבת גשומה אם:
   כמות ≥0.5 מ"מ (גם כשההסתברות נמוכה – לא מסתירים כמות משמעותית) | הסתברות אנסמבל ≥40% |
   הסתברות Open-Meteo ≥60% | סופת רעמים (קוד ≥95, גם כשהכמות קטנה – עדיפות גבוהה).
 שעה בלי כמות ובלי הסתברות ובלי קוד = חסרה. חסר ≠ אפס: לא מציגים אותה כ"יבש".
*/
const RAIN = { mm: 0.5, pEns: 40, pOM: 60, light: 2.5, heavy: 7.6 };
const INT_NAME = ['קל', 'בינוני', 'חזק'];
const rainIntensity = mm => !isNum(mm) || mm < 0.1 ? null : mm <= RAIN.light ? 0 : mm <= RAIN.heavy ? 1 : 2;
function rainProb(r) {
  if (isNum(r.popEns)) return { p: r.popEns, src: 'ens', n: r.ensN };
  if (isNum(r.popOM)) return { p: r.popOM, src: 'om' };
  return null;
}
function rainHour(r) {
  if (!r || r.placeholder) return { missing: true };
  const amt = isNum(r.rain) ? r.rain : null, pr = rainProb(r);
  const thunder = isNum(r.code) && r.code >= 95;
  if (amt == null && !pr && !thunder) return { missing: true };
  const byAmt = amt != null && amt >= RAIN.mm;
  const byP = !!pr && pr.p >= (pr.src === 'ens' ? RAIN.pEns : RAIN.pOM);
  return { missing: false, wet: byAmt || byP || thunder, thunder, amt, pr };
}
// השורות שהמרווח שלהן נמצא בתוך [date+from, date+to]: from+1 … to (גם מעבר לחצות)
function intervalRows(date, from, to) {
  const idx = rowIndex(), out = [];
  for (let k = 1; k <= to - from; k++) {
    const t = addHours(date, from, k);
    out.push(idx.get(t) || { t, date: t.slice(0, 10), hour: +t.slice(11, 13), placeholder: true });
  }
  return out;
}
// פירוק לאירועים נפרדים: שעה יבשה או חסרה מפרידה בין אירועים
function rainEvents(rows) {
  const groups = []; let cur = null, prev = null, missing = 0;
  for (const r of rows) {
    const h = rainHour(r);
    if (h.missing) missing++;
    const contig = prev && tMs(r.t) - tMs(prev.t) === 3600e3;
    if (h.wet) {
      if (!cur || !contig) { if (cur) groups.push(cur); cur = { rows: [], hours: [] }; }
      cur.rows.push(r); cur.hours.push(h);
    } else if (cur) { groups.push(cur); cur = null; }
    prev = r;
  }
  if (cur) groups.push(cur);
  const events = groups.map(g => {
    const first = g.rows[0], last = g.rows[g.rows.length - 1];
    const amts = g.hours.map((h, i) => [h.amt, g.rows[i]]).filter(([a]) => isNum(a));
    const probs = g.hours.map((h, i) => [h.pr, g.rows[i]]).filter(([p]) => p);
    const ints = amts.map(([a]) => rainIntensity(a)).filter(x => x != null);
    const maxA = amts.reduce((m, x) => !m || x[0] > m[0] ? x : m, null);
    const maxP = probs.reduce((m, x) => !m || x[0].p > m[0].p ? x : m, null);
    const srcs = [...new Set(probs.map(([p]) => p.src))];
    return {
      start: (first.hour + 23) % 24, end: last.hour, startT: first.t, endT: last.t, n: g.rows.length,
      total: amts.length ? amts.reduce((s, [a]) => s + a, 0) : null,
      maxMm: maxA ? maxA[0] : null, maxMmEnd: maxA ? maxA[1].hour : null,
      maxP: maxP ? maxP[0].p : null, maxPEnd: maxP ? maxP[1].hour : null,
      src: srcs.length === 1 ? srcs[0] : srcs.length ? 'mixed' : null, ensN: maxP && maxP[0].n,
      intMin: ints.length ? Math.min(...ints) : null, intMax: ints.length ? Math.max(...ints) : null,
      thunder: g.hours.some(h => h.thunder), amountsKnown: amts.length
    };
  });
  return { events, missing, total: rows.length };
}
const hhSpan = (a, b) => `\u2066${hm(a)}–${hm(b)}\u2069`;
function rainWhat(e) {
  if (e.thunder) return 'סופת רעמים';
  if (e.intMax == null) return 'גשם אפשרי';
  return 'גשם ' + (e.intMin === e.intMax ? INT_NAME[e.intMax] : `${INT_NAME[e.intMin]} עד ${INT_NAME[e.intMax]}`);
}
const PROB_SRC = { ens: 'אחוז התרחישים (ECMWF/GFS/ICON) שצופים 0.5 מ"מ לפחות בשעה', om: 'הסתברות Open-Meteo ל-0.1 מ"מ לפחות בשעה', mixed: 'חלק מהשעות לפי תרחישים (0.5 מ"מ) וחלק לפי Open-Meteo (0.1 מ"מ)' };
// סיכום אחד לכל מקום בממשק. status: dry (מסתירים) | wet | missing (אין נתונים)
function rainSummary(rows) {
  const { events, missing, total } = rainEvents(rows);
  const missNote = missing && missing < total ? `חסרים נתוני גשם ${missing === 1 ? 'לשעה אחת' : `ל-${missing} שעות`}` : '';
  if (!events.length) {
    if (total && missing === total) return { status: 'missing', events, text: 'אין נתוני גשם לשעות האלה', details: [] };
    return { status: 'dry', events, text: '', note: missNote, details: [] };
  }
  const maxP = Math.max(...events.map(e => e.maxP ?? -1));
  const thunder = events.some(e => e.thunder);
  let text;
  if (events.length === 1) text = `${rainWhat(events[0])} ${events[0].thunder ? 'צפויה' : 'צפוי'} בין ${hm(events[0].start)} ל-${hm(events[0].end)}`;
  else text = `${thunder ? 'גשם וסופת רעמים' : 'גשם'} ב-${events.length} פרקים נפרדים: ${events.map(e => hhSpan(e.start, e.end)).join(' ו-')}`;
  if (maxP >= 0) text += `. הסתברות מרבית בשעה בודדת: ${maxP}%`;
  const details = events.map(e => {
    const parts = [`${hhSpan(e.start, e.end)}: ${rainWhat(e)}`];
    if (e.total != null && e.total >= 0.1) parts.push(`כמות מצטברת ${fmt(e.total, 1)} מ"מ`);
    if (e.maxMm != null && e.maxMm >= 0.1 && e.n > 1) parts.push(`בשעה הגשומה ביותר (${hhSpan((e.maxMmEnd + 23) % 24, e.maxMmEnd)}) ${fmt(e.maxMm, 1)} מ"מ`);
    if (e.amountsKnown === 0) parts.push('אין נתון כמות – לא נקבעה עוצמה');
    if (e.maxP != null) parts.push(`הסתברות מרבית בשעה בודדת ${e.maxP}% (${hhSpan((e.maxPEnd + 23) % 24, e.maxPEnd)})`);
    return parts.join(' · ');
  });
  const srcs = [...new Set(events.map(e => e.src).filter(Boolean))];
  const src = srcs.length === 1 ? srcs[0] : srcs.length ? 'mixed' : null;
  return { status: 'wet', events, text, thunder, note: missNote, details, src, srcText: src ? PROB_SRC[src] : '' };
}
// גשם ב-4 השעות שאחרי השעה שנבחרה (המרווחים h…h+4)
const rainNext = (date, hour, k = 4) => rainSummary(intervalRows(date, hour, hour + k));
// גשם בהפלגה: מהיציאה עד החזרה, ובנפרד – השעתיים שאחרי החזרה
function rainForPlan(p) {
  const during = rainSummary(intervalRows(p.date, p.from, p.to));
  const after = rainSummary(intervalRows(p.date, p.to, p.to + 2));
  return { during, after };
}
const tMs = t => Date.parse(t + ':00Z');
function greenWindows(rows, minLen = 1) {
  // חלון = שעות ירוקות רצופות בפועל; שעה חסרה בתחזית קוטעת את החלון
  const out = []; let cur = null, prev = null;
  for (const r of rows) {
    const ok = verdict(r).level === 0;
    const contig = prev && tMs(r.t) - tMs(prev.t) === 3600e3;
    if (ok) {
      if (cur && contig) { cur.end = r.hour; cur.n++; }
      else { if (cur) out.push(cur); cur = { start: r.hour, end: r.hour, n: 1, date: r.date }; }
    } else if (cur) { out.push(cur); cur = null; }
    prev = r;
  }
  if (cur) out.push(cur);
  return out.filter(w => w.n >= minLen).sort((a, b) => b.n - a.n);
}

function activeRows(date) {
  const nowT = nowLocal();
  return data.rows.filter(r => r.date === date && r.hour >= settings.hourFrom && r.hour <= settings.hourTo && sailable(r) && r.t >= nowT.slice(0, 13));
}

function seaFeel(r) {
  return isNum(r.wave) ? comfortText(r.wave, r.wavePer) : 'אין נתוני גלים לשעה הזו';
}

const FROM8 = ['מצפון', 'מצפון-מזרח', 'ממזרח', 'מדרום-מזרח', 'מדרום', 'מדרום-מערב', 'ממערב', 'מצפון-מערב'];
const from8 = deg => deg == null ? '' : FROM8[Math.round(deg / 45) % 8];
const hm = h => `${pad2(h % 24)}:00`;

function pointOfSail(windFrom, heading) {
  const a = Math.abs(((windFrom - heading) % 360 + 540) % 360 - 180);
  if (a < 40) return { t: 'מול הרוח – צריך לחצות הלוך ושוב', c: 'var(--nogo-ink)', a };
  if (a < 60) return { t: 'צמוד לרוח – הטיה ותנועה מורגשת', c: 'var(--maybe-ink)', a };
  if (a < 80) return { t: 'רוח קרובה', c: 'var(--go-ink)', a };
  if (a < 110) return { t: 'חצי רוח', c: 'var(--go-ink)', a };
  if (a < 150) return { t: 'רוח גבית', c: 'var(--go-ink)', a };
  return { t: 'רוח מאחור – להיזהר מג׳ייב', c: 'var(--maybe-ink)', a };
}

function rowIndex() {
  if (!(data._idx instanceof Map)) Object.defineProperty(data, '_idx', { value: new Map(data.rows.map(r => [r.t, r])), enumerable: false, configurable: true, writable: true });
  return data._idx;
}
function addHours(date, hour, k) {
  const d = new Date(Date.parse(`${date}T${pad2(hour)}:00:00Z`) + k * 3600e3).toISOString();
  return d.slice(0, 13) + ':00';
}
// כל שעה מהיציאה ועד שעת החזרה (כולל) – שעה שאין לה תחזית מסומנת כחסרה
function planRows(p) {
  const idx = rowIndex(), out = [];
  for (let k = 0; k <= p.to - p.from; k++) {
    const t = addHours(p.date, p.from, k);
    out.push(idx.get(t) || { t, date: t.slice(0, 10), hour: +t.slice(11, 13), models: {}, placeholder: true });
  }
  return out;
}
function planVerdict(rows) {
  const vs = rows.map(verdict), n = Math.max(1, vs.length);
  if (vs.some(v => v.hazard)) return 2;                 // סכנה (רעמים) – לא נבלעת בממוצע
  const red = vs.filter(v => v.level === 2).length, yel = vs.filter(v => v.level === 1).length;
  if (red / n > 0.3) return 2;
  if (vs.some(v => v.level === NODATA)) return NODATA;  // חסר מידע לחלק מהשעות
  if (red || yel) return 1;
  return 0;
}
function modelConfidence(rows) {
  // מודד רק הסכמה בין מודלי רוח – לא את אמינות תחזית הגלים
  const per = rows.map(r => { const w = Object.values(r.models || {}).map(m => m.wind).filter(isNum); return w.length >= 2 ? { spread: Math.max(...w) - Math.min(...w), n: w.length, hour: r.hour } : null; }).filter(Boolean);
  if (!per.length) return null;
  const n = Math.max(...per.map(p => p.n));
  const worst = per.reduce((a, b) => b.spread > a.spread ? b : a);
  const avg = per.reduce((a, b) => a + b.spread, 0) / per.length;
  const label = `הסכמה בין ${n} מודלי רוח`;
  const d = `פער ממוצע ${fmt(avg, 0)} קשר, פער מרבי ${fmt(worst.spread, 0)} קשר ב-${hm(worst.hour)}`;
  if (avg < 4 && worst.spread < 7) return { t: 'גבוהה', c: 'var(--go-ink)', label, d };
  if (avg < 7 && worst.spread < 11) return { t: 'בינונית', c: 'var(--maybe-ink)', label, d: d + ' – כדאי לבדוק שוב לפני היציאה' };
  return { t: 'נמוכה', c: 'var(--nogo-ink)', label, d: d + ' – התחזית לא ודאית' };
}
// טווח שעות להצגה. בהפלגה (lastIsEnd) השורה האחרונה היא רגע החזרה – הטווח לא נמשך אחריה
function spanLabel(rows, i0, i1, lastIsEnd) {
  const a = rows[i0].hour, endsAtReturn = lastIsEnd && i1 === rows.length - 1;
  if (endsAtReturn && i0 === i1) return `ב-${hm(a)}`;
  return `${hm(a)}–${hm(endsAtReturn ? rows[i1].hour : rows[i1].hour + 1)}`;
}
function reasonsByHour(rows, lastIsEnd = false) {
  const map = new Map();
  rows.forEach((r, i) => verdict(r).reasons.forEach(why => { if (!map.has(why)) map.set(why, []); map.get(why).push(i); }));
  return [...map.entries()].map(([why, ix]) => `${why} (<bdi dir="ltr">${spanLabel(rows, Math.min(...ix), Math.max(...ix), lastIsEnd)}</bdi>)`);
}
function sailPlanSegments(rows, lastIsEnd = false) {
  const segs = [];
  rows.forEach((r, i) => {
    const a = sailAdvice(r.wind, r.gust);
    const last = segs[segs.length - 1];
    if (last && last.t === a.t) last.i1 = i; else segs.push({ t: a.t, lvl: a.lvl, i0: i, i1: i });
  });
  return segs.map(sg => ({ ...sg, start: rows[sg.i0].hour, end: rows[sg.i1].hour, label: spanLabel(rows, sg.i0, sg.i1, lastIsEnd) }));
}
// הפלגה שמתאימה לחלון: יציאה בתחילתו, חזרה בשעה המתאימה האחרונה
const windowPlan = (w, date = w.date) => ({ date, from: w.start, to: w.end });
function findAlternatives(p) {
  const dur = p.to - p.from;
  const nowT = nowLocal();
  const out = [];
  const dates = [...new Set(data.rows.map(r => r.date))];
  for (const d of dates) {
    for (let h = 0; h + dur <= 24; h++) {
      const rows = planRows({ date: d, from: h, to: h + dur });
      if (rows[0].t.slice(0, 13) < nowT.slice(0, 13)) continue;
      if (rows.some(r => verdict(r).level !== 0 || (!settings.night && isNight(r)))) continue;
      const dist = Math.abs((tMs(rows[0].t) - tMs(`${p.date}T${pad2(p.from)}:00`)) / 3600e3);
      out.push({ date: d, from: h, to: h + dur, dist });
    }
  }
  out.sort((a, b) => a.dist - b.dist);
  const res = [];
  for (const o of out) { if (!res.some(r => r.date === o.date)) res.push(o); if (res.length === 3) break; }
  return res;
}
// אימות הגדרות: ערכים מספריים בטווח סביר; ערך לא תקין נשאר כמו שהיה
const LIMITS = {
  maxWind: [3, 50, 'רוח עד'], maxGust: [3, 60, 'משבים עד'], maxWave: [0.2, 5, 'גלים עד'], minPeriod: [0, 15, 'מחזור גל מינימלי'],
  hourFrom: [0, 23, 'משעה'], hourTo: [0, 23, 'עד שעה'], windLat: [29.5, 33.5, 'קו רוחב רוח'], windLon: [34, 35.6, 'קו אורך רוח'],
  waveLat: [29.5, 33.5, 'קו רוחב גלים'], waveLon: [33.5, 35.6, 'קו אורך גלים']
};
function validateSettings(input, prev = DEFAULTS) {
  const out = { ...prev }, errors = [];
  for (const [k, [lo, hi, label]] of Object.entries(LIMITS)) {
    const v = typeof input[k] === 'number' ? input[k] : parseFloat(input[k]);
    if (!Number.isFinite(v) || v < lo || v > hi) { errors.push(`${label}: צריך להיות בין ${lo} ל-${hi}`); continue; }
    out[k] = (k === 'hourFrom' || k === 'hourTo') ? Math.round(v) : v;
  }
  if (out.maxGust < out.maxWind) errors.push('המשבים לא יכולים להיות נמוכים מהרוח');
  if (out.hourTo < out.hourFrom) { errors.push('"עד שעה" צריך להיות אחרי "משעה"'); out.hourTo = prev.hourTo; out.hourFrom = prev.hourFrom; }
  out.step = [1, 2, 3].includes(+input.step) ? +input.step : prev.step;
  out.showModels = !!input.showModels;
  out.night = input.night !== undefined ? !!input.night : prev.night;
  return { s: out, errors };
}
