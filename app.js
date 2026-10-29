'use strict';

/* ===================== הגדרות ברירת מחדל ===================== */
const DEFAULTS = {
  windLat: 32.165, windLon: 34.785,   // מרינה הרצליה
  waveLat: 32.170, waveLon: 34.760,   // ים פתוח ~2.5 ק"מ מערבית למרינה
  maxWind: 16, maxGust: 22, maxWave: 1.3, minPeriod: 5,
  hourFrom: 6, hourTo: 21, step: 1, showModels: true
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

/* ===================== אחסון (עובד גם מחוץ לתוסף) ===================== */
const store = {
  get(area, key) {
    return new Promise(res => {
      try { chrome.storage[area].get(key, v => res(v ? v[key] : undefined)); }
      catch (e) { try { res(JSON.parse(localStorage.getItem(key))); } catch (_) { res(undefined); } }
    });
  },
  set(area, key, val) {
    return new Promise(res => {
      try { chrome.storage[area].set({ [key]: val }, () => res()); }
      catch (e) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (_) {} res(); }
    });
  }
};

/* ===================== סטטיסטיקה (GoatCounter – ללא עוגיות) ===================== */
function track(name) {
  try { if (window.goatcounter && window.goatcounter.count) window.goatcounter.count({ path: 'event/' + name, title: name, event: true }); } catch (_) {}
}

/* ===================== עזרים ===================== */
const $ = id => document.getElementById(id);
const fmt = (v, d = 0) => (v == null || Number.isNaN(v)) ? '–' : Number(v).toFixed(d);
const compass = deg => deg == null ? '' : COMPASS[Math.round(deg / 22.5) % 16];
const arrow = deg => deg == null ? '' :
  `<span class="arrow" style="transform:rotate(${Math.round(deg)}deg)" title="מ-${compass(deg)} (${Math.round(deg)}°)">↓</span>`;

function scaleColor(v, stops) {
  if (v == null) return 'transparent';
  let c = stops[0][1];
  for (const [t, col] of stops) if (v >= t) c = col;
  return c;
}
// סולמות צבע: רוח בכחולים עד ~16 קשר ואז חם; גלים בטורקיז עד ~1.5 מ׳ ואז חם. ירוק/צהוב/אדום שמורים להחלטה בלבד.
const WIND_STOPS = [[0,'#e8f3fc'],[4,'#cde5f7'],[7,'#a6d1f1'],[10,'#79b8e8'],[13,'#4e9bdc'],[16,'#2c78c9'],[19,'#f0b44a'],[23,'#e9853a'],[27,'#d94e43'],[32,'#b23a87'],[38,'#7a3fb0']];
const WAVE_STOPS = [[0,'#e3f5f2'],[0.3,'#bce7e1'],[0.6,'#8dd3ca'],[0.9,'#5cbab1'],[1.25,'#379b96'],[1.6,'#f0b44a'],[2.2,'#e9853a'],[3,'#d94e43'],[4,'#b23a87']];
function ink(hex) { // צבע טקסט קריא על רקע נתון
  if (!hex || hex[0] !== '#') return 'var(--fg)';
  const n = parseInt(hex.slice(1), 16), r = n >> 16 & 255, g = n >> 8 & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#0d141c' : '#ffffff';
}
const VERDICT = [{ t: 'מתאים להפלגה', g: '✓', long: 'כן, מתאים להפלגה' }, { t: 'אפשר, בזהירות', g: '!', long: 'אפשר, אבל בזהירות' }, { t: 'לא מומלץ', g: '✕', long: 'לא מומלץ להפליג' }];
// "האם מתאים להפליג מחר?" / "...בשבת?" / "...ביום ראשון?"
function whenWords(date) {
  const l = dayLabel(date, nowLocal().slice(0, 10)).name;
  return l === 'היום' || l === 'מחר' ? l : l === 'שבת' ? 'בשבת' : 'ביום ' + l;
}
// סיבות בשפה פשוטה, עם המספר הרלוונטי
function plainReasons(rows) {
  const set = new Set(); rows.forEach(r => verdict(r).reasons.forEach(x => set.add(x)));
  const mx = k => Math.max(...rows.map(r => r[k] ?? 0));
  const map = {
    'גלים מעל הסף': () => `גלים גבוהים, עד ${fmt(mx('wave'), 1)} מ׳`,
    'משבים מעל הסף': () => `משבי רוח חזקים, עד ${fmt(mx('gust'))} קשר`,
    'רוח מעל הסף': () => `רוח חזקה, עד ${fmt(mx('wind'))} קשר`,
    'ים קצר ותלול': () => 'ים קצר ומטלטל',
    'סופת רעמים': () => 'סופת רעמים', 'סיכון לרעמים': () => 'סיכון לרעמים', 'ראות נמוכה': () => 'ראות נמוכה'
  };
  return [...set].map(x => (map[x] || (() => x))());
}
const vGlyph = (lvl, big) => `<span class="vglyph v${lvl}${big ? ' big' : ''}" aria-hidden="true">${VERDICT[lvl].g}</span>`;
const ICON = { wind: '💨', wave: '🌊', rain: '🌧️', sun: '☀️', warn: '⚠️', live: '📡' };

function wxIcon(code, isNight) {
  if (code == null) return '';
  if (code >= 95) return '⛈️';
  if (code >= 80) return '🌦️';
  if (code >= 71) return '🌨️';
  if (code >= 61) return '🌧️';
  if (code >= 51) return '🌦️';
  if (code >= 45) return '🌫️';
  if (code === 3) return '☁️';
  if (code === 2) return isNight ? '☁️' : '⛅';
  if (code === 1) return isNight ? '🌙' : '🌤️';
  return isNight ? '🌙' : '☀️';
}

function dayLabel(dateStr, todayStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const diff = Math.round((d - new Date(todayStr + 'T12:00:00')) / 86400000);
  const name = diff === 0 ? 'היום' : diff === 1 ? 'מחר' : HEB_DAYS[d.getDay()];
  return { name, sub: (diff <= 1 ? HEB_DAYS[d.getDay()] + ' ' : '') + `${d.getDate()}/${d.getMonth() + 1}` };
}

function nowLocal() {
  // מחזיר 'YYYY-MM-DDTHH:00' לפי שעון ישראל
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date()).reduce((a, x) => (a[x.type] = x.value, a), {});
  return `${p.year}-${p.month}-${p.day}T${p.hour}:00`;
}

/* ===================== שליפת נתונים ===================== */
function buildUrls(s) {
  const common = `timezone=${encodeURIComponent(TZ)}&forecast_days=${DAYS}`;
  return {
    forecast: `https://api.open-meteo.com/v1/forecast?latitude=${s.windLat}&longitude=${s.windLon}` +
      `&hourly=temperature_2m,precipitation_probability,precipitation,weather_code,cloud_cover,visibility,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,cape` +
      `&daily=sunrise,sunset&current=temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,pressure_msl,weather_code` +
      `&wind_speed_unit=kn&cell_selection=sea&${common}`,
    models: `https://api.open-meteo.com/v1/forecast?latitude=${s.windLat}&longitude=${s.windLon}` +
      `&hourly=wind_speed_10m,wind_gusts_10m&models=${MODELS.map(m => m.id).join(',')}&wind_speed_unit=kn&cell_selection=sea&${common}`,
    marine: `https://marine-api.open-meteo.com/v1/marine?latitude=${s.waveLat}&longitude=${s.waveLon}` +
      `&hourly=wave_height,wave_direction,wave_period,wind_wave_height,wind_wave_period,wind_wave_direction,swell_wave_height,swell_wave_direction,swell_wave_period,sea_surface_temperature` +
      `&current=wave_height,wave_period,wave_direction,sea_surface_temperature&${common}`,
    // אנסמבל: 122 הרצות (ECMWF 51 + GFS 31 + ICON 40) – לחישוב סיכוי לגשם אמיתי
    ensemble: `https://ensemble-api.open-meteo.com/v1/ensemble?latitude=${s.windLat}&longitude=${s.windLon}` +
      `&hourly=precipitation&models=ecmwf_ifs025,gfs025,icon_global&cell_selection=sea&${common}`
  };
}

async function getJson(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try { const j = await r.json(); if (j.reason) msg += ` – ${j.reason}`; } catch (_) {}
    throw new Error(msg);
  }
  return r.json();
}

async function fetchAll() {
  const u = buildUrls(settings);
  const [fc, md, mr, en] = await Promise.allSettled([getJson(u.forecast), getJson(u.models), getJson(u.marine), getJson(u.ensemble)]);
  if (fc.status === 'rejected' && mr.status === 'rejected') {
    throw new Error(`לא ניתן לקבל תחזית (${fc.reason.message})`);
  }
  const errors = [];
  if (fc.status === 'rejected') errors.push('תחזית הרוח לא נטענה');
  if (mr.status === 'rejected') errors.push('תחזית הגלים לא נטענה');
  return merge(fc.value, md.status === 'fulfilled' ? md.value : null, mr.value, errors, en.status === 'fulfilled' ? en.value : null);
}

