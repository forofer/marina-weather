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
  const wins = dv.wins.slice(0, 2).sort((a, b) => a.start - b.start);
  const winTxt = wins.map(w => `${hm(w.start)}–${hm(w.end + 1)}`).join(' , ');
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
  return { lvl, title, why, later, wins, rows, dv };
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
  if (h < 0.3) return 'כמעט בלי תנועה – נעים לכולם';
  if (T != null && T < 5 && h >= 0.6) return 'גלים קצרים וצפופים – הסירה מטלטלת, עלול לגרום לבחילה';
  if (h < 0.6) return 'תנועה קלה – נעים לכולם';
  if (h < 1.0) return 'הסירה מתנדנדת – רוב האנשים מרגישים בסדר';
  if (h < 1.5) return 'טלטולים – מי שרגיש לבחילה ירגיש לא טוב';
  return 'טלטולים חזקים – לא מתאים לאורחים';
}
function sailAdvice(wind, gust) { // יאכטת מפרשים 12 מ'
  const w = wind ?? 0, g = gust ?? w;
  if (w >= 27 || g >= 34) return { t: 'לא לשייט פנאי – רוח חזקה מדי', lvl: 2 };
  if (w >= 21 || g >= 28) return { t: 'ריף שני + ג׳נואה מקוצרת · צוות מנוסה בלבד', lvl: 2 };
  if (w >= 16 || g >= 22) return { t: 'ריף ראשון במפרש הראשי, ג׳נואה חלקית', lvl: 1 };
  if (w >= 9) return { t: 'מפרשים מלאים – תנאי הפלגה מצוינים', lvl: 0 };
  if (w >= 5) return { t: 'רוח קלה – מפרשים מלאים, הפלגה איטית', lvl: 0 };
  return { t: 'כמעט אין רוח – בעיקר מנוע', lvl: 0 };
}
// עצת מפרשים שלא סותרת את ההחלטה
function sailLine(wind, gust, lvl, waveMax) {
  const a = sailAdvice(wind, gust);
  if (a.lvl === 0 && (lvl > 0 || (waveMax ?? 0) > settings.maxWave)) {
    const base = a.t.replace(' – תנאי הפלגה מצוינים', '');
    return { t: (waveMax ?? 0) > settings.maxWave ? base + ' · הים גבוה – לא נוח' : base, lvl: Math.max(a.lvl, lvl > 0 ? 1 : 0) };
  }
  return a;
}
function coastNote(deg) {
  if (deg == null) return '';
  let d = Math.abs(((deg - COAST_NORMAL) % 360 + 540) % 360 - 180);
  if (d < 60) return 'רוח ים (מהים לחוף) – הגלים נבנים לכיוון החוף, כניסה למרינה עם רוח מאחור';
  if (d > 120) return 'רוח יבשה – ים שקט ליד החוף אך משבית, מתחזקת בהתרחקות מהחוף';
  return 'רוח לאורך החוף – הפלגה צפונה או דרומה תהיה בחצי רוח, מהירה ונוחה';
}
// גשם בשעה r ובשלוש השעות שאחריה – בלי הבטחות מוחלטות
function rainSoonText(r) {
  const next = data.rows.filter(x => x.t >= r.t).slice(0, 4);
  const end = hm(Math.min(24, r.hour + 4));
  const wetH = next.filter(x => (x.pop ?? 0) >= 25 || (x.rain ?? 0) >= RAIN_MM);
  const maxPop = Math.max(0, ...next.map(x => x.pop ?? 0));
  if (!next.some(x => isNum(x.pop) || isNum(x.rain))) return { wet: false, t: 'אין נתוני גשם' };
  if (wetH.length) return { wet: true, t: `סיכוי לגשם ${fmt(maxPop)}% ב-<bdi dir="ltr">${hm(wetH[0].hour)}</bdi>` };
  if (maxPop >= 5) return { wet: false, t: `סיכוי נמוך לגשם עד <bdi dir="ltr">${end}</bdi>` };
  return { wet: false, t: `לא צפוי גשם עד <bdi dir="ltr">${end}</bdi>` };
}
function rainText(rows) {
  const wet = rows.filter(r => (r.pop ?? 0) >= 30 || (r.rain ?? 0) >= RAIN_MM);
  if (!wet.length) {
    const cloud = rows.reduce((a, r) => a + (r.cloud ?? 0), 0) / Math.max(1, rows.length);
    const maxDriz = Math.max(0, ...rows.map(r => r.drizzle ?? 0));
    const sky = cloud < 25 ? 'בהיר' : cloud < 70 ? 'מעונן חלקית' : 'מעונן';
    return { t: maxDriz >= 30 ? `${sky}, ייתכן טפטוף קל (${maxDriz}%)` : `${sky}, ללא גשם`, wet: false };
  }
  const maxPop = Math.max(...wet.map(r => r.pop ?? 0));
  const mm = wet.reduce((a, r) => a + (r.rain ?? 0), 0);
  const chance = maxPop >= 10 ? `סיכוי עד ${fmt(maxPop)}%` : 'סיכוי נמוך';
  return { t: `גשם אפשרי \u2066${pad2(wet[0].hour)}:00–${pad2(wet[wet.length - 1].hour + 1)}:00\u2069 (${fmt(mm, 1)} מ"מ, ${chance})`, wet: true };
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
  if (a < 40) return { t: 'מול הרוח – צריך לחצות הלוך ושוב', c: 'var(--nogo)' };
  if (a < 60) return { t: 'צמוד לרוח – הטיה ותנועה מורגשת', c: 'var(--gust)' };
  if (a < 80) return { t: 'רוח קרובה – הפלגה טובה', c: 'var(--go)' };
  if (a < 110) return { t: 'חצי רוח – מהיר ונוח', c: 'var(--go)' };
  if (a < 150) return { t: 'רוח גבית – נוח ויציב', c: 'var(--go)' };
  return { t: 'רוח מאחור – להיזהר מג׳ייב', c: 'var(--warn)' };
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
  if (avg < 4 && worst.spread < 7) return { t: 'גבוהה', c: 'var(--go)', label, d };
  if (avg < 7 && worst.spread < 11) return { t: 'בינונית', c: 'var(--warn)', label, d: d + ' – כדאי לבדוק שוב לפני היציאה' };
  return { t: 'נמוכה', c: 'var(--nogo)', label, d: d + ' – התחזית לא ודאית' };
}
function reasonsByHour(rows) {
  const map = new Map();
  rows.forEach(r => verdict(r).reasons.forEach(why => { if (!map.has(why)) map.set(why, []); map.get(why).push(r.hour); }));
  return [...map.entries()].map(([why, hs]) => `${why} (<bdi dir="ltr">${hm(Math.min(...hs))}–${hm(Math.max(...hs) + 1)}</bdi>)`);
}
function sailPlanSegments(rows) {
  const segs = [];
  rows.forEach(r => {
    const a = sailAdvice(r.wind, r.gust);
    const last = segs[segs.length - 1];
    if (last && last.t === a.t) last.end = r.hour; else segs.push({ t: a.t, lvl: a.lvl, start: r.hour, end: r.hour });
  });
  return segs;
}
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