const RAIN_MM = 0.5;    // גשם "אמיתי": לפחות 0.5 מ"מ בשעה
const DRIZZLE_MM = 0.1; // טפטוף / טיפות בודדות
function merge(fc, md, mr, errors, en) {
  const byTime = new Map();
  const row = t => {
    if (!byTime.has(t)) byTime.set(t, { t, date: t.slice(0, 10), hour: +t.slice(11, 13), models: {} });
    return byTime.get(t);
  };
  if (fc && fc.hourly) {
    const h = fc.hourly;
    h.time.forEach((t, i) => Object.assign(row(t), {
      temp: h.temperature_2m[i], pop: h.precipitation_probability?.[i], rain: h.precipitation[i],
      code: h.weather_code[i], cloud: h.cloud_cover[i], vis: h.visibility?.[i], pres: h.pressure_msl[i],
      wind: h.wind_speed_10m[i], dir: h.wind_direction_10m[i], gust: h.wind_gusts_10m[i], cape: h.cape?.[i]
    }));
  }
  // סיכוי לגשם מחושב מהאנסמבל (במקום precipitation_probability שסופר כל טיפה)
  let hasEnsemble = false;
  if (en && en.hourly) {
    const h = en.hourly;
    const keys = Object.keys(h).filter(k => k.startsWith('precipitation'));
    if (keys.length >= 10) {
      hasEnsemble = true;
      h.time.forEach((t, i) => {
        let n = 0, rainN = 0, drizN = 0;
        for (const k of keys) { const v = h[k][i]; if (v == null) continue; n++; if (v >= RAIN_MM) rainN++; if (v >= DRIZZLE_MM) drizN++; }
        if (!n) return;
        const r = row(t);
        r.popAny = r.pop;                       // הערך המקורי של Open-Meteo (כל טיפה)
        r.pop = Math.round(100 * rainN / n);    // סיכוי לגשם ≥0.5 מ"מ/שעה
        r.drizzle = Math.round(100 * drizN / n);
      });
    }
  }
  let hasModels = false;
  if (md && md.hourly) {
    const h = md.hourly;
    h.time.forEach((t, i) => {
      const r = row(t);
      for (const m of MODELS) {
        const w = h[`wind_speed_10m_${m.id}`], g = h[`wind_gusts_10m_${m.id}`];
        if (w && w[i] != null) { r.models[m.name] = { wind: w[i], gust: g ? g[i] : null }; hasModels = true; }
      }
    });
  }
  if (mr && mr.hourly) {
    const h = mr.hourly;
    h.time.forEach((t, i) => Object.assign(row(t), {
      wave: h.wave_height[i], waveDir: h.wave_direction[i], wavePer: h.wave_period[i],
      ww: h.wind_wave_height[i], wwPer: h.wind_wave_period[i], wwDir: h.wind_wave_direction[i],
      sw: h.swell_wave_height[i], swDir: h.swell_wave_direction[i], swPer: h.swell_wave_period[i],
      sst: h.sea_surface_temperature?.[i]
    }));
  }
  const daily = {};
  if (fc && fc.daily) fc.daily.time.forEach((d, i) => daily[d] = { sunrise: fc.daily.sunrise[i], sunset: fc.daily.sunset[i] });

  const rows = [...byTime.values()].sort((a, b) => a.t < b.t ? -1 : 1);
  const waveAllNull = rows.every(r => r.wave == null);
  if (mr && waveAllNull) errors.push('מודל הגלים לא מחזיר נתונים לנקודה הזאת – הזז את נקודת הגלים מערבה בהגדרות');

  const grid = {
    wind: fc && fc.latitude != null ? [fc.latitude, fc.longitude] : null,
    wave: mr && mr.latitude != null ? [mr.latitude, mr.longitude] : null,
    models: md && md.latitude != null ? [md.latitude, md.longitude] : null
  };
  return {
    rows, daily, hasModels, hasEnsemble, errors, grid,
    current: { ...(fc?.current || {}), ...(mr?.current ? { wave: mr.current.wave_height, wavePer: mr.current.wave_period, waveDir: mr.current.wave_direction, sst: mr.current.sea_surface_temperature } : {}) },
    fetchedAt: Date.now()
  };
}

/* ===================== לוגיקת "יוצאים / לא יוצאים" ===================== */
function verdict(r) {
  const s = settings;
  const reasons = [];
  let level = 0; // 0 ירוק, 1 צהוב, 2 אדום
  const bump = (lvl, why) => { if (lvl > level) level = lvl; reasons.push(why); };

  if (r.code >= 95) bump(2, 'סופת רעמים');
  if (r.wind != null) { if (r.wind > s.maxWind * 1.25) bump(2, 'רוח מעל הסף'); else if (r.wind > s.maxWind) bump(1, 'רוח מעל הסף'); }
  if (r.gust != null) { if (r.gust > s.maxGust * 1.25) bump(2, 'משבים מעל הסף'); else if (r.gust > s.maxGust) bump(1, 'משבים מעל הסף'); }
  if (r.wave != null) {
    if (r.wave > s.maxWave * 1.3) bump(2, 'גלים מעל הסף');
    else if (r.wave > s.maxWave) bump(1, 'גלים מעל הסף');
    // ים קצר ותלול: גל משמעותי במחזור קצר
    if (r.wavePer != null && r.wave >= s.maxWave * 0.7 && r.wavePer < s.minPeriod) bump(1, 'ים קצר ותלול');
  }
  if (r.vis != null && r.vis < 2000) bump(1, 'ראות נמוכה');
  if (r.cape != null && r.cape > 1000 && (r.pop ?? 0) > 30) bump(1, 'סיכון לרעמים');
  return { level, reasons, cls: ['v-go', 'v-maybe', 'v-nogo'][level] };
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
function sailable(r) { return true; }

// החלטה אחת לכל האתר (לשוניות ימים, סיכום, פירוט, מפת שבוע)
function dayVerdict(rows) {
  if (!rows.length) return { lvl: null, wins: [] };
  const lv = rows.map(r => verdict(r).level), n = lv.length;
  const green = lv.filter(l => l === 0).length, red = lv.filter(l => l === 2).length;
  const wins = greenWindows(rows, 2);
  let lvl;
  if (red / n > 0.5) lvl = 2;
  else if (green / n >= 0.5 && wins.length) lvl = 0;
  else lvl = 1;
  return { lvl, wins };
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

/* ===================== רינדור ===================== */
function renderDays() {
  const today = nowLocal().slice(0, 10);
  const dates = [...new Set(data.rows.map(r => r.date))].filter(d => d >= today);
  if (!selectedDate || !dates.includes(selectedDate)) selectedDate = dates[0];
  $('day-tabs').innerHTML = dates.map(d => {
    const l = dayLabel(d, today);
    const ds = daySummary(d), lvl = ds.dayLevel;
    const glyph = ds.late ? '<span class="vglyph vn" aria-hidden="true">☾</span>' : vGlyph(lvl);
    return `<button class="day-tab ${d === selectedDate ? 'active' : ''}" data-date="${d}" aria-label="${l.name} – ${ds.late ? 'מאוחר מדי' : VERDICT[lvl].t}">
      <span class="d">${glyph} ${l.name}</span><span class="s">${l.sub}</span></button>`;
  }).join('');
  $('day-tabs').querySelectorAll('.day-tab').forEach(b => b.addEventListener('click', () => { selectedDate = b.dataset.date; renderAll(); }));
  // גלילה אופקית בשורת הימים בלבד – בלי להזיז את הדף
  const act = $('day-tabs').querySelector('.day-tab.active'), bar = $('day-tabs');
  if (act) {
    const a = act.getBoundingClientRect(), b = bar.getBoundingClientRect();
    if (a.left < b.left) bar.scrollLeft -= (b.left - a.left) + 8;
    else if (a.right > b.right) bar.scrollLeft += (a.right - b.right) + 8;
  }
  const i = dates.indexOf(selectedDate);
  $('prev-day').disabled = i <= 0;
  $('next-day').disabled = i >= dates.length - 1;
  $('prev-day').onclick = () => { if (i > 0) { selectedDate = dates[i - 1]; renderAll(); } };
  $('next-day').onclick = () => { if (i < dates.length - 1) { selectedDate = dates[i + 1]; renderAll(); } };
}

function renderSummary() {
  const s = daySummary(selectedDate);
  const today = nowLocal().slice(0, 10);
  const vCls = ['verdict-go', 'verdict-maybe', 'verdict-nogo'][s.dayLevel];
  const best = s.best ? `<bdi dir="ltr">${hm(s.best.start)}–${hm(s.best.end + 1)}</bdi>` : 'אין';
  const sun = s.sun ? `<bdi dir="ltr">${s.sun.sunrise.slice(11)}–${s.sun.sunset.slice(11)}</bdi>` : '–';
  const kt = v => `<bdi dir="ltr">${fmt(v)}</bdi>`;

  let nowCard = '';
  if (selectedDate === today && data.current && data.current.wind_speed_10m != null) {
    const c = data.current;
    nowCard = `<div class="card"><div class="k">עכשיו</div>
      <div class="v">${kt(c.wind_speed_10m)} <small>קשר</small> ${dirChip(c.wind_direction_10m)}</div>
      <div class="small muted">משבים ${kt(c.wind_gusts_10m)} · גל ${fmt(c.wave, 1)} מ׳</div></div>`;
  }
  const warns = [];
  if (s.thunder) warns.push('סופות רעמים');
  if (s.maxDrop >= 3) warns.push(`ירידת לחץ ${fmt(s.maxDrop, 1)} hPa ב-3 שעות`);

  $('summary').innerHTML = `
    <div class="card ${vCls} ${nowCard ? '' : 'wide'}"><div class="k">${selectedDate === today ? 'הערכה מעכשיו עד השקיעה' : 'הערכה לשעות האור'}</div>
      <div class="v">${s.late ? '🌙 היום נגמר' : vGlyph(s.dayLevel) + ' ' + VERDICT[s.dayLevel].t}</div><div class="small">${s.late ? 'ראו את מחר' : s.best ? 'שעות טובות: <b>' + best + '</b>' : 'אין שעות טובות'}</div></div>
    ${nowCard}
    <div class="card"><div class="k">רוח מקס׳ · משבים מקס׳</div>
      <div class="v">${kt(s.maxWind)} · ${kt(s.maxGust)} <small>קשר</small></div>
      <div class="small">${dirChip(meanDir(data.rows.filter(r => r.date === selectedDate && r.hour >= settings.hourFrom && r.hour <= settings.hourTo)))}</div></div>
    <div class="card"><div class="k">גל מקס׳ · מחזור</div>
      <div class="v">${fmt(s.maxWave, 1)} <small>מ׳</small> · ${fmt(s.avgPer, 0)} <small>שנ׳</small></div>
      <div class="small muted">סף: ${settings.maxWave} מ׳</div></div>
    <div class="card"><div class="k">זריחה–שקיעה</div>
      <div class="v" style="font-size:14px">${sun}</div>
      <div class="small ${warns.length ? 'warn' : 'muted'}">${warns.length ? '⚠ ' + warns.join(' · ') : `מים ${fmt(s.sst, 0)}°`}</div></div>`;
}

function renderChart() {
  const rows = data.rows.filter(r => r.date === selectedDate && r.hour >= settings.hourFrom && r.hour <= settings.hourTo);
  if (!rows.length) { $('chart').innerHTML = ''; return; }
  const W = 776, H = 96, padT = 8, padB = 14, padX = 26;
  const maxKt = Math.max(settings.maxGust + 4, ...rows.map(r => r.gust ?? 0)) ;
  const maxM = Math.max(settings.maxWave * 1.6, ...rows.map(r => r.wave ?? 0));
  const x = i => padX + (rows.length === 1 ? 0 : i * (W - 2 * padX) / (rows.length - 1));
  const yK = v => padT + (H - padT - padB) * (1 - v / maxKt);
  const yM = v => padT + (H - padT - padB) * (1 - v / maxM);
  const line = (k, yf) => rows.map((r, i) => r[k] == null ? null : `${x(i).toFixed(1)},${yf(r[k]).toFixed(1)}`).filter(Boolean).join(' ');
  const bw = Math.max(4, (W - 2 * padX) / rows.length * 0.55);
  const bars = rows.map((r, i) => r.wave == null ? '' :
    `<rect x="${(x(i) - bw / 2).toFixed(1)}" y="${yM(r.wave).toFixed(1)}" width="${bw.toFixed(1)}" height="${(H - padB - yM(r.wave)).toFixed(1)}" fill="${scaleColor(r.wave, WAVE_STOPS)}" opacity=".55" rx="2"/>`).join('');
  const thr = yK(settings.maxWind);
  const labels = rows.map((r, i) => (r.hour % 3 === 0) ? `<text x="${x(i)}" y="${H - 2}" fill="#8d98a8" font-size="10" text-anchor="middle">${r.hour}</text>` : '').join('');
  $('chart').innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      ${bars}
      <line x1="${padX}" x2="${W - padX}" y1="${thr}" y2="${thr}" stroke="#f1c40f" stroke-dasharray="3 4" stroke-width="1" opacity=".7"/>
      <polyline points="${line('gust', yK)}" fill="none" stroke="#f5a142" stroke-width="1.5" stroke-dasharray="4 3"/>
      <polyline points="${line('wind', yK)}" fill="none" stroke="#2fa8e0" stroke-width="2.5"/>
      <text x="2" y="${padT + 8}" fill="#2fa8e0" font-size="10">${Math.round(maxKt)}kt</text>
      <text x="${W - 2}" y="${padT + 8}" fill="#8adbaa" font-size="10" text-anchor="end">${maxM.toFixed(1)}m</text>
      ${labels}
    </svg>
    <div class="legend"><span><i style="background:#2fa8e0"></i>רוח</span><span><i style="background:#f5a142"></i>משבים</span>
      <span><i style="background:#8adbaa;height:8px"></i>גובה גל</span><span><i style="background:#f1c40f"></i>סף רוח</span></div>`;
}

function renderTable() {
  const rows = dayRows(selectedDate);
  const nowT = nowLocal();
  if (!rows.length) { $('table-wrap').innerHTML = '<div class="loading">אין נתונים ליום הזה</div>'; return; }

  const cells = (fn) => rows.map(r => {
    const night = isNight(r) ? ' night' : '';
    const now = r.t === nowT ? ' now-col' : '';
    const out = fn(r);
    if (typeof out === 'string') return `<td class="${night}${now}">${out}</td>`;
    return `<td class="${(out.cls || '') + night + now}" style="${out.style || ''}" title="${out.title || ''}">${out.html}</td>`;
  }).join('');
  const tr = (label, fn, cls = '') => `<tr class="${cls}">${cells(fn)}<td class="lbl">${label}</td></tr>`;
  const sep = `<tr class="sep"><td colspan="${rows.length + 1}"></td></tr>`;

  let html = `<table class="fc"><thead><tr>${rows.map(r => `<th class="${isNight(r) ? 'night' : ''}${r.t === nowT ? ' now-col' : ''}">${String(r.hour).padStart(2, '0')}</th>`).join('')}<th class="lbl">שעה</th></tr></thead><tbody>`;

  html += tr('מצב', r => {
    const v = verdict(r); return { cls: v.cls + ' vcell', html: VERDICT[v.level].g, title: v.reasons.join(', ') || 'תקין' };
  });
  html += tr('מזג אוויר', r => wxIcon(r.code, isNight(r)));
  html += sep;
  html += tr('רוח (קשר)', r => ({ cls: 'c', style: `background:${scaleColor(r.wind, WIND_STOPS)};color:${ink(scaleColor(r.wind, WIND_STOPS))}`, html: fmt(r.wind) }));
  html += tr('משבים (קשר)', r => ({ cls: 'c', style: `background:${scaleColor(r.gust, WIND_STOPS)};color:${ink(scaleColor(r.gust, WIND_STOPS))}`, html: fmt(r.gust) }));
  html += tr('כיוון רוח', r => `${arrow(r.dir)}<div class="sub">${compass(r.dir)}</div>`);
  if (settings.showModels && data.hasModels) {
    for (const m of MODELS) {
      html += tr(`<span class="model">${m.name} רוח/משב</span>`, r => {
        const v = r.models[m.name];
        return v ? `<span class="model">${fmt(v.wind)}<span class="sub">/${fmt(v.gust)}</span></span>` : '<span class="sub">–</span>';
      });
    }
  }
  html += sep;
  html += tr('גובה גל (מ׳)', r => ({ cls: 'c', style: `background:${scaleColor(r.wave, WAVE_STOPS)};color:${ink(scaleColor(r.wave, WAVE_STOPS))}`, html: fmt(r.wave, 1) }));
  html += tr('מחזור (שנ׳)', r => ({ html: fmt(r.wavePer, 1), cls: (r.wavePer != null && r.wavePer < settings.minPeriod && r.wave >= settings.maxWave * 0.7) ? 'warn' : '' }));
  html += tr('כיוון גל', r => `${arrow(r.waveDir)}<div class="sub">${compass(r.waveDir)}</div>`);
  html += tr('גלי רוח m·s', r => r.ww == null ? '–' : `${fmt(r.ww, 1)}<div class="sub">${fmt(r.wwPer, 1)}s</div>`);
  html += tr('סוֹול m·s', r => r.sw == null ? '–' : `${fmt(r.sw, 1)} ${arrow(r.swDir)}<div class="sub">${fmt(r.swPer, 1)}s</div>`);
  html += sep;
  html += tr('טמפ\' °C', r => fmt(r.temp));
  html += tr('<span title="סיכוי לגשם של 0.5 מ&quot;מ ומעלה בשעה, לפי 122 הרצות אנסמבל">גשם % · mm</span>', r => (r.pop ?? 0) < 10 && (r.rain ?? 0) < 0.1 ? '<span class="sub">–</span>' : `${fmt(r.pop)}<div class="sub">${fmt(r.rain, 1)}</div>`);
  if (data.hasEnsemble) html += tr('<span title="סיכוי לטיפות/טפטוף (0.1 מ&quot;מ ומעלה)">טפטוף %</span>', r => (r.drizzle ?? 0) < 10 ? '<span class="sub">–</span>' : `<span class="sub" style="color:var(--rain)">${fmt(r.drizzle)}</span>`);
  html += tr('לחץ hPa', r => `<span class="sub" style="color:var(--fg)">${fmt(r.pres)}</span>`);
  html += tr('ראות km', r => r.vis == null ? '–' : (r.vis >= 20000 ? '<span class="sub">20+</span>' : `<span class="${r.vis < 4000 ? 'warn' : ''}">${fmt(r.vis / 1000, 1)}</span>`));
  html += tr('מים °C', r => `<span class="sub" style="color:var(--fg)">${fmt(r.sst, 1)}</span>`);
  html += '</tbody></table>';
  $('table-wrap').innerHTML = html;
}

function renderAll() {
  if (!data) return;
  $('intro').innerHTML = `תחזית ים למרינה הרצליה: האם מתאים לצאת להפליג, ומה תפגוש בים.
    <span class="legend-v">${vGlyph(0)} מתאים · ${vGlyph(1)} בזהירות · ${vGlyph(2)} לא מומלץ</span>
    <span class="muted">מתאים כשהרוח עד ${settings.maxWind} קשר, המשבים עד ${settings.maxGust} והגלים עד ${settings.maxWave} מ׳. אפשר לשנות בהגדרות ⚙️</span>`;
  $('loading').classList.add('hidden');
  renderDays();
  renderHero();
  renderTimeline();
  renderWeek();
  renderSummary();
  renderChart();
  renderPlan();
  renderTable();
  const t = new Date(data.fetchedAt);
  const age = Date.now() - data.fetchedAt;
  $('updated').textContent = `עודכן ${t.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}` +
    (age > 12 * 3600e3 ? ` (${t.toLocaleDateString('he-IL')})` : '') + (age > 3 * 3600e3 ? ' · לא עדכני' : '');
  $('updated').classList.toggle('stale', age > 3 * 3600e3);
}

function showBanner(msg, isError) {
  const b = $('banner');
  if (!msg) { b.classList.add('hidden'); return; }
  b.textContent = msg;
  b.classList.toggle('error', !!isError);
  b.classList.remove('hidden');
}

/* ===================== סיכום סקיפר ===================== */
const HEB_DIR8 = ['צפונית', 'צפון-מזרחית', 'מזרחית', 'דרום-מזרחית', 'דרומית', 'דרום-מערבית', 'מערבית', 'צפון-מערבית'];
const dir8 = deg => deg == null ? '' : HEB_DIR8[Math.round(deg / 45) % 8];
const dirChip = (deg, big) => deg == null ? '' :
  `<span class="dirchip${big ? ' big' : ''}" title="הרוח נושבת מ${dir8(deg)} (${Math.round(deg)}°)"><span class="arrow" style="transform:rotate(${Math.round(deg)}deg)">↓</span> ${dir8(deg)} <small>${compass(deg)}</small></span>`;
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
const VCOL = ['var(--go)', 'var(--maybe)', 'var(--nogo)'];
const VTXT = ['inherit', 'var(--maybe-ink)', 'var(--nogo-ink)']; // צבעי טקסט קריאים
const pad2 = h => String(h).padStart(2, '0');
const range = (a, b, d = 0) => (a == null) ? '–' : (Math.abs(a - b) < (d ? 0.15 : 1.5) ? fmt(b, d) : `\u2066${fmt(a, d)}\u2060–\u2060${fmt(b, d)}\u2069`);

function meanDir(rows) {
  let x = 0, y = 0;
  rows.forEach(r => { if (r.dir != null && r.wind != null) { x += Math.sin(r.dir * Math.PI / 180) * (r.wind + 0.1); y += Math.cos(r.dir * Math.PI / 180) * (r.wind + 0.1); } });
  return (x === 0 && y === 0) ? null : (Math.atan2(x, y) * 180 / Math.PI + 360) % 360;
}
function beaufortText(kt) {
  if (kt < 1) return 'שקט מוחלט';
  if (kt < 4) return 'משב קל מאוד';
  if (kt < 7) return 'רוח קלה';
  if (kt < 11) return 'רוח עדינה';
  if (kt < 17) return 'רוח מתונה';
  if (kt < 22) return 'רוח רעננה';
  if (kt < 28) return 'רוח חזקה';
  if (kt < 34) return 'רוח חזקה מאוד';
  return 'סערה';
}
function seaText(h) { // סולם דאגלס
  if (h < 0.1) return 'ים חלק כמראה';
  if (h < 0.5) return 'ים רגוע';
  if (h < 1.25) return 'ים נמוך עד בינוני';
  if (h < 2.5) return 'ים בינוני–גבוה';
  if (h < 4) return 'ים גבוה';
  return 'ים גבוה מאוד';
}
function comfortText(h, T) {
  if (h == null) return '';
  if (h < 0.4) return 'נוח מאוד לאורחים';
  if (T != null && T < 5 && h >= 0.7) return 'ים קצר ותלול – טלטולים, סיכוי לבחילה';
  if (T != null && T >= 7 && h < 1.5) return 'סוֹול ארוך ורך – תנועה מתגלגלת';
  if (h < 1) return 'נוח';
  if (h < 1.6) return 'מורגש – עלול לגרום לבחילה לרגישים';
  return 'קשה – לא נוח לאורחים';
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
function skyIcon(rows) {
  if (rows.some(r => (r.pop ?? 0) >= 30 || (r.rain ?? 0) >= RAIN_MM)) return '🌧️';
  if (Math.max(0, ...rows.map(r => r.drizzle ?? 0)) >= 30) return '🌦️';
  const cloud = rows.reduce((a, r) => a + (r.cloud ?? 0), 0) / Math.max(1, rows.length);
  return cloud < 25 ? '☀️' : cloud < 70 ? '⛅' : '☁️';
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
function greenWindows(rows, minLen = 1) {
  const out = []; let cur = null;
  for (const r of rows) {
    if (verdict(r).level === 0) { cur ? cur.end = r.hour : (cur = { start: r.hour, end: r.hour }); }
    else if (cur) { out.push(cur); cur = null; }
  }
  if (cur) out.push(cur);
  return out.filter(w => w.end - w.start >= minLen - 1).sort((a, b) => (b.end - b.start) - (a.end - a.start));
}

function activeRows(date) {
  const nowT = nowLocal();
  return data.rows.filter(r => r.date === date && r.hour >= settings.hourFrom && r.hour <= settings.hourTo && sailable(r) && r.t >= nowT.slice(0, 13));
}

function renderHero() {
  const today = nowLocal().slice(0, 10);
  const rows = activeRows(selectedDate);
  if (rows.length < 2) {
    const dates = [...new Set(data.rows.map(r => r.date))];
    const next = dates[dates.indexOf(selectedDate) + 1];
    $('hero').innerHTML = `<div class="hero-badge late" style="--c:var(--muted)"><div class="vt">🌙 היום נגמר</div>
      <div class="vs">טווח השעות שלך מסתיים ב-<bdi dir="ltr">${hm(settings.hourTo + 1)}</bdi>. אפשר להאריך אותו בהגדרות ⚙️</div>${next ? '<button id="go-next" class="primary">לתחזית של מחר ←</button>' : ''}</div>`;
    if (next) $('go-next').addEventListener('click', () => { selectedDate = next; renderAll(); window.scrollTo(0, 0); });
    return;
  }
  const dv = dayVerdict(rows);
  const lvl = dv.lvl;
  const wins = dv.wins.slice(0, 2).sort((a, b) => a.start - b.start);
  const ssH = sunH(selectedDate, 'sunset');
  const winTxt = wins.length ? wins.map(w => `<bdi dir="ltr">${hm(w.start)}–${hm(w.end + 1)}</bdi>`).join(' , ') +
    (wins.some(w => w.end + 1 > ssH + 0.25) ? ' <span class="night-note">☾ כולל אחרי השקיעה</span>' : '') : 'אין שעות טובות';
  // כשיוצאים – המספרים מתארים את השעות הטובות עצמן
  const statRows = lvl === 0 && wins.length ? rows.filter(r => wins.some(w => r.hour >= w.start && r.hour <= w.end)) : rows;
  const vals = k => statRows.map(r => r[k]).filter(v => v != null);
  const mn = k => vals(k).length ? Math.min(...vals(k)) : null, mx = k => vals(k).length ? Math.max(...vals(k)) : null;
  const md = meanDir(rows);
  const wMax = mx('wind'), gMax = mx('gust');
  const sail = sailLine(wMax, gMax, lvl, mx('wave'));
  const per = vals('wavePer').reduce((a, b) => a + b, 0) / Math.max(1, vals('wavePer').length);
  const wvMax = mx('wave');
  const rain = rainText(rows);
  const sun = data.daily[selectedDate];
  const reasons = lvl > 0 ? reasonsByHour(rows).slice(0, 2) : [];

  const warns = [];
  if (rows.some(r => r.code >= 95)) warns.push('סופות רעמים צפויות');
  else if (rows.some(r => (r.cape ?? 0) > 1000 && (r.pop ?? 0) > 30)) warns.push('סיכון לרעמים');
  if (gMax != null && wMax != null && gMax - wMax >= 10) warns.push('רוח משבית – להכין ריף מראש');
  if (daySummary(selectedDate).maxDrop >= 3) warns.push('ירידת לחץ חדה – מערכת מתקרבת');
  if (rows.some(r => r.vis != null && r.vis < 4000)) warns.push('ראות מוגבלת');
  if (wins.some(w => w.end + 1 > ssH + 0.25)) warns.push(`השקיעה ב-<bdi dir="ltr">${data.daily[selectedDate]?.sunset.slice(11) || ''}</bdi> – אחריה צריך אורות ניווט`);
  const first = rows.slice(0, Math.ceil(rows.length / 2)), last = rows.slice(Math.floor(rows.length / 2));
  const avgW = a => a.reduce((s, r) => s + (r.wind ?? 0), 0) / Math.max(1, a.length);
  let trend = '';
  if (rows.length >= 4) {
    const dW = avgW(last) - avgW(first);
    if (dW >= 4) trend = 'הרוח מתחזקת בהמשך היום';
    else if (dW <= -4) trend = 'הרוח נחלשת בהמשך היום';
  }
  const shift = dirShift(rows);
  const isToday = selectedDate === today;

  $('hero').innerHTML = `
    <div class="hero-badge" style="--c:${VCOL[lvl]}">
      <div class="q">האם מתאים להפליג ${whenWords(selectedDate)}?</div>
      <div class="vt">${vGlyph(lvl, true)} ${VERDICT[lvl].long}</div>
      <div class="why-plain">${lvl === 0 ? `${beaufortText(wMax ?? 0)} ו${seaText(wvMax ?? 0)}` : 'כי צפויים: ' + plainReasons(rows).slice(0, 2).join(' ו')}</div>
      <div class="vs">${wins.length ? `${isToday ? 'השעות המתאימות שנותרו היום' : 'השעות המתאימות'}: <b>${winTxt}</b>` : '<b>אין שעות מתאימות ביום הזה</b>'}</div>
    </div>
    <div class="hero-lines">
      <div class="line"><span class="ic">${ICON.wind}</span><span>${dirChip(md)} <b>${range(mn('wind'), wMax)} קשר</b>, משבים עד <b>${fmt(gMax)}</b></span></div>
      <div class="line"><span class="ic">${ICON.wave}</span><span><b>גלים ${range(mn('wave'), wvMax, 1)} מ׳</b> · ${seaText(wvMax ?? 0)} · ${comfortText(wvMax, per)}</span></div>
      <div class="line"><span class="ic">${skyIcon(rows)}</span><span>${rain.t} · ${range(mn('temp'), mx('temp'))}°${sun ? ` · שקיעה <bdi dir="ltr">${sun.sunset.slice(11)}</bdi>` : ''}</span></div>
      ${warns.length ? `<div class="line warn"><span class="ic">${ICON.warn}</span><span>${warns.join(' · ')}</span></div>` : ''}
      <details class="skipper" id="skipper-details">
        <summary>פרטים לסקיפר</summary>
        <div class="line"><span class="ic">⛵</span><span style="color:${VTXT[sail.lvl]}"><b>מפרשים:</b> ${sail.t}</span></div>
        <div class="line"><span class="ic">${ICON.wind}</span><span>${beaufortText(wMax ?? 0)}${trend ? ' · ' + trend : ''}${shift ? ' · <b class="shift">↻ ' + shift + '</b>' : ''}</span></div>
        <div class="line"><span class="ic">${ICON.wave}</span><span>מחזור גלים ממוצע ${fmt(per, 0)} שניות · מים ${fmt(mx('sst'), 0)}°</span></div>
        <div class="line"><span class="ic">🧭</span><span>${coastNote(md)}</span></div>
      </details>
    </div>`;
  const det = $('skipper-details');
  try { if (localStorage.getItem('skipperOpen') === '1') det.open = true; } catch (_) {}
  det.addEventListener('toggle', () => { try { localStorage.setItem('skipperOpen', det.open ? '1' : '0'); } catch (_) {} });
}

function svgArrow(cx, cy, deg, size, color) {
  const s = size;
  return `<g transform="translate(${cx.toFixed(1)},${cy.toFixed(1)}) rotate(${Math.round(deg)})"><path d="M0,${-s} L0,${s} M${-s * 0.55},${s * 0.35} L0,${s} L${s * 0.55},${s * 0.35}" style="stroke:${color}" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g>`;
}

// רוחב אזור התצוגה, גם כשהמסך מוסתר כרגע (אז clientWidth הוא 0)
function boxWidth(id) {
  const w = $(id) ? $(id).clientWidth : 0;
  return w || Math.min(776, (document.documentElement.clientWidth || 800) - 24);
}

function renderTimeline(date = selectedDate, from = settings.hourFrom, to = settings.hourTo, target = 'timeline') {
  let rows = data.rows.filter(r => r.date === date && r.hour >= from && r.hour <= to);
  if (!rows.length) { $(target).innerHTML = ''; return; }
  // בטלפון: הגרף מתאים את עצמו לרוחב המסך, ואם צפוף מדי – מציג כל שעתיים
  const box = boxWidth(target);
  const narrow = box < 640;
  if (narrow && rows.length > 9) {
    // כל שעתיים – אבל תמיד כולל השעה הנוכחית
    const ni = rows.findIndex(r => r.t.slice(0, 13) === nowLocal().slice(0, 13));
    const off = ni >= 0 ? ni % 2 : 0;
    rows = rows.filter((r, i) => i % 2 === off);
  }
  const W = narrow ? Math.max(320, box - 28) : 776, LBL = narrow ? 54 : 78, n = rows.length, cw = (W - LBL) / n;
  const x = i => i * cw;
  const cx = i => x(i) + cw / 2;
  const hasRain = rows.some(r => (r.pop ?? 0) >= 10);
  const L = { hour: 0, verdict: 17, wx: 38, wind: 70, wnum: 176, dir: 192, wave: 220 };
  const windH = 92, waveH = 58, rainH = 24;
  L.rain = L.wave + waveH + 10;
  L.end = hasRain ? L.rain + rainH + 4 : L.wave + waveH + 6;
  const windMax = Math.max(settings.maxWind * 1.2, ...rows.map(r => r.gust ?? 0)) + 3;
  const waveMax = Math.max(settings.maxWave * 1.4, ...rows.map(r => r.wave ?? 0)) * 1.12;
  const nowT = nowLocal();
  let g = '';
  // רקעים וקווי סף קודם – הטקסט מצויר מעליהם
  rows.forEach((r, i) => {
    if (isNight(r)) g += `<rect x="${x(i)}" y="0" width="${cw}" height="${L.end}" style="fill:var(--night)"/>`;
  });
  const ty = L.wind + windH - windH * settings.maxWind / windMax;
  g += `<line x1="0" x2="${W - LBL}" y1="${ty}" y2="${ty}" style="stroke:var(--thr)" stroke-dasharray="4 4"/>`;
  const waveTy = L.wave + waveH - waveH * settings.maxWave / waveMax;
  g += `<line x1="0" x2="${W - LBL}" y1="${waveTy}" y2="${waveTy}" style="stroke:var(--thr)" stroke-dasharray="4 4"/>`;

  rows.forEach((r, i) => {
    if (r.t.slice(0, 13) === nowT.slice(0, 13)) g += `<rect x="${x(i) + 1}" y="0" width="${cw - 2}" height="${L.end}" style="fill:none;stroke:var(--accent)" stroke-width="2" rx="4"/>`;
    g += `<text x="${cx(i)}" y="12" class="t-h">${pad2(r.hour)}</text>`;
    // מצב – מיד מתחת לשעה
    const v = verdict(r), night = isNight(r);
    g += `<g><title>${(night ? 'לילה · ' : '') + (v.reasons.join(', ') || 'תקין')}</title><rect x="${x(i) + 1.5}" y="${L.verdict}" width="${cw - 3}" height="19" rx="4" style="fill:${VCOL[v.level]}" opacity="${night ? 0.7 : 1}"/>
      <text x="${cx(i)}" y="${L.verdict + 14.5}" class="t-vg" style="fill:${v.level === 1 ? '#1a1300' : '#fff'}">${VERDICT[v.level].g}</text></g>`;
    g += `<text x="${cx(i)}" y="${L.wx + 20}" class="t-wx">${wxIcon(r.code, isNight(r))}</text>`;
    // רוח: עמודה = רוח, קו כתום = משב
    if (r.wind != null) {
      const h = Math.max(3, windH * r.wind / windMax), gh = windH * (r.gust ?? r.wind) / windMax;
      const base = L.wind + windH, bw = Math.min(30, cw * 0.62);
      const col = scaleColor(r.wind, WIND_STOPS);
      g += `<rect x="${cx(i) - bw / 2}" y="${base - h}" width="${bw}" height="${h}" fill="${col}" rx="3"/>`;
      if (r.gust != null && r.gust > r.wind) {
        g += `<line x1="${cx(i)}" x2="${cx(i)}" y1="${base - h}" y2="${base - gh}" style="stroke:var(--gust)" stroke-width="1.5" stroke-dasharray="2 2"/>`;
        g += `<line x1="${cx(i) - bw / 2}" x2="${cx(i) + bw / 2}" y1="${base - gh}" y2="${base - gh}" style="stroke:var(--gust)" stroke-width="3" stroke-linecap="round"/>`;
        g += `<text x="${cx(i)}" y="${base - gh - 5}" class="t-g">${fmt(r.gust)}</text>`;
      }
      g += `<text x="${cx(i)}" y="${L.wnum}" class="t-v">${fmt(r.wind)}</text>`;
    }
    if (r.dir != null) g += svgArrow(cx(i), L.dir + 12, r.dir, 9, 'var(--fg)');
    // גלים
    if (r.wave != null) {
      const h = Math.max(3, waveH * r.wave / waveMax), base = L.wave + waveH, bw = Math.min(30, cw * 0.62);
      const col = scaleColor(r.wave, WAVE_STOPS);
      g += `<rect x="${cx(i) - bw / 2}" y="${base - h}" width="${bw}" height="${h}" fill="${col}" rx="3"/>`;
      g += `<text x="${cx(i)}" y="${base - h - 4}" class="t-w">${fmt(r.wave, 1)}</text>`;
      if (h >= 16) g += `<text x="${cx(i)}" y="${base - 4}" class="t-p" style="fill:${ink(col)}">${fmt(r.wavePer)}ש</text>`;
    }
    // גשם
    const pop = r.pop ?? 0;
    if (hasRain && pop >= 10) {
      const h = Math.max(4, rainH * pop / 100);
      g += `<rect x="${cx(i) - cw * 0.3}" y="${L.rain + rainH - h}" width="${cw * 0.6}" height="${h}" style="fill:var(--rain)" opacity="${0.45 + pop / 200}" rx="2"/>`;
      g += `<text x="${cx(i)}" y="${L.rain + rainH - h - 3}" class="t-r">${fmt(pop)}%</text>`;
    }
  });
  const lab = (y, t, s) => `<text x="${W - 4}" y="${y}" class="t-l">${t}</text>${s ? `<text x="${W - 4}" y="${y + 13}" class="t-ls">${s}</text>` : ''}`;
  g += lab(L.verdict + 13, 'מצב') + lab(L.wind + 34, 'רוח', narrow ? 'קשר' : 'קשר · משב בכתום') + lab(L.wnum, narrow ? '' : '', '') +
       lab(L.dir + 10, 'כיוון', narrow ? '' : 'לאן נושבת') + lab(L.wave + 26, 'גלים', narrow ? 'מ׳ · ש=שנ׳' : 'מ׳ · מחזור בשניות') +
       (hasRain ? lab(L.rain + 16, 'גשם') : '');
  $(target).innerHTML = `<svg viewBox="0 0 ${W} ${L.end}" width="${W}" height="${L.end}" role="img" aria-label="תחזית שעתית">${g}</svg>`;
}

function renderWeek() {
  const today = nowLocal().slice(0, 10);
  const dates = [...new Set(data.rows.map(r => r.date))].filter(d => d >= today);
  const narrow = boxWidth('week') < 640;
  const step = narrow ? 2 : 1;
  const hours = []; for (let h = settings.hourFrom; h <= settings.hourTo; h += step) hours.push(h);
  const nowT = nowLocal();
  let html = `<table class="wk"><thead><tr>${hours.map(h => `<th>${pad2(h)}</th>`).join('')}<th class="wl">יום</th>${narrow ? '' : '<th class="ws">מקס׳ רוח · גל</th>'}</tr></thead><tbody>`;
  for (const d of dates) {
    const byH = new Map(data.rows.filter(r => r.date === d).map(r => [r.hour, r]));
    const l = dayLabel(d, today);
    const s = daySummary(d);
    html += `<tr data-date="${d}" class="${d === selectedDate ? 'sel' : ''}">`;
    html += hours.map(h => {
      const r = byH.get(h);
      if (!r || r.wind == null) return '<td></td>';
      const v = verdict(r);
      const past = r.t.slice(0, 13) < nowT.slice(0, 13) ? ' past' : '';
      const inTrip = trips.some(t => t.date === d && h >= t.from && h < t.to) ? ' trip-cell' : '';
      const cls = 'c' + v.level + (isNight(r) ? ' night' : '');
      return `<td class="${cls}${past}${inTrip}" title="${pad2(h)}:00 · רוח ${fmt(r.wind)} משבים ${fmt(r.gust)} קשר ${dir8(r.dir)} · גל ${fmt(r.wave, 1)} מ׳${(r.pop ?? 0) >= 30 ? ' · גשם ' + r.pop + '%' : ''}${v.reasons.length ? ' · ' + v.reasons.join(', ') : ''}">
        ${v.level ? `<span class="vg">${VERDICT[v.level].g}</span>` : ''}${isNight(r) ? '<span class="mn">☾</span>' : ''}<span class="wa">${arrow(r.dir)}</span><span class="wn">${fmt(r.wind)}</span>${(r.pop ?? 0) >= 40 ? '<span class="rd">💧</span>' : ''}</td>`;
    }).join('');
    html += `<td class="wl"><b>${l.name}</b><span class="muted small">${l.sub.replace(/^\S+ /, '')}</span></td>`;
    if (!narrow) html += `<td class="ws">${fmt(s.maxWind)}·${fmt(s.maxGust)} קשר · ${fmt(s.maxWave, 1)} מ׳</td>`;
    html += '</tr>';
  }
  html += '</tbody></table>';
  $('week').innerHTML = html;
  $('week').querySelectorAll('tr[data-date]').forEach(tr => tr.addEventListener('click', () => {
    selectedDate = tr.dataset.date; renderAll(); window.scrollTo({ top: 0, behavior: 'smooth' });
  }));
}

/* ===================== תכנון הפלגה ===================== */
let plan = { date: null, from: 9, to: 14, course: '' };
let trips = [];
const COURSES = [
  { v: '', t: 'סיבוב חופשי' },
  { v: '15', t: 'צפונה (נתניה)' },
  { v: '195', t: 'דרומה (ת"א / יפו)' },
  { v: '285', t: 'מערבה – לים הפתוח' }
];
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

function planRows(p) {
  return data.rows.filter(r => r.date === p.date && r.hour >= p.from && r.hour < p.to);
}
function planVerdict(rows) {
  const lv = rows.map(r => verdict(r).level);
  const red = lv.filter(l => l === 2).length, yel = lv.filter(l => l === 1).length;
  if (red / Math.max(1, lv.length) > 0.3) return 2;
  if (red || yel) return 1;
  return 0;
}
function modelConfidence(rows) {
  const spreads = rows.map(r => { const w = Object.values(r.models || {}).map(m => m.wind).filter(v => v != null); return w.length >= 2 ? Math.max(...w) - Math.min(...w) : null; }).filter(v => v != null);
  if (!spreads.length) return null;
  const avg = spreads.reduce((a, b) => a + b, 0) / spreads.length;
  if (avg < 4) return { t: 'גבוה', c: 'var(--go)', d: `המודלים מסכימים (פער ממוצע ${fmt(avg, 1)}kt)` };
  if (avg < 7) return { t: 'בינוני', c: 'var(--warn)', d: `פער בין המודלים ${fmt(avg, 1)}kt – בדוק שוב לפני היציאה` };
  return { t: 'נמוך', c: 'var(--nogo)', d: `המודלים חלוקים (${fmt(avg, 1)}kt) – התחזית לא ודאית` };
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
      const rows = data.rows.filter(r => r.date === d && r.hour >= h && r.hour < h + dur);
      if (rows.length < dur || rows[0].t < nowT.slice(0, 13)) continue;
      if (rows.some(r => isNight(r) || verdict(r).level > 0)) continue;
      const dist = Math.abs((new Date(d + 'T' + pad2(h) + ':00') - new Date(p.date + 'T' + pad2(p.from) + ':00')) / 3600e3);
      out.push({ date: d, from: h, to: h + dur, dist });
    }
  }
  out.sort((a, b) => a.dist - b.dist);
  const res = [];
  for (const o of out) { if (!res.some(r => r.date === o.date)) res.push(o); if (res.length === 3) break; }
  return res;
}
function checklist(rows, s) {
  const items = ['🦺 חגורות הצלה ותדריך בטיחות לאורחים', '📻 VHF פתוח על ערוץ 16'];
  if (s.gMax >= 22 || s.wMax >= 16) items.push('🪢 לקשור ריף כבר בנמל – קל יותר מאשר בים');
  if (s.wvMax >= 1 || (s.wvMax >= 0.7 && s.per < 5)) items.push('💊 כדורים נגד בחילה לאורחים, לקבע ציוד בקבינה');
  if (s.wet) items.push('🧥 מעילי גשם / ביגוד סערה');
  if (s.tMax >= 26) items.push('🧴 קרם הגנה, כובעים ומים');
  if (s.tMin != null && s.tMin < 18) items.push('🧣 ביגוד חם – קר יותר בים');
  if (s.afterSunset) items.push('🔦 אורות ניווט ופנס – החזרה אחרי השקיעה');
  if (s.thunder) items.push('⛈️ לעקוב אחרי מכ"ם ברקים ולהיות קרוב לנמל');
  if (s.offshore) items.push('↩️ רוח יבשה: הדרך חזרה למרינה תהיה נגד הרוח – תכנן זמן');
  return items;
}

function compassSvg(rows, course) {
  const S = 170, C = S / 2, R = 66;
  let g = `<circle cx="${C}" cy="${C}" r="${R}" style="fill:var(--panel-2);stroke:var(--line)"/>`;
  // יבשה – מזרחית לקו החוף (החוף נמתח בערך 20°↔200°)
  const coast = 20 * Math.PI / 180;
  const p1 = [C + Math.sin(coast) * R, C - Math.cos(coast) * R], p2 = [C - Math.sin(coast) * R, C + Math.cos(coast) * R];
  g += `<path d="M${p1[0]},${p1[1]} A${R},${R} 0 0 1 ${p2[0]},${p2[1]} Z" style="fill:color-mix(in srgb, #c9a46a 30%, var(--panel-2))"/>`;
  g += `<text x="${C + 40}" y="${C + 4}" font-size="11" style="fill:var(--muted)" text-anchor="middle">יבשה</text>`;
  g += `<text x="${C - 38}" y="${C + 4}" font-size="11" style="fill:var(--rain)" text-anchor="middle">ים</text>`;
  g += `<circle cx="${C + 4}" cy="${C}" r="4.5" style="fill:var(--trip)"/>`;
  [['N', 0], ['E', 90], ['S', 180], ['W', 270]].forEach(([t, d]) => {
    const a = d * Math.PI / 180;
    g += `<text x="${C + Math.sin(a) * (R + 10)}" y="${C - Math.cos(a) * (R + 10) + 4}" font-size="12" font-weight="800" style="fill:var(--fg)" text-anchor="middle">${t}</text>`;
  });
  // חצי רוח לכל שעה – מגיעים מהכיוון שממנו נושבת הרוח
  const maxW = Math.max(12, ...rows.map(r => r.wind ?? 0));
  rows.forEach(r => {
    if (r.dir == null) return;
    const a = r.dir * Math.PI / 180, len = 14 + 34 * (r.wind ?? 0) / maxW;
    const x1 = C + Math.sin(a) * R, y1 = C - Math.cos(a) * R;
    const x2 = C + Math.sin(a) * (R - len), y2 = C - Math.cos(a) * (R - len);
    g += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${scaleColor(r.wind, WIND_STOPS)}" stroke-width="3" stroke-linecap="round" marker-end="url(#ah)"/>`;
  });
  // כיוון גלים ממוצע
  const wd = rows.map(r => r.waveDir).filter(v => v != null);
  if (wd.length) {
    let x = 0, y = 0; wd.forEach(d => { x += Math.sin(d * Math.PI / 180); y += Math.cos(d * Math.PI / 180); });
    const a = Math.atan2(x, y);
    g += `<path d="M${C + Math.sin(a) * (R + 2)},${C - Math.cos(a) * (R + 2)} L${C + Math.sin(a) * (R - 20)},${C - Math.cos(a) * (R - 20)}" style="stroke:var(--rain)" stroke-width="2.2" stroke-dasharray="3 2" marker-end="url(#aw)"/>`;
  }
  if (course !== '') {
    const a = (+course) * Math.PI / 180;
    g += `<line x1="${C}" y1="${C}" x2="${C + Math.sin(a) * (R - 6)}" y2="${C - Math.cos(a) * (R - 6)}" style="stroke:var(--trip)" stroke-width="2.8" marker-end="url(#ac)"/>`;
  }
  return `<svg viewBox="0 0 ${S} ${S}" width="${S}" height="${S}">
    <defs>
      <marker id="ah" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="4" markerHeight="4" orient="auto"><path d="M0,0 L10,5 L0,10 Z" style="fill:var(--fg)"/></marker>
      <marker id="aw" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L10,5 L0,10 Z" style="fill:var(--rain)"/></marker>
      <marker id="ac" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L10,5 L0,10 Z" style="fill:var(--trip)"/></marker>
    </defs>${g}</svg>`;
}

function planText(p, rows, s, lvl) {
  const today = nowLocal().slice(0, 10);
  const l = dayLabel(p.date, today);
  const course = COURSES.find(c => c.v === p.course)?.t || '';
  return [
    `⛵ הפלגה ממרינה הרצליה – ${l.name} ${l.sub.replace(/^\S+ /, '')}, \u2066${hm(p.from)}–${hm(p.to)}\u2069${p.course ? ' · ' + course : ''}`,
    `${['✅ מתאים להפלגה', '⚠️ אפשר, אבל בזהירות', '⛔ לא מומלץ להפליג'][lvl]}`,
    `🌬️ רוח ${dir8(s.md)} ${range(s.wMin, s.wMax)} קשר, משבים עד ${fmt(s.gMax)}`,
    `🌊 גלים ${range(s.wvMin, s.wvMax, 1)} מ', מחזור ${fmt(s.per)} שנ' – ${seaText(s.wvMax ?? 0)}`,
    `${s.wet ? '🌧️' : '☀️'} ${s.rainT} · ${range(s.tMin, s.tMax)}°C · מים ${fmt(s.sst)}°C`,
    `⛵ ${sailAdvice(s.wMax, s.gMax).t}`,
    `(תחזית Open-Meteo · עודכן ${new Date(data.fetchedAt).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })})`
  ].join('\n');
}

function fillPlanForm() {
  const today = nowLocal().slice(0, 10);
  const dates = [...new Set(data.rows.map(r => r.date))].filter(d => d >= today);
  if (!plan.date || !dates.includes(plan.date)) plan.date = selectedDate && dates.includes(selectedDate) ? selectedDate : dates[0];
  $('p-date').innerHTML = dates.map(d => { const l = dayLabel(d, today); return `<option value="${d}">${l.name} ${l.sub.replace(/^\S+ /, '')}</option>`; }).join('');
  $('p-from').innerHTML = [...Array(24).keys()].map(h => `<option value="${h}">${hm(h)}</option>`).join('');
  $('p-to').innerHTML = [...Array(24).keys()].map(h => h + 1).map(h => `<option value="${h}">${h === 24 ? '24:00' : hm(h)}</option>`).join('');
  $('p-course').innerHTML = COURSES.map(c => `<option value="${c.v}">${c.t}</option>`).join('');
  $('p-date').value = plan.date; $('p-from').value = plan.from; $('p-to').value = plan.to; $('p-course').value = plan.course;
}

function renderTrips() {
  const today = nowLocal().slice(0, 10);
  if (!trips.length) { $('p-saved').innerHTML = '<span class="muted small">אין הפלגות שמורות – בחר זמן ולחץ "שמור" כדי לעקוב אחריה.</span>'; return; }
  $('p-saved').innerHTML = '<span class="muted small">ההפלגות שלי:</span>' + trips.map((t, i) => {
    const rows = planRows(t);
    const lvl = rows.length ? planVerdict(rows) : null;
    const l = dayLabel(t.date, today);
    const active = t.date === plan.date && t.from === plan.from && t.to === plan.to ? ' active' : '';
    return `<span class="trip${active}" data-i="${i}"><span class="dot" style="background:${lvl == null ? 'var(--muted)' : VCOL[lvl]}"></span>
      ${l.name} <bdi dir="ltr">${hm(t.from)}–${hm(t.to)}</bdi><button class="x" data-del="${i}" title="מחק">✕</button></span>`;
  }).join('');
  $('p-saved').querySelectorAll('.trip').forEach(el => el.addEventListener('click', e => {
    if (e.target.dataset.del != null) return;
    plan = { ...trips[+el.dataset.i] }; fillPlanForm(); renderPlan();
  }));
  $('p-saved').querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async e => {
    e.stopPropagation(); trips.splice(+b.dataset.del, 1); await store.set('sync', 'trips_v1', trips); renderTrips(); renderWeek();
  }));
}

function renderPlan() {
  if (!data) return;
  if (!$('p-date').options.length) fillPlanForm();
  if (plan.to <= plan.from) { plan.to = Math.min(24, plan.from + 1); $('p-to').value = plan.to; }
  renderTrips();
  const rows = planRows(plan);
  const nowT = nowLocal();
  const out = $('p-result');
  if (!rows.length) { out.innerHTML = '<div class="loading">אין תחזית לטווח הזה</div>'; return; }
  if (rows[rows.length - 1].t.slice(0, 13) < nowT.slice(0, 13)) {
    // הזמן עבר – עוברים אוטומטית לאותן שעות ביום הבא
    const dates = [...new Set(data.rows.map(r => r.date))];
    const next = dates[dates.indexOf(plan.date) + 1];
    if (next) { plan = { ...plan, date: next }; fillPlanForm(); return renderPlan(); }
    out.innerHTML = '<div class="loading">הזמן הזה כבר עבר – בחר זמן עתידי</div>'; return;
  }

  const vals = k => rows.map(r => r[k]).filter(v => v != null);
  const mn = k => vals(k).length ? Math.min(...vals(k)) : null, mx = k => vals(k).length ? Math.max(...vals(k)) : null;
  const avgOf = k => vals(k).length ? vals(k).reduce((a, b) => a + b, 0) / vals(k).length : null;
  const rain = rainText(rows);
  const sun = data.daily[plan.date];
  const sunsetH = sun ? +sun.sunset.slice(11, 13) + sun.sunset.slice(14, 16) / 60 : 24;
  const sunriseH = sun ? +sun.sunrise.slice(11, 13) + sun.sunrise.slice(14, 16) / 60 : 0;
  const md = meanDir(rows);
  const coastD = md == null ? 90 : Math.abs(((md - COAST_NORMAL) % 360 + 540) % 360 - 180);
  const s = {
    md, wMin: mn('wind'), wMax: mx('wind'), gMax: mx('gust'), wvMin: mn('wave'), wvMax: mx('wave'), per: avgOf('wavePer'),
    tMin: mn('temp'), tMax: mx('temp'), sst: avgOf('sst'), wet: rain.wet, rainT: rain.t,
    afterSunset: plan.to > sunsetH + 0.25, beforeSunrise: plan.from < sunriseH - 0.25,
    thunder: rows.some(r => r.code >= 95), offshore: coastD > 120
  };
  const lvl = planVerdict(rows);
  const reasons = reasonsByHour(rows);
  const conf = modelConfidence(rows);
  const dep = rows[0], ret = rows[rows.length - 1];
  const segs = sailPlanSegments(rows);
  const alts = lvl > 0 ? findAlternatives(plan) : [];
  const today = nowLocal().slice(0, 10);
  const l = dayLabel(plan.date, today);
  const delta = (a, b, d = 0, unit = '') => {
    if (a == null || b == null) return '';
    const x = b - a; if (Math.abs(x) < (d ? 0.15 : 2)) return '<span class="muted">ללא שינוי</span>';
    return `<b style="color:${x > 0 ? 'var(--gust)' : 'var(--go)'}">${x > 0 ? '▲' : '▼'} <bdi dir="ltr">${fmt(Math.abs(x), d)}</bdi> ${unit}</b>`;
  };
  const condCard = (title, r) => `
    <div class="cond"><div class="k">${title} · <bdi dir="ltr">${r === ret && ret !== dep ? hm(plan.to) : hm(r.hour)}</bdi></div>
      <div class="row">${ICON.wind} <b><bdi dir="ltr">${fmt(r.wind)}</bdi></b> קשר <span class="muted">(משבים ${fmt(r.gust)})</span> ${dirChip(r.dir)}</div>
      <div class="row">${ICON.wave} <b>${fmt(r.wave, 1)}</b> מ׳ <span class="muted">· ${fmt(r.wavePer)} שנ׳</span> · ${wxIcon(r.code, isNight(r))} ${fmt(r.temp)}°</div></div>`;

  let legs = '';
  if (plan.course !== '' && dep.dir != null && ret.dir != null) {
    const out1 = pointOfSail(dep.dir, +plan.course), back = pointOfSail(ret.dir, (+plan.course + 180) % 360);
    legs = `<div class="legs"><div><span class="muted">בדרך החוצה:</span> <b style="color:${out1.c}">${out1.t}</b></div>
            <div><span class="muted">בדרך חזרה:</span> <b style="color:${back.c}">${back.t}</b></div></div>`;
  }
  const extraWarn = [];
  if (s.afterSunset) extraWarn.push(`החזרה אחרי השקיעה (<bdi dir="ltr">${sun.sunset.slice(11)}</bdi>)`);
  if (s.beforeSunrise) extraWarn.push(`היציאה לפני הזריחה (<bdi dir="ltr">${sun.sunrise.slice(11)}</bdi>)`);
  if (daySummary(plan.date).maxDrop >= 3) extraWarn.push('ירידת לחץ חדה ביום הזה');
  const problems = reasons.concat(extraWarn);
  const dur = plan.to - plan.from;

  out.innerHTML = `
    <div class="p-top">
      <div class="hero-badge" style="--c:${VCOL[lvl]}">
        <div class="q">ההפלגה שתכננת:</div>
        <div class="vt">${vGlyph(lvl, true)} ${VERDICT[lvl].long}</div>
        <div class="vs">${l.name} · <bdi dir="ltr">${hm(plan.from)}–${hm(plan.to)}</bdi> · <span style="white-space:nowrap">${dur === 1 ? 'שעה' : dur + ' שעות'}</span></div>
        ${conf ? `<div class="conf" title="${conf.d}" style="--cc:${conf.c}">ביטחון בתחזית: <b>${conf.t}</b></div>` : ''}
      </div>
      <div class="p-mid">
        <div class="p-stats">
          <div class="st"><div class="k">רוח</div><div class="v">${range(s.wMin, s.wMax)}<small> קשר</small></div><div>${dirChip(md)}</div></div>
          <div class="st"><div class="k">משבים</div><div class="v">עד <bdi dir="ltr">${fmt(s.gMax)}</bdi><small> קשר</small></div><div class="sub2">הסף: ${settings.maxGust}</div></div>
          <div class="st"><div class="k">גלים</div><div class="v">${range(s.wvMin, s.wvMax, 1)}<small> מ׳</small></div><div class="sub2">${seaText(s.wvMax ?? 0)}</div></div>
        </div>
        <div class="p-reasons${problems.length ? '' : ' ok'}">${problems.length ? '⚠ ' + problems.join(' · ') : '✓ כל השעות בתוך הספים'}</div>
        <div class="p-comfort">${skyIcon(rows)} ${s.rainT} · ${range(s.tMin, s.tMax)}° · מים ${fmt(s.sst)}° · ${comfortText(s.wvMax, s.per)}</div>
      </div>
    </div>

    <div id="p-timeline" class="timeline"></div>

    <div class="p-bottom">
      <div class="box"><h5>לפני היציאה</h5>
        ${checklist(rows, s).map(i => `<div class="ck">${i}</div>`).join('')}
      </div>
      <div class="box"><h5>מפרשים</h5>
        ${segs.map(sg => `<div class="seg-row"><bdi dir="ltr" class="muted">${hm(sg.start)}–${hm(sg.end + 1)}</bdi> <span style="color:${VTXT[sg.lvl]}">${lvl > 0 ? sg.t.replace(' – תנאי הפלגה מצוינים', '') : sg.t}</span></div>`).join('')}
      </div>
    </div>
    ${alts.length ? `<div class="alts"><b>זמנים טובים יותר באותו אורך:</b> ${alts.map(a => {
      const al = dayLabel(a.date, today);
      return `<button class="alt" data-d="${a.date}" data-f="${a.from}" data-t="${a.to}">${al.name} <bdi dir="ltr">${hm(a.from)}–${hm(a.to)}</bdi></button>`;
    }).join('')}</div>` : (lvl > 0 ? '<div class="alts muted">לא נמצא זמן ירוק באותו אורך ב-7 הימים הקרובים.</div>' : '')}
    <div class="p-actions"><button id="p-copy" class="primary">העתק סיכום לוואטסאפ</button><span id="p-copied" class="muted small" role="status"></span></div>

    <details class="route" id="route-details">
      <summary>ניתוח מסלול: יציאה מול חזרה ומצפן</summary>
      <div class="route-grid">
        <div class="p-compass">${compassSvg(rows, plan.course)}
          <div class="leg-key"><span>→ רוח</span> <span style="color:var(--rain)">⇢ גלים</span>${plan.course ? ' <span style="color:var(--trip)">→ המסלול שלך</span>' : ''}</div></div>
        <div>
          <div class="p-dr">
            ${condCard('ביציאה', dep)}
            <div class="cond mid"><div class="k">מה משתנה עד החזרה</div>
              <div class="row">רוח ${delta(dep.wind, ret.wind, 0, 'קשר')}</div>
              <div class="row">גלים ${delta(dep.wave, ret.wave, 1, 'מ׳')}</div></div>
            ${condCard('בחזרה', ret)}
          </div>
          ${legs}
          <div class="p-comfort" style="padding-top:8px">🧭 ${coastNote(md)}</div>
        </div>
      </div>
    </details>`;

  renderTimeline(plan.date, plan.from, plan.to - 1, 'p-timeline');
  out.querySelectorAll('.alt').forEach(b => b.addEventListener('click', () => {
    plan = { ...plan, date: b.dataset.d, from: +b.dataset.f, to: +b.dataset.t }; fillPlanForm(); renderPlan();
  }));
  $('p-copy').addEventListener('click', async () => {
    const txt = planText(plan, rows, s, lvl);
    try { await navigator.clipboard.writeText(txt); }
    catch (_) { const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
    $('p-copied').textContent = 'הועתק ✓';
    track('plan-copy');
  });
}

function onPlanChange() {
  plan = { date: $('p-date').value, from: +$('p-from').value, to: +$('p-to').value, course: $('p-course').value };
  if (plan.to <= plan.from) { plan.to = Math.min(24, plan.from + 1); $('p-to').value = plan.to; }
  store.set('local', 'plan_v1', plan);
  renderPlan();
}

/* ===================== טעינה ===================== */
async function load(force) {
  const btn = $('refresh-btn');
  btn.disabled = true; btn.innerHTML = '⏳ <span class="btxt">טוען…</span>';
  const cacheKey = 'cache_v4';
  const cached = await store.get('local', cacheKey);
  const sameLoc = cached && cached.loc === locKey();
  if (cached && sameLoc && !data) { data = cached.data; renderAll(); }

  if (!force && cached && sameLoc && Date.now() - cached.data.fetchedAt < CACHE_MAX_AGE) {
    showBanner(cached.data.errors?.join(' · '), false);
    btn.disabled = false; btn.innerHTML = '🔄 <span class="btxt">רענן</span>';
    return;
  }
  try {
    data = await fetchAll();
    await store.set('local', cacheKey, { loc: locKey(), data });
    showBanner(data.errors.join(' · '), false);
    renderAll();
  } catch (e) {
    if (data) showBanner(`אין חיבור – מוצג מידע שמור. (${e.message})`, true);
    else { showBanner(`שגיאה בטעינת התחזית: ${e.message}`, true); $('loading').textContent = 'לא הצלחתי לטעון תחזית.'; }
  } finally {
    btn.disabled = false; btn.innerHTML = '🔄 <span class="btxt">רענן</span>';
  }
}
const locKey = () => [settings.windLat, settings.windLon, settings.waveLat, settings.waveLon].join(',');

/* ===================== Windy ===================== */
let windyOverlay = 'wind';
function windyUrl() {
  const s = settings;
  const product = (windyOverlay === 'waves' || windyOverlay === 'swell1') ? 'ecmwfWaves' : 'ecmwf';
  return `https://embed.windy.com/embed2.html?lat=${s.windLat}&lon=${s.windLon - 0.25}&detailLat=${s.windLat}&detailLon=${s.windLon}` +
    `&width=776&height=470&zoom=9&level=surface&overlay=${windyOverlay}&product=${product}&menu=&message=true&marker=true` +
    `&calendar=now&pressure=true&type=map&location=coordinates&detail=&metricWind=kt&metricTemp=%C2%B0C&radarRange=-1`;
}
function showView(v) {
  if (window.scrollY > 0) window.scrollTo(0, 0);
  ['brief', 'plan', 'table', 'windy'].forEach(k => {
    $(k + '-view').classList.toggle('hidden', v !== k);
    $('view-' + k).classList.toggle('active', v === k);
  });
  $('days-nav').classList.toggle('hidden', v === 'windy' || v === 'plan');
  store.set('local', 'view_v3', v);
  track('view-' + v);
  if ((v === 'plan' || v === 'brief') && data) renderAll();
  if (v === 'windy') { const u = windyUrl(); if ($('windy-frame').src !== u) $('windy-frame').src = u; }
}

/* ===================== מפת נקודות תחזית ===================== */
const MARINA = [32.1631, 34.7962];
let ptMap = null, ptLayers = null;
function distKm(a, b) {
  const R = 6371, toR = x => x * Math.PI / 180;
  const dLa = toR(b[0] - a[0]), dLo = toR(b[1] - a[1]);
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(toR(a[0])) * Math.cos(toR(b[0])) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const pinIcon = (emoji, cls) => L.divIcon({ className: '', html: `<div class="pin ${cls}">${emoji}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] });
function formPoints() {
  return { wind: [+$('s-windLat').value, +$('s-windLon').value], wave: [+$('s-waveLat').value, +$('s-waveLon').value] };
}
function initPtMap() {
  if (typeof L === 'undefined') { $('pt-map').innerHTML = '<div class="loading">המפה לא נטענה</div>'; return; }
  if (!ptMap) {
    ptMap = L.map('pt-map', { zoomControl: true, attributionControl: true }).setView([32.17, 34.77], 12);
    const bases = {
      'OpenSeaMap': L.tileLayer('https://t2.openseamap.org/tile/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenSeaMap, © OpenStreetMap' }),
      'מפת רחובות (Esri)': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', { maxZoom: 18, attribution: '© Esri' }),
      'לוויין (Esri)': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 18, attribution: '© Esri' }),
      'אוקיינוס (Esri)': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}', { maxZoom: 18, maxNativeZoom: 10, attribution: '© Esri' })
    };
    const seamarks = L.tileLayer('https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenSeaMap' });
    const order = Object.keys(bases);
    let cur = 0, errs = 0, loaded = 0;
    const useBase = i => {
      Object.values(bases).forEach(l => ptMap.removeLayer(l));
      cur = i; errs = 0; loaded = 0;
      bases[order[i]].addTo(ptMap).bringToBack();
    };
    // מעבר אוטומטי למפה הבאה אם המפה הנוכחית לא נטענת
    order.forEach((k, i) => {
      bases[k].on('tileerror', () => { if (i === cur && ++errs >= 4 && loaded === 0 && cur < order.length - 1) useBase(cur + 1); });
      bases[k].on('tileload', () => { if (i === cur) loaded++; });
    });
    useBase(0);
    seamarks.addTo(ptMap);
    L.control.layers(bases, { 'סימוני ים (OpenSeaMap)': seamarks }, { position: 'topright', collapsed: true }).addTo(ptMap);
    ptMap.on('baselayerchange', e => { cur = order.indexOf(e.name); errs = 0; loaded = 0; });
    ptLayers = L.layerGroup().addTo(ptMap);
    ptMap.on('click', e => {
      const which = document.querySelector('input[name="pick"]:checked').value;
      $('s-' + which + 'Lat').value = e.latlng.lat.toFixed(4);
      $('s-' + which + 'Lon').value = e.latlng.lng.toFixed(4);
      drawPtMap();
    });
    ['s-windLat', 's-windLon', 's-waveLat', 's-waveLon'].forEach(id => $(id).addEventListener('change', drawPtMap));
  }
  setTimeout(() => { ptMap.invalidateSize(); drawPtMap(true); }, 60);
}
function drawPtMap(fit) {
  if (!ptMap) return;
  ptLayers.clearLayers();
  const pts = formPoints();
  L.marker(MARINA, { icon: pinIcon('⚓', 'marina') }).bindTooltip('מרינה הרצליה').addTo(ptLayers);
  const sameLoc = data && data.grid && locKey() === [pts.wind[0], pts.wind[1], pts.wave[0], pts.wave[1]].join(',');
  const info = [];
  for (const [k, emoji, label, col] of [['wind', '🌬️', 'נקודת רוח', '#2fa8e0'], ['wave', '🌊', 'נקודת גלים', '#2fd0e8']]) {
    const m = L.marker(pts[k], { icon: pinIcon(emoji, k), draggable: true }).bindTooltip(label).addTo(ptLayers);
    m.on('dragend', () => {
      const ll = m.getLatLng();
      $('s-' + k + 'Lat').value = ll.lat.toFixed(4); $('s-' + k + 'Lon').value = ll.lng.toFixed(4);
      drawPtMap();
    });
    let line = `${emoji} <b>${label}</b>: ${fmt(distKm(MARINA, pts[k]), 1)} ק"מ מהמרינה`;
    const cell = sameLoc ? data.grid[k] : null;
    if (cell) {
      L.circleMarker(cell, { radius: 9, color: col, weight: 2, dashArray: '4 3', fillOpacity: 0.12 })
        .bindTooltip(`תא המודל בפועל (${label})<br>${cell[0].toFixed(3)}, ${cell[1].toFixed(3)}`).addTo(ptLayers);
      L.polyline([pts[k], cell], { color: col, weight: 1.5, dashArray: '3 4' }).addTo(ptLayers);
      line += ` · תא המודל בפועל ${fmt(distKm(pts[k], cell), 1)} ק"מ מהנקודה, ${fmt(distKm(MARINA, cell), 1)} ק"מ מהמרינה`;
    } else if (data && data.grid) {
      line += ' · <span class="warn">תא המודל יחושב אחרי "שמור"</span>';
    }
    info.push(line);
  }
  if (sameLoc && data.grid.models) info.push(`📊 השוואת המודלים (ECMWF/ICON/GFS) משתמשת ברשת גסה יותר – תא במרחק ${fmt(distKm(MARINA, data.grid.models), 1)} ק"מ`);
  $('pt-info').innerHTML = info.map(x => `<div>${x}</div>`).join('');
  if (fit) ptMap.fitBounds(L.latLngBounds([MARINA, pts.wind, pts.wave, ...(sameLoc ? [data.grid.wind, data.grid.wave].filter(Boolean) : [])]).pad(0.35));
}

/* ===================== הגדרות ===================== */
const FIELDS = ['maxWind', 'maxGust', 'maxWave', 'minPeriod', 'hourFrom', 'hourTo', 'windLat', 'windLon', 'waveLat', 'waveLon'];
function fillSettings(s) {
  FIELDS.forEach(f => $('s-' + f).value = s[f]);
  $('s-step').value = String(s.step);
  $('s-showModels').checked = !!s.showModels;
}
function readSettings() {
  const s = { ...settings };
  FIELDS.forEach(f => { const v = parseFloat($('s-' + f).value); if (!Number.isNaN(v)) s[f] = v; });
  s.hourFrom = Math.max(0, Math.min(23, Math.round(s.hourFrom)));
  s.hourTo = Math.max(s.hourFrom, Math.min(23, Math.round(s.hourTo)));
  s.step = parseInt($('s-step').value, 10) || 1;
  s.showModels = $('s-showModels').checked;
  return s;
}

/* ===================== אתחול ===================== */
document.addEventListener('DOMContentLoaded', async () => {
  const saved = await store.get('sync', 'settings_v3');
  settings = { ...DEFAULTS, ...(saved || {}) };
  $('windy-link').href = `https://www.windy.com/${settings.windLat}/${settings.windLon}?${settings.windLat},${settings.windLon},11`;

  $('refresh-btn').addEventListener('click', () => load(true));
  $('view-brief').addEventListener('click', () => showView('brief'));
  $('view-table').addEventListener('click', () => showView('table'));
  $('view-plan').addEventListener('click', () => showView('plan'));
  ['p-date', 'p-from', 'p-to', 'p-course'].forEach(id => $(id).addEventListener('change', onPlanChange));
  $('p-save').addEventListener('click', async () => {
    if (!trips.some(t => t.date === plan.date && t.from === plan.from && t.to === plan.to)) {
      track('plan-save');
      trips.push({ ...plan }); trips.sort((a, b) => (a.date + pad2(a.from)) < (b.date + pad2(b.from)) ? -1 : 1);
      await store.set('sync', 'trips_v1', trips);
    }
    renderTrips(); renderWeek();
  });
  const today0 = nowLocal().slice(0, 10);
  trips = ((await store.get('sync', 'trips_v1')) || []).filter(t => t.date >= today0);
  const savedPlan = await store.get('local', 'plan_v1');
  if (savedPlan && savedPlan.date >= today0) plan = savedPlan;
  const lastView = await store.get('local', 'view_v3');
  if (lastView === 'table' || lastView === 'plan') showView(lastView);
  $('view-windy').addEventListener('click', () => showView('windy'));
  document.querySelectorAll('.windy-bar .seg').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.windy-bar .seg').forEach(x => x.classList.toggle('active', x === b));
    windyOverlay = b.dataset.overlay;
    $('windy-frame').src = windyUrl();
  }));
  const openSettings = () => { fillSettings(settings); $('settings').classList.remove('hidden'); document.body.classList.add('modal-open'); $('settings').scrollTop = 0; };
  const closeSettings = () => { $('settings').classList.add('hidden'); document.body.classList.remove('modal-open'); };
  $('settings-btn').addEventListener('click', () => $('settings').classList.contains('hidden') ? openSettings() : closeSettings());
  $('settings-close').addEventListener('click', closeSettings);
  $('windy-frame').addEventListener('load', () => $('windy-frame').parentElement.classList.add('loaded'));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('settings').classList.contains('hidden')) closeSettings(); });
  $('adv-points').addEventListener('toggle', () => { if ($('adv-points').open) initPtMap(); });
  $('settings-reset').addEventListener('click', () => { fillSettings(DEFAULTS); drawPtMap(true); });
  $('settings-save').addEventListener('click', async () => {
    const before = locKey();
    settings = readSettings();
    await store.set('sync', 'settings_v3', settings);
    $('settings').classList.add('hidden'); document.body.classList.remove('modal-open');
    if (locKey() !== before) { data = null; await load(true); } else renderAll();
  });
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.key === 'ArrowLeft') $('next-day').click();
    if (e.key === 'ArrowRight') $('prev-day').click();
  });

  // מצב בהיר / כהה: מערכת → בהיר → כהה
  const themeBtn = $('theme-btn');
  if (themeBtn) {
    const setTheme = th => {
      if (th) document.documentElement.setAttribute('data-theme', th); else document.documentElement.removeAttribute('data-theme');
      try { th ? localStorage.setItem('theme', th) : localStorage.removeItem('theme'); } catch (_) {}
      themeBtn.textContent = th === 'light' ? '☀️' : th === 'dark' ? '🌙' : '🌓';
      themeBtn.title = th === 'light' ? 'מצב בהיר (לחץ לכהה)' : th === 'dark' ? 'מצב כהה (לחץ לאוטומטי)' : 'אוטומטי לפי המכשיר (לחץ לבהיר)';
      if (data) renderAll();
    };
    let cur0 = null; try { cur0 = localStorage.getItem('theme'); } catch (_) {}
    setTheme(cur0);
    themeBtn.addEventListener('click', () => {
      const cur = document.documentElement.getAttribute('data-theme');
      setTheme(cur === 'light' ? 'dark' : cur === 'dark' ? null : 'light');
    });
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && data && Date.now() - data.fetchedAt > CACHE_MAX_AGE) load(true);
  });
  // מציירים מחדש רק כשהרוחב באמת משתנה (סיבוב מסך) – לא כשסרגל הכתובת בטלפון נעלם/מופיע בזמן גלילה
  let rT, lastW = window.innerWidth;
  window.addEventListener('resize', () => {
    if (Math.abs(window.innerWidth - lastW) < 2) return;
    lastW = window.innerWidth;
    clearTimeout(rT); rT = setTimeout(() => data && renderAll(), 250);
  });
  load(false);
});
