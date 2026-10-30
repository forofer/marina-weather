'use strict';
/* ים הרצליה – תצוגה ואינטראקציה (גרסה 5). נטען אחרי icons.js, core.js ו-data.js */

/* ===================== סטטיסטיקה (GoatCounter – ללא עוגיות) ===================== */
function track(name) {
  try { if (window.goatcounter && window.goatcounter.count) window.goatcounter.count({ path: 'event/' + name, title: name, event: true }); } catch (_) {}
}

/* ===================== עזרים ===================== */
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ST_ICO = ['circle-check', 'triangle-alert', 'circle-x', 'circle-help'];
const stIco = (lvl, s = 18) => ico(ST_ICO[lvl], s);
const SHORT = ['מתאים', 'בזהירות', 'לא מומלץ', 'אין מספיק נתונים'];
const bdi = s => `<bdi dir="ltr">${s}</bdi>`;
const span = (a, b) => bdi(`${hm(a)}–${b === 24 ? '24:00' : hm(b)}`);
const todayStr = () => nowLocal().slice(0, 10);
const dateOnly = sub => sub.replace(/^\S+ /, '');
function dayName(d) { const l = dayLabel(d, todayStr()); return { name: l.name, sub: l.sub, date: dateOnly(l.sub), full: l.name === 'היום' || l.name === 'מחר' ? `${l.name}, ${l.sub}` : `יום ${l.name}, ${dateOnly(l.sub)}` }; }
function isDark() {
  const t = document.documentElement.getAttribute('data-theme');
  return t ? t === 'dark' : !!(window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
}
// חץ שמראה לאן הרוח/הגל נושבים, יחד עם שם הכיוון במילים
const dirArrow = deg => deg == null ? '' :
  `<svg class="darrow" viewBox="0 0 24 24" style="transform:rotate(${Math.round(deg)}deg)" aria-hidden="true"><path d="M12 3v17M5.5 13.5 12 20l6.5-6.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const arrowTxt = deg => deg == null ? '' : `<span class="arrow" style="transform:rotate(${Math.round(deg)}deg)" aria-hidden="true">↓</span>`;
function wxIco(code, night, s = 18) {
  if (code == null) return '';
  const n = code >= 95 ? 'cloud-lightning' : code >= 80 ? (night ? 'cloud-rain' : 'cloud-sun-rain') : code >= 71 ? 'snowflake' : code >= 61 ? 'cloud-rain'
    : code >= 51 ? 'cloud-drizzle' : code >= 45 ? 'cloud-fog' : code === 3 ? 'cloud' : code >= 1 ? (night ? 'cloud-moon' : 'cloud-sun') : (night ? 'moon' : 'sun');
  return ico(n, s);
}
const WX_NAME = c => c == null ? '' : c >= 95 ? 'סופת רעמים' : c >= 80 ? 'ממטרים' : c >= 71 ? 'שלג' : c >= 61 ? 'גשם' : c >= 51 ? 'טפטוף' : c >= 45 ? 'ערפל' : c === 3 ? 'מעונן' : c >= 1 ? 'מעונן חלקית' : 'בהיר';
// כשהעיגול מסתיר חריגה (1.34 מול 1.3) – מציגים ספרה נוספת
function overDigits(v, max, d0) { let d = d0; while (d < d0 + 2 && +Number(v).toFixed(d) <= +Number(max).toFixed(d)) d++; return d; }
function boxWidth(id) {
  const el = $(id); const w = el ? el.clientWidth : 0;
  return w || Math.min(1100, (document.documentElement.clientWidth || 800) - 64);
}
const remPx = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

/* ===================== רכיבים משותפים ===================== */
// כרטיס החלטה – אותו רכיב בסיכום, בתכנון ובנתונים
function decisionCard({ lvl, scope, title, why, actions, extra, basis = true }) {
  return `<div class="decision lv${lvl}">
    <div class="dc-scope">${scope}</div>
    <div class="dc-head"><span class="dc-ico">${stIco(lvl, 20)}</span><h2 class="dc-title">${title}</h2></div>
    ${why || basis ? `<p class="dc-why">${why || ''}${basis ? `<span class="dc-basis">${why ? ' · ' : ''}לפי <button type="button" class="linkish" data-open-settings>הספים שהגדרת</button></span>` : ''}</p>` : ''}
    ${actions ? `<div class="dc-actions">${actions}</div>` : ''}
    ${extra || ''}
  </div>`;
}
function metric({ icon, label, value, unit, dir, sub, over, lvl, title }) {
  return `<div class="metric${over ? ' over lv' + lvl : ''}"${title ? ` title="${esc(title)}"` : ''}>
    <div class="m-label">${ico(icon, 16)}${label}</div>
    <div class="m-value${/[–-]/.test(value) ? ' rng' : ''}">${bdi(value)}</div>
    <div class="m-unit">${unit}</div>
    ${dir != null ? `<div class="m-dir">${dirArrow(dir)}<span class="nowrap">${from8(dir)}</span></div>` : ''}
    ${sub ? `<div class="m-sub">${sub}</div>` : ''}
  </div>`;
}
const pill = (lvl, text) => `<span class="pill lv${lvl}">${stIco(lvl, 16)}${text}</span>`;

/* ===================== בורר ימים ===================== */
function renderDays() {
  const today = todayStr();
  const dates = [...new Set(data.rows.map(r => r.date))].filter(d => d >= today);
  if (!selectedDate || !dates.includes(selectedDate)) selectedDate = dates[0];
  $('day-tabs').innerHTML = dates.map(d => {
    const n = dayName(d), hs = heroStatus(d);
    const lvl = hs.late ? 3 : hs.lvl;
    const st = hs.late ? 'היום נגמר' : hs.title;
    return `<button class="day-tab ${d === selectedDate ? 'active' : ''}" data-date="${d}" aria-pressed="${d === selectedDate}" aria-label="${n.name} ${n.date} – ${st}">
      <span class="d"><span class="dot lv${lvl}"></span>${n.name}</span><span class="s">${n.name === 'היום' || n.name === 'מחר' ? n.sub : n.date}</span></button>`;
  }).join('');
  $('day-tabs').querySelectorAll('.day-tab').forEach(b => b.addEventListener('click', () => selectDate(b.dataset.date)));
  const act = $('day-tabs').querySelector('.day-tab.active'), bar = $('day-tabs');
  if (act) { // גלילה אופקית בשורת הימים בלבד – בלי להזיז את הדף
    const a = act.getBoundingClientRect(), b = bar.getBoundingClientRect();
    if (a.left < b.left) bar.scrollLeft -= (b.left - a.left) + 8;
    else if (a.right > b.right) bar.scrollLeft += (a.right - b.right) + 8;
  }
  const i = dates.indexOf(selectedDate);
  $('prev-day').disabled = i <= 0;
  $('next-day').disabled = i >= dates.length - 1;
  $('prev-day').onclick = () => { if (i > 0) selectDate(dates[i - 1]); };
  $('next-day').onclick = () => { if (i < dates.length - 1) selectDate(dates[i + 1]); };
}
function selectDate(d) { selectedDate = d; seaHour = null; renderAll(); }

/* ===================== סיכום: כרטיס החלטה ===================== */
function dayWarnings(date, rows) {
  const alerts = [];
  const age = Date.now() - data.fetchedAt;
  if (age > 3 * 3600e3) alerts.push({ lvl: 1, t: `התחזית לא עודכנה ${ageText(age).replace('לפני ', '')} – לחצו רענון` });
  if (rows.some(r => r.code >= 95)) alerts.push({ lvl: 2, t: 'סופות רעמים צפויות' });
  else if (rows.some(r => (r.cape ?? 0) > 1000 && (r.pop ?? 0) > 30)) alerts.push({ lvl: 1, t: 'סיכון לרעמים' });
  const wMax = Math.max(...rows.map(r => r.wind ?? 0)), gMax = Math.max(...rows.map(r => r.gust ?? 0));
  if (rows.some(r => r.gust != null && r.wind != null && r.gust - r.wind >= 10)) alerts.push({ lvl: 1, t: 'רוח משבית – כדאי להכין ריף מראש' });
  if (daySummary(date).maxDrop >= 3) alerts.push({ lvl: 1, t: 'ירידת לחץ חדה – מערכת מתקרבת' });
  if (rows.some(r => r.vis != null && r.vis < 4000)) alerts.push({ lvl: 1, t: 'ראות מוגבלת' });
  return { alerts, wMax, gMax };
}
function dayTrends(rows) {
  const out = [];
  if (rows.length >= 4) {
    const first = rows.slice(0, Math.ceil(rows.length / 2)), last = rows.slice(Math.floor(rows.length / 2));
    const avgW = a => a.reduce((s, r) => s + (r.wind ?? 0), 0) / Math.max(1, a.length);
    const dW = avgW(last) - avgW(first);
    if (dW >= 4) out.push('הרוח מתחזקת בהמשך היום');
    else if (dW <= -4) out.push('הרוח נחלשת בהמשך היום');
  }
  const shift = dirShift(rows);
  if (shift) out.push('הרוח ' + shift);
  return out;
}
function winText(wins, date) {
  const ssH = sunH(date, 'sunset');
  return { v: wins.map(w => span(w.start, w.end)).join(' , '), night: wins.some(w => w.end > ssH + 0.25) };
}
const winHours = w => w.end - w.start;
const hoursTxt = n => n === 1 ? 'שעה' : n === 2 ? 'שעתיים' : `${n} שעות`;
function renderDecision() {
  const el = $('decision');
  const n = dayName(selectedDate);
  const isToday = selectedDate === todayStr();
  const hs = heroStatus(selectedDate);
  if (hs.late) {
    const dates = [...new Set(data.rows.map(r => r.date))];
    const next = dates[dates.indexOf(selectedDate) + 1];
    el.innerHTML = decisionCard({
      lvl: 3, scope: n.full, title: 'היום כבר נגמר', basis: false,
      why: `טווח השעות שלך מסתיים ב-${bdi(hm(settings.hourTo + 1))}. אפשר לשנות אותו בהגדרות.`,
      actions: next ? '<button id="go-next" class="btn primary">לתחזית של מחר</button>' : ''
    });
    if (next) $('go-next').addEventListener('click', () => { selectDate(next); window.scrollTo(0, 0); });
    return;
  }
  const rows = hs.rows;
  const scope = `${n.full} · ${isToday ? 'מעכשיו עד ' + bdi(hm(settings.hourTo)) : span(settings.hourFrom, settings.hourTo)}`;
  let why = hs.why;
  if (!why && hs.lvl === 0) why = `${beaufortText(Math.max(...rows.map(r => r.wind ?? 0)))}, ${seaText(Math.max(...rows.map(r => r.wave ?? 0)))}`;
  const { alerts } = dayWarnings(selectedDate, rows);
  const trends = dayTrends(rows);
  const extra = alerts.map(a => `<div class="alert lv${a.lvl}">${ico('triangle-alert', 16)}<span>${a.t}</span></div>`).join('') +
    (trends.length ? `<details class="more dc-more"><summary>עוד על היום</summary><p class="note">${ico('wind', 16)}<span>${trends.join(' · ')}</span></p></details>` : '');
  el.innerHTML = decisionCard({ lvl: hs.lvl, scope, title: hs.title, why, extra });
}

// החלון המתאים – נפרד מהתנאים בשעה שנבחרה. כמה חלונות → אפשר לבחור; הארוך ביותר מסומן
function renderWindow() {
  const el = $('window-card'); if (!el) return;
  const hs = heroStatus(selectedDate);
  const isToday = selectedDate === todayStr();
  if (hs.late || hs.lvl === NODATA) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  const head = `<h2 class="sec-h">${isToday ? 'החלון המתאים היום' : 'החלון המתאים ' + whenWords(selectedDate)}</h2>`;
  if (!hs.wins.length) { el.innerHTML = head + '<p class="muted" style="margin:0">אין ביום הזה רצף של שעות בתוך הספים שלך.</p>'; return; }
  const ssH = sunH(selectedDate, 'sunset');
  const best = hs.best;
  el.innerHTML = head + `<div class="wins">${hs.wins.slice(0, 4).map((w, i) => {
    const isBest = w === best && hs.wins.length > 1;
    return `<div class="win${w === best ? ' best' : ''}">
      <div class="win-t"><span class="v">${span(w.start, w.end)}</span><span class="s">${hoursTxt(winHours(w))}${isBest ? ' · הארוך ביותר' : ''}${w.end > ssH + 0.25 ? ' · גם אחרי השקיעה' : ''}</span></div>
      <button class="btn${w === best ? ' primary' : ''}" data-win="${hs.wins.indexOf(w)}">${ico('sailboat', 18)}תכנן הפלגה בחלון הזה</button>
    </div>`; }).join('')}</div>
    <p class="hint">בחלון כל השעות בתוך הספים – כולל שעת החזרה.</p>`;
  el.querySelectorAll('[data-win]').forEach(b => b.addEventListener('click', () => {
    const w = hs.wins[+b.dataset.win];
    plan = { ...plan, date: selectedDate, from: w.start, to: w.start + Math.min(4, winHours(w)), win: { start: w.start, end: w.end } };
    store.set('local', 'plan_v1', plan); fillPlanForm(); showView('plan'); track('plan-from-window');
  }));
}

/* ===================== סיכום: התנאים בשעה שנבחרה ===================== */
let seaHour = null; // null = השעה הנוכחית (להיום) או שעה ברירת מחדל ליום אחר
function seaDefaultHour(date) {
  const now = nowLocal();
  if (date === now.slice(0, 10)) return Math.max(settings.hourFrom, Math.min(settings.hourTo, +now.slice(11, 13)));
  const dv = dayVerdict(activeRows(date));
  return dv.wins.length ? Math.max(dv.wins[0].start, Math.min(10, dv.wins[0].end)) : Math.max(settings.hourFrom, Math.min(10, settings.hourTo));
}
function selectedRow() {
  const byH = new Map(data.rows.filter(r => r.date === selectedDate).map(r => [r.hour, r]));
  if (seaHour == null || !byH.has(seaHour)) seaHour = seaDefaultHour(selectedDate);
  return byH.get(seaHour);
}
function selectHour(h) { seaHour = h; renderHourCard(); renderTrend(); renderTable(); }

function hourMetrics(r) {
  const v = verdict(r), lv = v.level === 2 ? 2 : 1;
  const over = k => v.over.find(o => o.k === k);
  const val = (k, d) => { const o = over(k); return o ? fmt(r[k], overDigits(r[k], o.max, d)) : fmt(r[k], d); };
  const ow = over('wind'), og = over('gust'), ov = over('wave');
  return `<div class="metrics">
    ${metric({ icon: 'wind', label: 'רוח', value: val('wind', 0), unit: 'קשר', dir: r.dir, sub: ow ? `מעל הסף שלך: ${ow.max}` : '', over: !!ow, lvl: lv, title: r.dir != null ? `הרוח נושבת ${from8(r.dir)} (${Math.round(r.dir)}°). החץ מראה לאן היא נושבת.` : '' })}
    ${metric({ icon: 'gauge', label: 'משבים', value: val('gust', 0), unit: 'קשר', sub: og ? `מעל הסף שלך: ${og.max}` : (r.gust != null && r.wind != null && r.gust - r.wind >= 8 ? `${fmt(r.gust - r.wind)} מעל הרוח` : ''), over: !!og, lvl: lv })}
    ${metric({ icon: 'waves', label: 'גלים', value: val('wave', 1), unit: 'מטר', dir: r.waveDir, sub: ov ? `מעל הסף שלך: ${ov.max}` : (r.wavePer != null ? `מחזור ${fmt(r.wavePer)} שנ׳` : ''), over: !!ov, lvl: lv, title: 'גובה גל משמעותי: הממוצע של השליש הגבוה מהגלים. גלים בודדים יכולים להיות גבוהים יותר.' })}
  </div>`;
}

function renderHourCard() {
  const el = $('hour-card'); if (!el || !data) return;
  const r = selectedRow();
  if (!r) { el.innerHTML = '<p class="muted">אין תחזית לשעות האלה.</p>'; return; }
  const nowT = nowLocal();
  const isToday = selectedDate === nowT.slice(0, 10), nowH = +nowT.slice(11, 13);
  const isNow = r.t.slice(0, 13) === nowT.slice(0, 13);
  const v = verdict(r);
  const extraReasons = v.level === NODATA ? v.reasons.slice(0, 1)
    : v.reasons.filter(x => !/מעל הסף/.test(x)).map(x => x === 'ים קצר ותלול' ? 'גלים קצרים וצפופים' : x);
  const rain = rainSoonText(r);
  const sunset = data.daily[r.date]?.sunset.slice(11) || '';
  const ssH = sunH(selectedDate, 'sunset');
  const hours = []; for (let h = settings.hourFrom; h <= settings.hourTo; h++) hours.push(h);
  const byH = new Map(data.rows.filter(x => x.date === selectedDate).map(x => [x.hour, x]));
  const canNow = isToday && nowH >= settings.hourFrom && nowH <= settings.hourTo && seaHour !== nowH;
  const chips = hours.map(h => { const x = byH.get(h); if (!x) return ''; const vx = verdict(x);
    const why = vx.level ? ' – ' + (vx.level === NODATA ? vx.reasons[0] : plainReasons([x]).join(', ')) : '';
    const past = isToday && h < nowH;
    const chip = `<button class="hr${h === seaHour ? ' on' : ''}${isNight(x) ? ' nt' : ''}${past ? ' past' : ''}" data-h="${h}" role="tab" aria-selected="${h === seaHour}" tabindex="${h === seaHour ? 0 : -1}" aria-label="${hm(h)}: ${VERDICT[vx.level].t}${why}${isNight(x) ? ', אחרי השקיעה' : ''}">${pad2(h)}<span class="dot lv${vx.level}"></span></button>`;
    // סימון השקיעה בין השעות
    const ss = h < ssH && h + 1 > ssH ? `<span class="ss-mark" title="שקיעה ${sunset}" aria-label="שקיעה ${sunset}">${ico('sunset', 16)}<span>${sunset}</span></span>` : '';
    return chip + ss; }).join('');
  el.innerHTML = `
    <div class="hc-head"><h2 class="sec-h" id="hc-title">בשעה ${bdi(hm(r.hour))}${isNow ? ' <span class="hc-now">· עכשיו</span>' : ''}</h2>${pill(v.level, SHORT[v.level])}</div>
    ${hourMetrics(r)}
    ${extraReasons.length ? `<p class="hc-why lv${v.level}">${extraReasons.join(' · ')}</p>` : ''}
    <div class="pick-head"><span class="pick-l" id="pick-hour-l">בחר שעה</span>${canNow ? `<button class="btn quiet sm" id="hour-now">${ico('clock', 16)}חזרה לשעה הנוכחית</button>` : ''}</div>
    <div class="hours" role="tablist" aria-labelledby="pick-hour-l">${chips}</div>
    <div class="facts">
      <span class="${rain.wet ? 'wet' : ''}">${ico(rain.wet ? 'cloud-rain' : 'cloud-off', 16)}<span>${rain.t}</span></span>
      ${sunset ? `<span>${ico('sunset', 16)}<span>שקיעה ${bdi(sunset)}</span></span>` : ''}
      ${isNum(r.wave) ? `<span>${ico('sailboat', 16)}<span>${seaFeel(r)}</span></span>` : ''}
    </div>
    <div class="hc-art">${seaSvg(r)}</div>`;
  el.querySelectorAll('.hr').forEach(b => b.addEventListener('click', () => selectHour(+b.dataset.h)));
  if (canNow) $('hour-now').addEventListener('click', () => { selectHour(nowH); $('hour-card').querySelector('.hr.on')?.focus(); });
  const bar = el.querySelector('.hours');
  bar.addEventListener('keydown', e => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault(); e.stopPropagation();
    const list = [...el.querySelectorAll('.hr')], i = list.findIndex(b => +b.dataset.h === seaHour);
    const j = e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : Math.max(0, Math.min(list.length - 1, i + (e.key === 'ArrowRight' ? 1 : -1))); // השעות משמאל לימין
    selectHour(+list[j].dataset.h); $('hour-card').querySelector('.hr.on')?.focus();
  });
  const on = el.querySelector('.hr.on');
  if (on) { const a = on.getBoundingClientRect(), c = bar.getBoundingClientRect(); bar.scrollLeft += (a.left + a.width / 2) - (c.left + c.width / 2); }
}

/* ===================== איור הים ===================== */
function wavePath(W, base, A, L, phase, close = true) {
  let d = close ? `M0 ${base + 40} L0 ${base}` : '';
  for (let x = 0; x <= W + L; x += 4) d += `${!close && !d ? 'M' : ' L'}${x} ${(base - A * Math.sin(2 * Math.PI * (x + phase) / L)).toFixed(1)}`;
  return close ? d + ` L${W + L} ${base + 40} Z` : d;
}
function seaSvg(r) {
  const W = 360, H = 80, base = 54;
  const night = isNight(r), dark = isDark();
  const h = Math.min(r.wave ?? 0, 3), T = Math.max(3, Math.min(r.wavePer ?? 6, 12));
  const A = 1.2 + h * 4.5, L = 34 + T * T * 2.2;
  const w = r.wind ?? 0;
  const heel = Math.min(22, w * 1.1);
  const bob = Math.min(2, Math.max(0.8, A * 0.2));
  const wet = (r.pop ?? 0) >= 30 || (r.rain ?? 0) >= RAIN_MM;
  const cloudy = (r.cloud ?? 0) >= 60;
  const P = night ? { sky: ['#182a44', '#2a4266'], far: '#22426a', sea: ['#123459', '#0a2440'], foam: '#9fbbdb', hull: '#d5e1ec', sail: '#e9eff5', line: '#9fb3c8', streak: '#8fa9c8', cloud: '#3a4d6b' }
    : dark ? { sky: ['#21384f', '#2d4a66'], far: '#2c5880', sea: ['#1c4b77', '#113659'], foam: '#a8c8e6', hull: '#d5e1ec', sail: '#eef3f8', line: '#9fb3c8', streak: '#a9c3de', cloud: '#5b7189' }
    : { sky: ['#cfe5f6', '#eef6fc'], far: '#9cc8e8', sea: ['#2d7dbd', '#1a5890'], foam: '#ffffff', hull: '#183554', sail: '#ffffff', line: '#183554', streak: '#ffffff', cloud: '#ffffff' };
  let g = `<defs><linearGradient id="sk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${P.sky[0]}"/><stop offset="1" stop-color="${P.sky[1]}"/></linearGradient>
    <linearGradient id="se" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${P.sea[0]}"/><stop offset="1" stop-color="${P.sea[1]}"/></linearGradient></defs>
    <rect width="${W}" height="${H}" fill="url(#sk)"/>`;
  if (night) g += `<circle cx="300" cy="20" r="7" fill="#efe9cf"/><circle cx="303" cy="18" r="6.5" fill="${P.sky[0]}"/>`;
  else if (!cloudy && !wet) g += `<circle cx="300" cy="22" r="8" fill="${dark ? '#e3ad45' : '#f6bd44'}"/>`;
  if (cloudy || wet) g += `<path d="M276 28 a8 8 0 0 1 8-8 a10 10 0 0 1 19 2 a7 7 0 0 1 3 13 h-26 a6 6 0 0 1-4-7z" fill="${P.cloud}" opacity="${night || dark ? 0.9 : 0.95}"/>`;
  if (wet) { let rr = ''; for (let i = 0; i < 5; i++) rr += `<line x1="${284 + i * 5}" y1="${38 + (i % 2) * 2}" x2="${281 + i * 5}" y2="${45 + (i % 2) * 2}"/>`; g += `<g stroke="${P.streak}" stroke-width="1.3" stroke-linecap="round" opacity=".8">${rr}</g>`; }
  const ns = w < 8 ? 0 : Math.min(4, Math.round((w - 4) / 4));
  const dur = Math.max(1.4, 5 - w * 0.15).toFixed(2);
  let streaks = '';
  for (let i = 0; i < ns; i++) { const y = 10 + (i * 19) % 30, len = 12 + (i * 9) % 14, x = (i * 97) % W; streaks += `<line x1="${x}" y1="${y}" x2="${x + len}" y2="${y}" style="animation-delay:-${(i * 0.6).toFixed(2)}s"/>`; }
  g += `<g class="sc-wind" stroke="${P.streak}" stroke-width="1.2" stroke-linecap="round" opacity=".55" style="--d:${dur}s">${streaks}</g>`;
  g += `<g class="sc-wave" style="--L:${(L * 0.8).toFixed(0)}px;--t:${(14 + T).toFixed(1)}s"><path d="${wavePath(W, base - 6, A * 0.5, L * 0.8, 0)}" fill="${P.far}"/></g>`;
  const boat = `<line x1="0" y1="-50" x2="0" y2="0" stroke="${P.line}" stroke-width="2"/>
    <path d="M2 -48 L2 -3 L24 -3 Z" fill="${P.sail}" stroke="${P.line}" stroke-width="1.3" stroke-linejoin="round"/>
    <path d="M-2 -40 L-2 -3 L-19 -3 Z" fill="${P.sail}" stroke="${P.line}" stroke-width="1.3" stroke-linejoin="round"/>
    <path d="M-25 0 L25 0 L18 8 L-18 8 Z" fill="${P.hull}"/>`;
  g += `<g transform="translate(120 ${(base - 2 - A * 0.5).toFixed(1)}) scale(.62)"><g class="sc-boat" style="--b:${(bob / .62).toFixed(1)}px;--h:${heel.toFixed(0)}deg;--t:${(T * 0.9).toFixed(1)}s">${boat}</g></g>`;
  g += `<g class="sc-wave" style="--L:${L.toFixed(0)}px;--t:${(12 + T).toFixed(1)}s"><path d="${wavePath(W, base + 3, A, L, L / 3)}" fill="url(#se)"/><path d="${wavePath(W, base + 3, A, L, L / 3, false)}" fill="none" stroke="${P.foam}" stroke-width="1.6" stroke-linecap="round" opacity=".85"/></g>`;
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" role="img" aria-label="המחשה: ${esc(seaFeel(r))}">${g}</svg>`;
}

/* ===================== גרף שתי רצועות: רוח ומשבים · גלים ===================== */
function trendChart(target, rows, { sel = null, onPick = null, dimPast = false, lastIsEnd = false } = {}) {
  const el = $(target); if (!el) return;
  if (!rows.length) { el.innerHTML = '<p class="muted">אין נתונים לשעות האלה.</p>'; return; }
  const fs = remPx() / 16;
  const W = Math.max(260, boxWidth(target));
  const left = Math.round(30 * fs), right = 6, plotW = W - left - right;
  const n = rows.length, cw = plotW / n, cx = i => left + cw * (i + 0.5);
  const titleH = Math.round(20 * fs), windH = Math.round(112 * Math.max(1, fs * 0.85)), gapH = 12, waveH = Math.round(64 * Math.max(1, fs * 0.9)), axisH = Math.round(20 * fs);
  const hasRain = rows.some(r => (r.pop ?? 0) >= 30 || (r.rain ?? 0) >= RAIN_MM), rainH = hasRain ? 14 : 0;
  const yW0 = titleH, yV0 = yW0 + windH + gapH + titleH, yR0 = yV0 + waveH + (hasRain ? 8 : 0), yA = yR0 + rainH + 4, H = yA + axisH;
  const gMaxV = Math.max(settings.maxGust, settings.maxWind, ...rows.map(r => r.gust ?? r.wind ?? 0));
  const wTop = Math.ceil((gMaxV + 2) / 5) * 5;
  const wStep = [5, 10, 20].find(st => windH / (wTop / st) >= 15 * fs) || 20;
  const yw = v => yW0 + windH - windH * Math.min(v, wTop) / wTop;
  const vMaxV = Math.max(settings.maxWave * 1.4, ...rows.map(r => r.wave ?? 0));
  const vTop = Math.ceil(vMaxV * 2 + 0.2) / 2;
  const vStep = [0.5, 1, 2].find(st => waveH / (vTop / st) >= 15 * fs) || 2;
  const yv = v => yV0 + waveH - waveH * Math.min(v, vTop) / vTop;
  const nowT = nowLocal();
  const selI = sel == null ? -1 : rows.findIndex(r => r.hour === sel);
  let g = '';
  // רקעים: לילה, שעה נבחרת
  rows.forEach((r, i) => { if (isNight(r)) g += `<rect x="${left + cw * i}" y="${yW0}" width="${cw}" height="${yA - yW0}" style="fill:var(--night)"/>`; });
  if (selI >= 0) g += `<rect x="${left + cw * selI}" y="${yW0 - 2}" width="${cw}" height="${H - yW0 + 2}" rx="4" style="fill:var(--accent-soft)"/>`;
  // רשת וערכי ציר
  for (let v = 0; v <= wTop; v += wStep) g += `<line x1="${left}" x2="${W - right}" y1="${yw(v)}" y2="${yw(v)}" style="stroke:var(--line)" stroke-width="1"/><text x="${left - 6}" y="${yw(v) + 4}" text-anchor="end">${v}</text>`;
  for (let v = 0; v <= vTop + 1e-9; v += vStep) g += `<line x1="${left}" x2="${W - right}" y1="${yv(v)}" y2="${yv(v)}" style="stroke:var(--line)" stroke-width="1"/><text x="${left - 6}" y="${yv(v) + 4}" text-anchor="end">${fmt(v, vStep < 1 ? 1 : 0)}</text>`;
  // כותרות רצועות (בתוך הגרף, צמודות לימין)
  g += `<text x="${W - right}" y="${yW0 - 6}" text-anchor="start" direction="rtl" class="ax">רוח ומשבים · קשר</text>`;
  g += `<text x="${W - right}" y="${yV0 - 6}" text-anchor="start" direction="rtl" class="ax">גלים · מטר</text>`;
  // ספים
  const thr = (y, label) => `<line x1="${left}" x2="${W - right}" y1="${y}" y2="${y}" style="stroke:var(--thr)" stroke-width="1.3" stroke-dasharray="5 4"/><text x="${W - right - 2}" y="${y - 4}" class="thr-l" text-anchor="start" direction="rtl">${label}</text>`;
  g += thr(yw(settings.maxWind), `הסף שלך לרוח: ${settings.maxWind}`);
  if (Math.abs(yw(settings.maxGust) - yw(settings.maxWind)) > 14 * fs) g += thr(yw(settings.maxGust), `למשבים: ${settings.maxGust}`);
  g += thr(yv(settings.maxWave), `הסף שלך: ${settings.maxWave}`);
  // קווי רוח ומשבים – בלי החלקה, עם רווח כשאין נתון
  const poly = k => { const segs = []; let cur = []; rows.forEach((r, i) => { if (r[k] == null) { if (cur.length) segs.push(cur); cur = []; } else cur.push(`${cx(i).toFixed(1)},${yw(r[k]).toFixed(1)}`); }); if (cur.length) segs.push(cur); return segs; };
  poly('gust').forEach(s => { g += `<polyline points="${s.join(' ')}" fill="none" style="stroke:var(--gust)" stroke-width="2" stroke-dasharray="5 3" stroke-linejoin="round"/>`; });
  poly('wind').forEach(s => { g += `<polyline points="${s.join(' ')}" fill="none" style="stroke:var(--wind)" stroke-width="2.5" stroke-linejoin="round"/>`; });
  const bw = Math.min(18, cw * 0.56);
  rows.forEach((r, i) => {
    const v = verdict(r), past = dimPast && r.t.slice(0, 13) < nowT.slice(0, 13);
    const st = v.level === 2 ? 'var(--nogo)' : 'var(--maybe)';
    const over = k => v.over.some(o => o.k === k);
    if (r.wind != null) g += `<circle cx="${cx(i)}" cy="${yw(r.wind)}" r="${over('wind') ? 4.2 : 2.6}" style="fill:${over('wind') ? st : 'var(--wind)'};stroke:var(--surface)" stroke-width="1.2"/>`;
    if (r.gust != null && over('gust')) g += `<circle cx="${cx(i)}" cy="${yw(r.gust)}" r="3.6" style="fill:${st};stroke:var(--surface)" stroke-width="1.2"/>`;
    if (r.wave != null) { const y = yv(r.wave); g += `<rect x="${cx(i) - bw / 2}" y="${y}" width="${bw}" height="${Math.max(1.5, yV0 + waveH - y)}" rx="2" style="fill:${over('wave') ? st : 'var(--wave)'}" opacity="${past ? 0.6 : 0.9}"/>`; }
    if (hasRain) { const p = Math.max(r.pop ?? 0, (r.rain ?? 0) >= RAIN_MM ? 60 : 0); if (p >= 10) g += `<rect x="${cx(i) - cw * 0.42}" y="${yR0}" width="${cw * 0.84}" height="${rainH}" rx="3" style="fill:var(--rain)" opacity="${(0.15 + p / 125).toFixed(2)}"><title>${hm(r.hour)} · סיכוי לגשם ${fmt(r.pop)}%</title></rect>`; }
    if (past) g += `<rect x="${left + cw * i}" y="${yW0}" width="${cw}" height="${yA - yW0}" style="fill:var(--surface)" opacity=".22"/>`;
  });
  if (hasRain) g += `<text x="${left - 6}" y="${yR0 + rainH - 3}" text-anchor="end" style="fill:var(--rain)">גשם</text>`;
  // ציר זמן
  const k = [1, 2, 3, 4, 6].find(k => cw * k >= 24 * fs) || 6;
  rows.forEach((r, i) => {
    const isSel = i === selI, show = isSel || (r.hour % k === 0 && Math.abs(i - selI) * cw >= 22 * fs) || (lastIsEnd && i === n - 1);
    if (show) g += `<text x="${cx(i)}" y="${yA + 14 * fs}" text-anchor="middle" class="ax${isSel ? ' sel' : ''}">${pad2(r.hour)}</text>`;
  });
  const r0 = selI >= 0 ? rows[selI] : null;
  const read = r0 ? `<div class="trend-read" aria-live="polite"><span class="h">${hm(r0.hour)}</span><span>רוח <b>${fmt(r0.wind)}</b></span><span>משבים <b>${fmt(r0.gust)}</b> קשר</span><span>גלים <b>${fmt(r0.wave, 1)}</b> מ׳</span>${(r0.pop ?? 0) >= 10 ? `<span>גשם <b>${fmt(r0.pop)}%</b></span>` : ''}</div>` : '';
  const sw = (c, dash, w = 2.5) => `<svg width="22" height="8" aria-hidden="true"><line x1="1" x2="21" y1="4" y2="4" style="stroke:${c}" stroke-width="${w}"${dash ? ` stroke-dasharray="${dash}"` : ''}/></svg>`;
  el.innerHTML = `${read}
    <svg class="trend-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="גרף רוח, משבים וגלים לפי שעה">${g}</svg>
    <div class="legend"><span>${sw('var(--wind)')}רוח</span><span>${sw('var(--gust)', '5 3', 2)}משבים</span><span><svg width="12" height="12" aria-hidden="true"><rect x="2" y="1" width="8" height="10" rx="1.5" style="fill:var(--wave)"/></svg>גלים</span><span>${sw('var(--thr)', '5 4', 1.5)}הסף שלך</span><span><svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="4.5" style="fill:var(--maybe)"/></svg>מעל הסף</span>${rows.some(isNight) ? '<span><svg width="14" height="12" aria-hidden="true"><rect width="14" height="12" rx="2" style="fill:var(--night-key)"/></svg>רקע מוצל – לילה</span>' : ''}</div>`;
  if (onPick) {
    const svg = el.querySelector('svg.trend-svg');
    svg.addEventListener('click', e => {
      const b = svg.getBoundingClientRect(), x = (e.clientX - b.left) * (W / b.width);
      const i = Math.max(0, Math.min(n - 1, Math.floor((x - left) / cw)));
      onPick(rows[i].hour);
    });
  }
}
function renderTrend() {
  const rows = data.rows.filter(r => r.date === selectedDate && r.hour >= settings.hourFrom && r.hour <= settings.hourTo);
  selectedRow();
  trendChart('trend', rows, { sel: seaHour, onPick: selectHour, dimPast: selectedDate === todayStr() });
}

/* ===================== השבוע: רשימה (ומטריצה מפורטת) ===================== */
function weekDates() { const t = todayStr(); return [...new Set(data.rows.map(r => r.date))].filter(d => d >= t); }
function renderWeekList() {
  $('week-list').innerHTML = weekDates().map(d => {
    const n = dayName(d), hs = heroStatus(d);
    const rows = hs.late ? [] : hs.rows;
    const lvl = hs.late ? 3 : hs.lvl;
    const st = hs.late ? 'היום נגמר' : /^מתאים רק/.test(hs.title) ? hs.title : SHORT[lvl];
    const mx = k => { const v = rows.map(r => r[k]).filter(isNum); return v.length ? Math.max(...v) : null; };
    const mn = k => { const v = rows.map(r => r[k]).filter(isNum); return v.length ? Math.min(...v) : null; };
    const bw = !hs.late && hs.best ? hs.best : null;
    const f = (k, v) => `<span class="f"><small>${k}</small> ${v}</span>`;
    const meta = hs.late ? '<span class="f">הטווח שלך היום הסתיים</span>' :
      f('חלון', bw ? `<b>${span(bw.start, bw.end)}</b>` : 'אין') +
      f('רוח', `<b>${range(mn('wind'), mx('wind'))}</b> קשר`) +
      f('משבים עד', `<b>${fmt(mx('gust'))}</b> קשר`) +
      f('גלים עד', `<b>${fmt(mx('wave'), 1)}</b> מ׳`);
    return `<button class="wk-item lv${lvl}${d === selectedDate ? ' sel' : ''}" data-date="${d}" aria-label="${n.name} ${n.date}: ${st}">
      <span class="wk-ico">${stIco(lvl, 18)}</span>
      <span class="wk-day">${n.name}<small>${n.name === 'היום' || n.name === 'מחר' ? n.sub : n.date}</small></span>
      <span class="wk-st">${st}</span>
      <span class="wk-meta">${meta}</span></button>`;
  }).join('');
  $('week-list').querySelectorAll('.wk-item').forEach(b => b.addEventListener('click', () => { selectDate(b.dataset.date); window.scrollTo({ top: 0, behavior: 'smooth' }); }));
}
function renderWeek() {
  const dates = weekDates();
  const narrow = boxWidth('week-list') < 640;
  const step = narrow ? 2 : 1;
  const hours = []; for (let h = settings.hourFrom; h <= settings.hourTo; h += step) hours.push(h);
  const nowT = nowLocal();
  let html = `<table class="wk"><thead><tr>${hours.map(h => `<th>${pad2(h)}</th>`).join('')}<th class="wl">יום</th></tr></thead><tbody>`;
  for (const d of dates) {
    const byH = new Map(data.rows.filter(r => r.date === d).map(r => [r.hour, r]));
    const n = dayName(d);
    html += `<tr data-date="${d}" class="${d === selectedDate ? 'sel' : ''}">` + hours.map(h => {
      const r = byH.get(h);
      if (!r || r.wind == null) return '<td class="empty"></td>';
      const v = verdict(r);
      const past = r.t.slice(0, 13) < nowT.slice(0, 13) ? ' past' : '';
      const inTrip = trips.some(t => t.date === d && h >= t.from && h < t.to) ? ' trip-cell' : '';
      return `<td class="lv${v.level}${isNight(r) ? ' night' : ''}${past}${inTrip}" title="${pad2(h)}:00 · ${VERDICT[v.level].t} · רוח ${fmt(r.wind)} משבים ${fmt(r.gust)} קשר ${from8(r.dir)} · גלים ${fmt(r.wave, 1)} מ׳${v.reasons.length ? ' · ' + v.reasons.join(', ') : ''}">${arrowTxt(r.dir)}${fmt(r.wind)}</td>`;
    }).join('') + `<td class="wl">${n.name}<small>${n.date}</small></td></tr>`;
  }
  $('week').innerHTML = html + '</tbody></table>';
  $('week').querySelectorAll('tr[data-date]').forEach(tr => {
    const open = () => { selectDate(tr.dataset.date); window.scrollTo({ top: 0, behavior: 'smooth' }); };
    tr.tabIndex = 0; tr.setAttribute('role', 'button');
    tr.setAttribute('aria-label', 'פתח את ' + tr.querySelector('.wl').firstChild.textContent);
    tr.addEventListener('click', open);
    tr.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  });
}

/* ===================== נתונים ===================== */
let modelsOpen = false;
function renderSummaryRow() {
  const hs = heroStatus(selectedDate);
  const s = daySummary(selectedDate);
  const n = dayName(selectedDate);
  const lvl = hs.late ? 3 : hs.lvl;
  const title = hs.late ? 'היום כבר נגמר' : hs.title;
  const sunset = s.sun ? s.sun.sunset.slice(11) : null;
  const chip = (k, v, u = '') => `<span class="chip">${k} <b>${bdi(v)}</b>${u}</span>`;
  $('summary').innerHTML = `${pill(lvl, title)}<span class="chip">${n.full}</span><span class="sep" aria-hidden="true"></span>
    ${chip('רוח עד', fmt(s.maxWind), ' קשר')}${chip('משבים עד', fmt(s.maxGust), ' קשר')}${chip('גלים עד', fmt(s.maxWave, 1), ' מ׳')}
    ${sunset ? chip('שקיעה', sunset) : ''}${isNum(s.sst) ? chip('מים', fmt(s.sst) + '°') : ''}
    ${s.thunder ? `<span class="pill lv2">${ico('cloud-lightning', 16)}רעמים</span>` : ''}`;
}
function renderTable() {
  if (!data) return;
  const rows = dayRows(selectedDate);
  if (!rows.length) { $('table-wrap').innerHTML = '<div class="loading">אין נתונים ליום הזה</div>'; return; }
  selectedRow();
  const cols = rows.length;
  const cell = (r, inner, cls = '', title = '') => `<td class="${cls}${isNight(r) ? ' night' : ''}${r.hour === seaHour ? ' sel' : ''}" data-h="${r.hour}"${title ? ` title="${esc(title)}"` : ''}>${inner}</td>`;
  const row = (label, fn, cls = '') => `<tr class="${cls}"><th class="lbl" scope="row">${label}</th>${rows.map(r => fn(r)).join('')}</tr>`;
  const grp = label => `<tr class="grp"><th class="lbl" scope="rowgroup">${label}</th><td colspan="${cols}"></td></tr>`;
  const ov = (r, k) => { const v = verdict(r); return v.over.some(o => o.k === k) ? ` ov${v.level === 2 ? 2 : 1}` : ''; };
  let h = `<table class="fc"><thead><tr><th class="lbl">שעה</th>${rows.map(r => `<th class="${isNight(r) ? 'night' : ''}${r.hour === seaHour ? ' sel' : ''}" data-h="${r.hour}" scope="col">${pad2(r.hour)}</th>`).join('')}</tr></thead><tbody>`;
  h += row('מצב', r => { const v = verdict(r); return cell(r, stIco(v.level, 16), `vc lv${v.level}`, `${VERDICT[v.level].t}${v.reasons.length ? ' – ' + v.reasons.join(', ') : ''}`); });
  h += grp('רוח');
  h += row('רוח (קשר)', r => cell(r, fmt(r.wind), ov(r, 'wind')));
  h += row('משבים (קשר)', r => cell(r, fmt(r.gust), ov(r, 'gust')));
  h += row('כיוון רוח', r => cell(r, `${arrowTxt(r.dir)}<span class="sub">${compass(r.dir)}</span>`, '', r.dir != null ? `נושבת ${from8(r.dir)} (${Math.round(r.dir)}°)` : ''));
  if (settings.showModels && data.hasModels) {
    h += `<tr class="mtoggle"><th class="lbl"><button class="btn quiet" id="models-toggle" aria-expanded="${modelsOpen}">${ico('chevron-down', 16)}${modelsOpen ? 'הסתר' : 'הצג'} השוואת מודלים</button></th><td colspan="${cols}"></td></tr>`;
    if (modelsOpen) for (const m of MODELS) h += row(`${m.name} · רוח/משב`, r => { const v = r.models[m.name]; return cell(r, v ? `${fmt(v.wind)}<span class="sub">/${fmt(v.gust)}</span>` : '–'); }, 'mrow');
  }
  h += grp('ים');
  h += row('<span title="גובה גל משמעותי: הממוצע של השליש הגבוה מהגלים">גלים (מ׳)</span>', r => cell(r, fmt(r.wave, 1), ov(r, 'wave')));
  h += row('מחזור (שנ׳)', r => cell(r, fmt(r.wavePer, 1), (r.wavePer != null && r.wavePer < settings.minPeriod && (r.wave ?? 0) >= settings.maxWave * 0.7) ? ' ov1' : ''));
  h += row('כיוון גלים', r => cell(r, `${arrowTxt(r.waveDir)}<span class="sub">${compass(r.waveDir)}</span>`));
  h += row('גלי רוח (מ׳ · שנ׳)', r => cell(r, r.ww == null ? '–' : `${fmt(r.ww, 1)}<span class="sub">${fmt(r.wwPer, 1)}</span>`));
  h += row('סוול (מ׳ · שנ׳)', r => cell(r, r.sw == null ? '–' : `${fmt(r.sw, 1)}<span class="sub">${fmt(r.swPer, 1)}</span>`));
  h += row('מים (°C)', r => cell(r, fmt(r.sst, 1)));
  h += grp('מזג אוויר');
  h += row('שמיים', r => cell(r, wxIco(r.code, isNight(r)), '', WX_NAME(r.code)));
  h += row('טמפרטורה (°C)', r => cell(r, fmt(r.temp)));
  h += row(`<span title="${data.hasEnsemble ? `אחוז מתוך ${data.ensembleN} הרצות שצופות לפחות 0.5 מ&quot;מ בשעה` : 'הסתברות לגשם'}">גשם (% · מ"מ)</span>`, r => cell(r, (r.pop ?? 0) < 10 && (r.rain ?? 0) < 0.1 ? '<span class="sub">–</span>' : `${fmt(r.pop)}<span class="sub">${fmt(r.rain, 1)}</span>`, (r.pop ?? 0) >= 50 ? ' ov1' : ''));
  if (data.hasEnsemble) h += row('טפטוף (%)', r => cell(r, (r.drizzle ?? 0) < 10 ? '<span class="sub">–</span>' : fmt(r.drizzle)));
  h += row('לחץ (hPa)', r => cell(r, fmt(r.pres)));
  h += row('ראות (ק"מ)', r => cell(r, r.vis == null ? '–' : r.vis >= 20000 ? '20+' : fmt(r.vis / 1000, 1), r.vis != null && r.vis < 4000 ? ' ov1' : ''));
  $('table-wrap').innerHTML = h + '</tbody></table>';
  const t = $('table-wrap').querySelector('table');
  t.addEventListener('click', e => { const c = e.target.closest('[data-h]'); if (c) selectHour(+c.dataset.h); });
  const mt = $('models-toggle'); if (mt) mt.addEventListener('click', e => { e.stopPropagation(); modelsOpen = !modelsOpen; renderTable(); $('models-toggle')?.focus(); });
  // השעה הנבחרת נראית בתוך הגלילה; הרמז להחלקה מוצג רק כשיש מה לגלול
  const sel = t.querySelector('thead th.sel'), w = $('table-wrap');
  document.querySelector('.swipe-hint .swipe').classList.toggle('hidden', !$('table-view').classList.contains('hidden') && w.scrollWidth <= w.clientWidth + 2);
  if (sel) { const lw = t.querySelector('.lbl').offsetWidth, a = sel.getBoundingClientRect(), b = w.getBoundingClientRect(); if (a.left < b.left + lw + 4 || a.right > b.right - 4) w.scrollLeft += (a.left + a.width / 2) - (b.left + lw + (b.width - lw) / 2); }
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
function checklist(rows, s) {
  const items = [['life-buoy', 'חגורות הצלה ותדריך בטיחות לאורחים'], ['radio', 'VHF פתוח על ערוץ 16']];
  if (s.gMax >= 22 || s.wMax >= 16) items.push(['sailboat', 'לקשור ריף כבר בנמל – קל יותר מאשר בים']);
  if (s.wvMax >= 1 || (s.wvMax >= 0.7 && s.per < 5)) items.push(['pill', 'כדורים נגד בחילה לאורחים, לקבע ציוד בקבינה']);
  if (s.wet) items.push(['cloud-rain', 'מעילי גשם / ביגוד סערה']);
  if (s.tMax >= 26) items.push(['sun', 'קרם הגנה, כובעים ומים']);
  if (s.tMin != null && s.tMin < 18) items.push(['shirt', 'ביגוד חם – קר יותר בים']);
  if (s.afterSunset) items.push(['flashlight', 'אורות ניווט ופנס – החזרה אחרי השקיעה']);
  if (s.thunder) items.push(['cloud-lightning', 'לעקוב אחרי מכ"ם ברקים ולהישאר קרוב לנמל']);
  if (s.offshore) items.push(['navigation', 'רוח יבשה: הדרך חזרה למרינה תהיה נגד הרוח – לתכנן זמן']);
  return items;
}

function compassSvg(rows, course) {
  const S = 170, C = S / 2, R = 66;
  let g = `<circle cx="${C}" cy="${C}" r="${R}" style="fill:var(--surface-2);stroke:var(--line)"/>`;
  const coast = 20 * Math.PI / 180; // החוף נמתח בערך 20°↔200°, היבשה ממזרח
  const p1 = [C + Math.sin(coast) * R, C - Math.cos(coast) * R], p2 = [C - Math.sin(coast) * R, C + Math.cos(coast) * R];
  g += `<path d="M${p1[0]},${p1[1]} A${R},${R} 0 0 1 ${p2[0]},${p2[1]} Z" style="fill:color-mix(in srgb, #c9a46a 28%, var(--surface-2))"/>`;
  g += `<text x="${C + 40}" y="${C + 4}" font-size="11" style="fill:var(--ink-2)" text-anchor="middle">יבשה</text>`;
  g += `<text x="${C - 38}" y="${C + 4}" font-size="11" style="fill:var(--wave)" text-anchor="middle">ים</text>`;
  g += `<circle cx="${C + 4}" cy="${C}" r="4.5" style="fill:var(--trip)"/>`;
  [['N', 0], ['E', 90], ['S', 180], ['W', 270]].forEach(([t, d]) => { const a = d * Math.PI / 180; g += `<text x="${C + Math.sin(a) * (R + 10)}" y="${C - Math.cos(a) * (R + 10) + 4}" font-size="12" font-weight="700" style="fill:var(--ink)" text-anchor="middle">${t}</text>`; });
  const maxW = Math.max(12, ...rows.map(r => r.wind ?? 0));
  rows.forEach(r => {
    if (r.dir == null) return;
    const a = r.dir * Math.PI / 180, len = 14 + 34 * (r.wind ?? 0) / maxW;
    g += `<line x1="${C + Math.sin(a) * R}" y1="${C - Math.cos(a) * R}" x2="${C + Math.sin(a) * (R - len)}" y2="${C - Math.cos(a) * (R - len)}" style="stroke:var(--wind)" stroke-width="2.5" stroke-linecap="round" opacity=".75" marker-end="url(#ah)"/>`;
  });
  const wd = rows.map(r => r.waveDir).filter(v => v != null);
  if (wd.length) {
    let x = 0, y = 0; wd.forEach(d => { x += Math.sin(d * Math.PI / 180); y += Math.cos(d * Math.PI / 180); });
    const a = Math.atan2(x, y);
    g += `<path d="M${C + Math.sin(a) * (R + 2)},${C - Math.cos(a) * (R + 2)} L${C + Math.sin(a) * (R - 20)},${C - Math.cos(a) * (R - 20)}" style="stroke:var(--wave)" stroke-width="2.2" stroke-dasharray="3 2" marker-end="url(#aw)"/>`;
  }
  if (course !== '') { const a = (+course) * Math.PI / 180; g += `<line x1="${C}" y1="${C}" x2="${C + Math.sin(a) * (R - 6)}" y2="${C - Math.cos(a) * (R - 6)}" style="stroke:var(--trip)" stroke-width="2.8" marker-end="url(#ac)"/>`; }
  return `<svg viewBox="0 0 ${S} ${S}" width="${S}" height="${S}" role="img" aria-label="מצפן: כיווני הרוח והגלים לאורך ההפלגה">
    <defs>
      <marker id="ah" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="4" markerHeight="4" orient="auto"><path d="M0,0 L10,5 L0,10 Z" style="fill:var(--wind)"/></marker>
      <marker id="aw" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L10,5 L0,10 Z" style="fill:var(--wave)"/></marker>
      <marker id="ac" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L10,5 L0,10 Z" style="fill:var(--trip)"/></marker>
    </defs>${g}</svg>`;
}

function planText(p, rows, s, lvl) {
  const n = dayName(p.date);
  const course = COURSES.find(c => c.v === p.course)?.t || '';
  return [
    `⛵ הפלגה ממרינה הרצליה – ${n.full}, ⁦${hm(p.from)}–${p.to === 24 ? '24:00' : hm(p.to)}⁩${p.course ? ' · ' + course : ''}`,
    `${['✅ מתאים להפלגה', '⚠️ אפשר, אבל בזהירות', '⛔ לא מומלץ להפליג', '❔ אין מספיק נתונים להמלצה'][lvl]}`,
    `🌬️ רוח ${from8(s.md)} ${range(s.wMin, s.wMax)} קשר, משבים עד ${fmt(s.gMax)}`,
    `🌊 גלים ${range(s.wvMin, s.wvMax, 1)} מ', מחזור ${fmt(s.per)} שנ' – ${seaText(s.wvMax ?? 0)}`,
    `${s.wet ? '🌧️' : '☀️'} ${s.rainT} · ${range(s.tMin, s.tMax)}°C · מים ${fmt(s.sst)}°C`,
    `⛵ ${sailAdvice(s.wMax, s.gMax).t}`,
    `(תחזית Open-Meteo · עודכן ${new Date(data.fetchedAt).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: TZ })})`
  ].join('\n');
}

function fillPlanForm() {
  const dates = weekDates();
  if (!plan.date || !dates.includes(plan.date)) plan.date = selectedDate && dates.includes(selectedDate) ? selectedDate : dates[0];
  $('p-date').innerHTML = dates.map(d => `<option value="${d}">${dayName(d).full}</option>`).join('');
  $('p-from').innerHTML = [...Array(24).keys()].map(h => `<option value="${h}">${hm(h)}</option>`).join('');
  $('p-to').innerHTML = [...Array(24).keys()].map(h => h + 1).map(h => `<option value="${h}">${h === 24 ? '24:00' : hm(h)}</option>`).join('');
  $('p-course').innerHTML = COURSES.map(c => `<option value="${c.v}">${c.t}</option>`).join('');
  $('p-date').value = plan.date; $('p-from').value = plan.from; $('p-to').value = plan.to; $('p-course').value = plan.course;
}
const tripSaved = () => trips.some(t => t.date === plan.date && t.from === plan.from && t.to === plan.to);
function renderTrips() {
  const sec = $('p-saved').closest('section');
  sec.classList.toggle('hidden', !trips.length);
  $('p-saved').innerHTML = trips.map((t, i) => {
    const rows = planRows(t);
    const lvl = rows.length ? planVerdict(rows) : 3;
    const active = t.date === plan.date && t.from === plan.from && t.to === plan.to ? ' active' : '';
    return `<span class="trip${active}" data-i="${i}" role="button" tabindex="0"><span class="dot lv${lvl}"></span>${dayName(t.date).name} ${span(t.from, t.to)}<button class="x" data-del="${i}" aria-label="מחק הפלגה שמורה">${ico('x', 16)}</button></span>`;
  }).join('');
  $('p-saved').querySelectorAll('.trip').forEach(el => {
    const open = e => { if (e.target.closest('[data-del]')) return; plan = { ...trips[+el.dataset.i] }; fillPlanForm(); store.set('local', 'plan_v1', plan); renderPlan(); };
    el.addEventListener('click', open);
    el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(e); } });
  });
  $('p-saved').querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async e => {
    e.stopPropagation(); trips.splice(+b.dataset.del, 1); await store.set('sync', 'trips_v1', trips); renderPlan(); renderWeek();
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
  const n = dayName(plan.date);
  if (!rows.length || rows.every(r => r.placeholder)) { out.innerHTML = '<div class="notice">אין תחזית לטווח הזה.</div>'; return; }
  if (rows[rows.length - 1].t.slice(0, 13) < nowT.slice(0, 13)) {
    const dates = [...new Set(data.rows.map(r => r.date))];
    const next = dates[dates.indexOf(plan.date) + 1];
    out.innerHTML = `<div class="notice"><span>השעות ${span(plan.from, plan.to)} של ${n.full} כבר עברו.</span>
      ${next ? `<button id="p-next" class="btn primary">לבדוק את אותן שעות ${whenWords(next) === 'מחר' ? 'מחר' : whenWords(next)}</button>` : ''}</div>`;
    if (next) $('p-next').addEventListener('click', () => { plan = { ...plan, date: next }; fillPlanForm(); store.set('local', 'plan_v1', plan); renderPlan(); });
    return;
  }
  const vals = k => rows.map(r => r[k]).filter(isNum);
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
  const reasons = reasonsByHour(rows, true);
  const extraWarn = [];
  if (s.afterSunset) extraWarn.push(`החזרה אחרי השקיעה (${bdi(sun.sunset.slice(11))})`);
  if (s.beforeSunrise) extraWarn.push(`היציאה לפני הזריחה (${bdi(sun.sunrise.slice(11))})`);
  if (daySummary(plan.date).maxDrop >= 3) extraWarn.push('ירידת לחץ חדה ביום הזה');
  const conf = modelConfidence(rows);
  const dep = rows[0], ret = rows[rows.length - 1];
  const segs = sailPlanSegments(rows, true);
  const alts = lvl > 0 ? findAlternatives(plan) : [];
  const dur = plan.to - plan.from;
  const saved = tripSaved();

  // מדדים: ערך מרבי מול הסף
  const lvM = lvl === 2 ? 2 : 1;
  const wOver = s.wMax != null && s.wMax > settings.maxWind, gOver = s.gMax != null && s.gMax > settings.maxGust, vOver = s.wvMax != null && s.wvMax > settings.maxWave;
  const metrics = `<div class="metrics">
    ${metric({ icon: 'wind', label: 'רוח', value: range(s.wMin, s.wMax), unit: 'קשר', dir: md, sub: wOver ? `מעל הסף שלך: ${settings.maxWind}` : '', over: wOver, lvl: lvM })}
    ${metric({ icon: 'gauge', label: 'משבים', value: fmt(s.gMax), unit: 'קשר', sub: gOver ? `מעל הסף שלך: ${settings.maxGust}` : 'לכל היותר', over: gOver, lvl: lvM })}
    ${metric({ icon: 'waves', label: 'גלים', value: range(s.wvMin, s.wvMax, 1), unit: 'מטר', sub: vOver ? `מעל הסף שלך: ${settings.maxWave}` : (s.per != null ? `מחזור ${fmt(s.per)} שנ׳` : ''), over: vOver, lvl: lvM })}
  </div>`;
  const problems = reasons.concat(extraWarn);
  const why = problems.length ? problems.slice(0, 3).join(' · ') : 'כל השעות, כולל שעת החזרה, בתוך הספים <button type="button" class="linkish" data-open-settings>שהגדרת</button>';
  const actions = `<button id="p-save" class="btn"${saved ? ' aria-pressed="true"' : ''}>${ico(saved ? 'bookmark-check' : 'bookmark', 18)}${saved ? 'נשמרה' : 'שמור הפלגה'}</button>
    <button id="p-copy" class="btn">${ico('share-2', 18)}שתף סיכום</button><span id="p-copied" class="copied" role="status"></span>`;
  const altHtml = alts.length ? `<div class="alts"><span class="muted">זמנים טובים יותר באותו אורך:</span>${alts.map(a => `<button class="btn alt" data-d="${a.date}" data-f="${a.from}" data-t="${a.to}">${dayName(a.date).name} ${span(a.from, a.to)}</button>`).join('')}</div>`
    : (lvl > 0 ? '<p class="note">לא נמצא זמן מתאים באותו אורך ב-7 הימים הקרובים.</p>' : '');
  // שינוי בין יציאה לחזרה – מחושב מהערכים המעוגלים שמוצגים, כדי ש-12 ← 7 לא יוצג כ"ירידה של 6"
  const chg = (a, b, d, unit) => {
    if (a == null || b == null) return '';
    const ra = +fmt(a, d), rb = +fmt(b, d), x = +(rb - ra).toFixed(d);
    if (Math.abs(x) < (d ? 0.15 : 2)) return '<small>ללא שינוי משמעותי</small>';
    return `<small class="${x > 0 ? 'up' : 'down'}">${x > 0 ? 'עולה ב-' : 'יורד ב-'}${bdi(fmt(Math.abs(x), d))} ${unit}</small>`;
  };
  // זווית ההפלגה בפועל: לפי המסלול שנבחר, או לכל כיוון נפוץ – מחושב מכיוון הרוח
  let legs;
  if (plan.course !== '' && dep.dir != null && ret.dir != null) {
    const o1 = pointOfSail(dep.dir, +plan.course), b1 = pointOfSail(ret.dir, (+plan.course + 180) % 360);
    legs = `<ul class="legs"><li><span class="muted">בדרך החוצה (רוח ${from8(dep.dir)}):</span> <b style="color:${o1.c}">${o1.t}</b></li><li><span class="muted">בדרך חזרה (רוח ${from8(ret.dir)}):</span> <b style="color:${b1.c}">${b1.t}</b></li></ul>`;
  } else if (md != null) {
    legs = `<p class="legs-h">זווית ההפלגה לפי כיוון הרוח הממוצע (${from8(md)}):</p><ul class="legs">${courseNotes(md).map(c => `<li><span class="muted">${c.t}:</span> <b style="color:${c.p.c}">${c.p.t}</b></li>`).join('')}</ul>`;
  } else legs = '';
  const ph = r => r.placeholder ? '<small>אין תחזית</small>' : '';
  // משך בתוך חלון מתאים – כשהגענו מ"תכנן הפלגה בחלון הזה"
  const w = plan.win && plan.date && plan.from >= plan.win.start && plan.from < plan.win.end ? plan.win : null;
  let durHtml = '';
  if (w) {
    const max = w.end - plan.from, opts = [...new Set([2, 3, 4, 6].filter(d => d < max).concat(max))];
    durHtml = `<div class="dur" role="group" aria-label="משך ההפלגה בתוך החלון"><span class="pick-l">משך בתוך החלון ${span(w.start, w.end)}:</span>${opts.map(d => `<button class="chip${plan.to - plan.from === d ? ' on' : ''}" data-dur="${d}" aria-pressed="${plan.to - plan.from === d}">${d === max ? 'עד סוף החלון' : hoursTxt(d)}</button>`).join('')}</div>`;
  }
  const tripLine = `<div class="trip-line"><span>${ico('compass', 16)}<b>${n.full}</b></span><span>יציאה <b>${bdi(hm(plan.from))}</b></span><span>חזרה <b>${bdi(plan.to === 24 ? '24:00' : hm(plan.to))}</b></span><span class="muted">${hoursTxt(dur)}</span></div>`;

  out.innerHTML = `
    ${durHtml}
    <div class="p-top">
      ${decisionCard({ lvl, scope: tripLine, title: VERDICT[lvl].long, why, actions, extra: altHtml, basis: problems.length > 0 })}
      <section class="card p-metrics" aria-label="רוח, משבים וגלים לאורך ההפלגה">${metrics}</section>
    </div>
    <div class="p-grid">
      <section class="card p-sec" aria-labelledby="pd-title">
        <h2 class="sec-h" id="pd-title">${ico('sailboat', 18)}יציאה וחזרה</h2>
        <table class="dr"><thead><tr><th></th><th>ביציאה · ${bdi(hm(dep.hour))}</th><th>בחזרה · ${bdi(hm(ret.hour))}</th></tr></thead><tbody>
          <tr><th scope="row">רוח</th><td data-l="ביציאה"><b>${fmt(dep.wind)}</b> קשר<small>${from8(dep.dir)}</small>${ph(dep)}</td><td data-l="בחזרה"><b>${fmt(ret.wind)}</b> קשר<small>${from8(ret.dir)}</small>${chg(dep.wind, ret.wind, 0, 'קשר')}${ph(ret)}</td></tr>
          <tr><th scope="row">משבים</th><td data-l="ביציאה"><b>${fmt(dep.gust)}</b> קשר</td><td data-l="בחזרה"><b>${fmt(ret.gust)}</b> קשר${chg(dep.gust, ret.gust, 0, 'קשר')}</td></tr>
          <tr><th scope="row">גלים</th><td data-l="ביציאה"><b>${fmt(dep.wave, 1)}</b> מ׳<small>${dep.wavePer != null ? 'מחזור ' + fmt(dep.wavePer) + ' שנ׳' : ''}</small></td><td data-l="בחזרה"><b>${fmt(ret.wave, 1)}</b> מ׳${chg(dep.wave, ret.wave, 1, 'מ׳')}</td></tr>
          <tr><th scope="row">שמיים</th><td data-l="ביציאה">${wxIco(dep.code, isNight(dep), 18)} ${fmt(dep.temp)}°</td><td data-l="בחזרה">${wxIco(ret.code, isNight(ret), 18)} ${fmt(ret.temp)}°</td></tr>
        </tbody></table>
        ${legs}
        ${md != null ? `<p class="note">${ico('compass', 16)}<span>${coastNote(md)}</span></p>` : ''}
      </section>
      <section class="card p-sec" aria-labelledby="pc-title">
        <h2 class="sec-h" id="pc-title">${ico('circle-check', 18)}לפני היציאה</h2>
        <ul class="checklist">${checklist(rows, s).map(([i, t]) => `<li>${ico(i, 18)}<span>${t}</span></li>`).join('')}</ul>
      </section>
      <section class="card p-sec wide" aria-labelledby="pw-title">
        <h2 class="sec-h" id="pw-title">${ico('route', 18)}התנאים בדרך</h2>
        <div id="p-trend"></div>
        <div class="seg-list" aria-label="המלצת מפרשים">${segs.map(sg => `<div><span class="t">${bdi(sg.label)}</span><span>${lvl > 0 ? sg.t.replace(' – רוח טובה להפלגה', '') : sg.t}</span></div>`).join('')}</div>
        <p class="note">${wxIco(dep.code, isNight(dep), 16)}<span>${s.rainT} · ${range(s.tMin, s.tMax)}° · מים ${fmt(s.sst)}° · ${comfortText(s.wvMax, s.per)}</span></p>
        <p class="note">${ico('info', 16)}<span>המלצת המפרשים היא הערכה כללית ליאכטה של 12 מ׳ – תלויה בסירה ובצוות.</span></p>
      </section>
      <section class="card wide p-more">
        ${conf ? `<details class="more"><summary>השוואת מודלים · ${conf.label}: ${conf.t}</summary><div class="inner"><p style="margin:0">${conf.d}</p></div></details>` : ''}
        <details class="more" id="route-details"><summary>מצפן המסלול: רוח, גלים וכיוון ההפלגה</summary>
          <div class="inner p-compass">${compassSvg(rows, plan.course)}
            <div class="legend" style="flex-direction:column"><span><svg width="22" height="8"><line x1="1" x2="21" y1="4" y2="4" style="stroke:var(--wind)" stroke-width="2.5"/></svg>רוח (מאיפה נושבת, לפי שעה)</span><span><svg width="22" height="8"><line x1="1" x2="21" y1="4" y2="4" style="stroke:var(--wave)" stroke-width="2.2" stroke-dasharray="3 2"/></svg>כיוון הגלים</span>${plan.course !== '' ? '<span><svg width="22" height="8"><line x1="1" x2="21" y1="4" y2="4" style="stroke:var(--trip)" stroke-width="2.8"/></svg>המסלול שלך</span>' : ''}</div>
          </div></details>
      </section>
    </div>`;

  out.querySelectorAll('[data-dur]').forEach(b => b.addEventListener('click', () => {
    plan = { ...plan, to: plan.from + +b.dataset.dur }; fillPlanForm(); store.set('local', 'plan_v1', plan); renderPlan();
  }));
  trendChart('p-trend', rows, { lastIsEnd: true });
  out.querySelectorAll('.alt').forEach(b => b.addEventListener('click', () => {
    plan = { ...plan, date: b.dataset.d, from: +b.dataset.f, to: +b.dataset.t }; fillPlanForm(); store.set('local', 'plan_v1', plan); renderPlan();
  }));
  $('p-save').addEventListener('click', async () => {
    if (tripSaved()) trips = trips.filter(t => !(t.date === plan.date && t.from === plan.from && t.to === plan.to));
    else { track('plan-save'); trips.push({ ...plan }); trips.sort((a, b) => (a.date + pad2(a.from)) < (b.date + pad2(b.from)) ? -1 : 1); }
    await store.set('sync', 'trips_v1', trips);
    renderPlan(); renderWeek(); $('p-save').focus();
  });
  $('p-copy').addEventListener('click', async () => {
    const txt = planText(plan, rows, s, lvl);
    track('plan-copy');
    if (navigator.share && matchMedia('(pointer: coarse)').matches) { try { await navigator.share({ text: txt }); return; } catch (_) { /* בוטל – ממשיכים להעתקה */ } }
    try { await navigator.clipboard.writeText(txt); }
    catch (_) { const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
    $('p-copied').textContent = 'הסיכום הועתק – אפשר להדביק בוואטסאפ';
  });
}

function onPlanChange() {
  const date = $('p-date').value, from = +$('p-from').value;
  // החלון נשמר כל עוד היציאה בתוכו, באותו יום
  const win = plan.win && plan.date === date && from >= plan.win.start && from < plan.win.end ? plan.win : undefined;
  plan = { date, from, to: +$('p-to').value, course: $('p-course').value, win };
  if (plan.to <= plan.from) { plan.to = Math.min(24, plan.from + 1); $('p-to').value = plan.to; }
  store.set('local', 'plan_v1', plan);
  renderPlan();
}

/* ===================== הכול ===================== */
function renderIntro() {
  $('intro').innerHTML = `<p><b>תחזית ים למרינה הרצליה:</b> האם מתאים לצאת להפליג, ומה תפגוש בים.</p>
    <div class="legend-v"><span class="lv0">${pill(0, 'מתאים')}</span><span>${pill(1, 'בזהירות')}</span><span>${pill(2, 'לא מומלץ')}</span></div>
    <details class="intro-more"><summary>עוד הסבר</summary>
    <p>מתאים כשהרוח עד ${settings.maxWind} קשר, המשבים עד ${settings.maxGust} והגלים עד ${settings.maxWave} מ׳. אפשר לשנות בהגדרות.</p>
    <p>כל הנתונים הם תחזית ולא מדידה. גובה הגלים הוא "גובה גל משמעותי" (ממוצע השליש הגבוה) – גלים בודדים יכולים להיות גבוהים יותר. הציור להמחשה בלבד.</p></details>`;
}
function renderAll() {
  if (!data) return;
  renderIntro();
  $('loading').classList.add('hidden');
  renderDays();
  renderDecision();
  renderHourCard();
  renderWindow();
  renderTrend();
  renderWeekList();
  renderWeek();
  renderSummaryRow();
  renderTable();
  renderPlan();
  renderUpdated();
}

function renderUpdated() {
  if (!data) return;
  const t = new Date(data.fetchedAt), age = Date.now() - data.fetchedAt;
  const clock = t.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
  $('updated').textContent = `התחזית נמשכה ${ageText(age)} (${clock})` + (age > 3 * 3600e3 ? ' · לא עדכני' : '');
  $('updated').classList.toggle('stale', age > 3 * 3600e3);
}
function showBanner(msg, isError) {
  const b = $('banner');
  if (!msg) { b.classList.add('hidden'); return; }
  b.textContent = msg;
  b.classList.toggle('error', !!isError);
  b.classList.remove('hidden');
}

/* ===================== טעינה ===================== */
let loadingNow = false;
async function load(force) {
  if (loadingNow) return;
  loadingNow = true;
  const btn = $('refresh-btn');
  btn.disabled = true; btn.classList.add('spin');
  const cacheKey = 'cache_v5';
  const cached = await store.get('local', cacheKey);
  const sameLoc = cached && cached.loc === locKey();
  if (cached && sameLoc && !data) { data = cached.data; renderAll(); }

  if (!force && cached && sameLoc && Date.now() - cached.data.fetchedAt < CACHE_MAX_AGE) {
    showBanner(cached.data.errors?.join(' · '), false);
    btn.disabled = false; btn.classList.remove('spin'); loadingNow = false;
    return;
  }
  try {
    data = await fetchAll(core => { data = core; renderAll(); });
    await store.set('local', cacheKey, { loc: locKey(), data });
    showBanner(data.errors.join(' · '), false);
    renderAll();
  } catch (e) {
    if (data) showBanner(`אין חיבור – מוצג מידע שמור. (${e.message})`, true);
    else { showBanner(`שגיאה בטעינת התחזית: ${e.message}`, true); $('loading').textContent = 'לא הצלחתי לטעון תחזית.'; }
  } finally {
    btn.disabled = false; btn.classList.remove('spin'); loadingNow = false;
  }
}
const locKey = () => [settings.windLat, settings.windLon, settings.waveLat, settings.waveLon].join(',');

/* ===================== מפה (Windy) ===================== */
let windyOverlay = 'wind';
// הערה: בהטמעה של Windy חייבים product=ecmwf. Windy בוחר בעצמו את מודל הגלים לשכבות גלים/סוול.
// (product=ecmwfWaves בכתובת גורם למפה להתעלם מהשכבה ולהציג רוח – נבדק בתוך המפה עצמה)
const WINDY_LAYERS = { wind: 'רוח', gust: 'משבים', waves: 'גלים', swell1: 'סוול' };
function windyUrl(overlay = windyOverlay) {
  const s = settings;
  return `https://embed.windy.com/embed2.html?lat=${s.windLat}&lon=${s.windLon - 0.25}&detailLat=${s.windLat}&detailLon=${s.windLon}` +
    `&width=776&height=470&zoom=9&level=surface&overlay=${overlay}&product=ecmwf&menu=&message=true&marker=true` +
    `&calendar=now&pressure=true&type=map&location=coordinates&detail=&metricWind=kt&metricTemp=%C2%B0C&radarRange=-1`;
}
// קישור לפתיחה באתר המלא של Windy, באותה שכבה
const windyFull = (overlay = windyOverlay) => `https://www.windy.com/-${overlay === 'swell1' ? 'Swell-swell1' : overlay === 'waves' ? 'Waves-waves' : overlay === 'gust' ? 'Wind-gusts-gust' : 'Wind-wind'}?${overlay},${settings.windLat},${settings.windLon},10`;
function windyTimeout() {
  setTimeout(() => {
    const w = $('windy-wrap');
    if (!w.classList.contains('loaded')) w.querySelector('.windy-loading').innerHTML = 'המפה לא נטענה. <a href="https://www.windy.com/32.165/34.785?32.165,34.785,10" target="_blank" rel="noopener">פתחו ב-Windy</a>';
  }, 15000);
}
// המפה ממלאת את הגובה שנשאר מעל סרגל הניווט
function fitWindy() {
  const w = $('windy-wrap'); if (!w || $('windy-view').classList.contains('hidden')) return;
  const nav = $('view-tabs'), navH = getComputedStyle(nav).position === 'fixed' ? nav.offsetHeight : 0;
  const top = w.getBoundingClientRect().top + window.scrollY;
  w.style.height = Math.max(320, window.innerHeight - top - navH - 12) + 'px';
}

/* ===================== מעבר בין מסכים ===================== */
const VIEWS = ['brief', 'plan', 'table', 'windy'];
let curView = 'brief';
const scrollMem = {};
function showView(v) {
  if (v !== curView) scrollMem[curView] = window.scrollY;
  VIEWS.forEach(k => {
    $(k + '-view').classList.toggle('hidden', v !== k);
    $('view-' + k).classList.toggle('active', v === k);
    if (v === k) $('view-' + k).setAttribute('aria-current', 'page'); else $('view-' + k).removeAttribute('aria-current');
  });
  $('days-nav').classList.toggle('hidden', v === 'windy' || v === 'plan');
  const changed = v !== curView;
  curView = v;
  store.set('local', 'view_v3', v);
  if (changed) track('view-' + v);
  if (data && v !== 'windy') renderAll(); // הרוחב האמיתי ידוע רק כשהמסך גלוי
  if (v === 'windy') {
    const u = windyUrl();
    if ($('windy-frame').src !== u) { $('windy-wrap').classList.remove('loaded'); $('windy-frame').src = u; windyTimeout(); }
    requestAnimationFrame(fitWindy);
  }
  if (changed) window.scrollTo(0, scrollMem[v] || 0);
}

/* ===================== מפת נקודות תחזית (בהגדרות) ===================== */
const MARINA = [32.1631, 34.7962];
let ptMap = null, ptLayers = null;
function distKm(a, b) {
  const R = 6371, toR = x => x * Math.PI / 180;
  const dLa = toR(b[0] - a[0]), dLo = toR(b[1] - a[1]);
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(toR(a[0])) * Math.cos(toR(b[0])) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const pinIcon = (icon, cls) => L.divIcon({ className: '', html: `<div class="pin ${cls}">${ico(icon, 16)}</div>`, iconSize: [32, 32], iconAnchor: [16, 16] });
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
    const useBase = i => { Object.values(bases).forEach(l => ptMap.removeLayer(l)); cur = i; errs = 0; loaded = 0; bases[order[i]].addTo(ptMap).bringToBack(); };
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
  L.marker(MARINA, { icon: pinIcon('anchor', 'marina') }).bindTooltip('מרינה הרצליה').addTo(ptLayers);
  const sameLoc = data && data.grid && locKey() === [pts.wind[0], pts.wind[1], pts.wave[0], pts.wave[1]].join(',');
  const info = [];
  for (const [k, icon, label, col] of [['wind', 'wind', 'נקודת הרוח', '#1d5fa8'], ['wave', 'waves', 'נקודת הגלים', '#2a9a96']]) {
    const m = L.marker(pts[k], { icon: pinIcon(icon, k), draggable: true }).bindTooltip(label).addTo(ptLayers);
    m.on('dragend', () => { const ll = m.getLatLng(); $('s-' + k + 'Lat').value = ll.lat.toFixed(4); $('s-' + k + 'Lon').value = ll.lng.toFixed(4); drawPtMap(); });
    let line = `${ico(icon, 14)} <b>${label}</b>: ${fmt(distKm(MARINA, pts[k]), 1)} ק"מ מהמרינה`;
    const cell = sameLoc ? data.grid[k] : null;
    if (cell) {
      L.circleMarker(cell, { radius: 9, color: col, weight: 2, dashArray: '4 3', fillOpacity: 0.12 }).bindTooltip(`תא המודל בפועל (${label})<br>${cell[0].toFixed(3)}, ${cell[1].toFixed(3)}`).addTo(ptLayers);
      L.polyline([pts[k], cell], { color: col, weight: 1.5, dashArray: '3 4' }).addTo(ptLayers);
      line += ` · תא המודל בפועל ${fmt(distKm(pts[k], cell), 1)} ק"מ מהנקודה`;
    } else if (data && data.grid) line += ' · תא המודל יחושב אחרי "שמור"';
    info.push(line);
  }
  if (sameLoc && data.grid.models) info.push(`${ico('chart-column', 14)} השוואת המודלים משתמשת ברשת גסה יותר – תא במרחק ${fmt(distKm(MARINA, data.grid.models), 1)} ק"מ`);
  $('pt-info').innerHTML = info.map(x => `<div>${x}</div>`).join('');
  if (fit) ptMap.fitBounds(L.latLngBounds([MARINA, pts.wind, pts.wave, ...(sameLoc ? [data.grid.wind, data.grid.wave].filter(Boolean) : [])]).pad(0.35));
}

/* ===================== הגדרות ===================== */
const FIELDS = ['maxWind', 'maxGust', 'maxWave', 'minPeriod', 'hourFrom', 'hourTo', 'windLat', 'windLon', 'waveLat', 'waveLon'];
function fillSettings(s) {
  FIELDS.forEach(f => $('s-' + f).value = s[f]);
  $('s-step').value = String(s.step);
  $('s-showModels').checked = !!s.showModels;
  $('s-night').checked = s.night !== false;
  $('settings-errors').classList.add('hidden');
}
function readSettings() {
  const raw = {};
  FIELDS.forEach(f => raw[f] = $('s-' + f).value);
  raw.step = $('s-step').value; raw.showModels = $('s-showModels').checked; raw.night = $('s-night').checked;
  return validateSettings(raw, settings);
}

/* ===================== אתחול ===================== */
document.addEventListener('DOMContentLoaded', async () => {
  const saved = await store.get('sync', 'settings_v3');
  settings = { ...DEFAULTS, ...(saved || {}) };
  const wl = `https://www.windy.com/${settings.windLat}/${settings.windLon}?${settings.windLat},${settings.windLon},11`;
  $('windy-link').href = wl; $('windy-open').href = windyFull('wind');
  document.querySelectorAll('[data-ico]').forEach(el => { el.innerHTML = ico(el.dataset.ico, +(el.dataset.s || 20)); });

  $('refresh-btn').addEventListener('click', () => load(true));
  VIEWS.forEach(v => $('view-' + v).addEventListener('click', () => showView(v)));
  ['p-date', 'p-from', 'p-to', 'p-course'].forEach(id => $(id).addEventListener('change', onPlanChange));
  const today0 = todayStr();
  trips = ((await store.get('sync', 'trips_v1')) || []).filter(t => t.date >= today0);
  const savedPlan = await store.get('local', 'plan_v1');
  if (savedPlan && savedPlan.date >= today0) plan = savedPlan;
  const lastView = await store.get('local', 'view_v3');
  if (lastView === 'table' || lastView === 'plan') showView(lastView);
  document.querySelectorAll('.map-bar .seg').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.map-bar .seg').forEach(x => { x.classList.toggle('active', x === b); x.setAttribute('aria-checked', x === b); });
    windyOverlay = b.dataset.overlay;
    $('windy-wrap').classList.remove('loaded');
    $('windy-frame').src = windyUrl();
    $('windy-open').href = windyFull();
  }));
  $('windy-frame').addEventListener('load', () => $('windy-wrap').classList.add('loaded'));
  // חלון הגדרות: פוקוס נכנס לחלון, נשאר בו (Tab), וחוזר לכפתור שפתח אותו
  const openSettings = () => {
    fillSettings(settings); $('settings').classList.remove('hidden'); document.body.classList.add('modal-open'); $('settings').scrollTop = 0;
    setTimeout(() => $('settings-close').focus(), 0);
  };
  let openFrom = null; // הפוקוס חוזר לכפתור שפתח את החלון
  const closeSettings = () => { $('settings').classList.add('hidden'); document.body.classList.remove('modal-open'); (openFrom && document.contains(openFrom) ? openFrom : $('settings-btn')).focus(); openFrom = null; };
  $('settings').addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    const f = [...$('settings').querySelectorAll('button, input, select, summary, a[href], [tabindex]:not([tabindex="-1"])')].filter(x => x.offsetParent !== null);
    if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  });
  $('settings-btn').addEventListener('click', () => $('settings').classList.contains('hidden') ? openSettings() : closeSettings());
  document.addEventListener('click', e => { if (e.target.closest('[data-open-settings]')) { openFrom = e.target.closest('[data-open-settings]'); openSettings(); } });
  $('settings-close').addEventListener('click', closeSettings);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('settings').classList.contains('hidden')) closeSettings(); });
  $('adv-points').addEventListener('toggle', () => { if ($('adv-points').open) initPtMap(); });
  $('settings-reset').addEventListener('click', () => { fillSettings(DEFAULTS); drawPtMap(true); });
  $('settings-save').addEventListener('click', async () => {
    const before = locKey();
    const { s: next, errors } = readSettings();
    $('settings-errors').innerHTML = errors.map(e => `<div>${e}</div>`).join('');
    $('settings-errors').classList.toggle('hidden', !errors.length);
    if (errors.length) { $('settings-errors').focus(); return; }
    settings = next;
    await store.set('sync', 'settings_v3', settings);
    closeSettings();
    if (locKey() !== before) { data = null; await load(true); } else renderAll();
  });
  document.addEventListener('keydown', e => {
    // חצים מחליפים יום רק כשהפוקוס לא נמצא על פקד אחר (שעות, טפסים, חלון הגדרות)
    const t = e.target;
    if (t !== document.body && t !== document.documentElement) return;
    if (!$('settings').classList.contains('hidden')) return;
    if (e.key === 'ArrowLeft') $('next-day').click();
    if (e.key === 'ArrowRight') $('prev-day').click();
  });
  // הסבר קצר – מוצג רק בביקור הראשון, ואפשר לפתוח שוב בכפתור ⓘ
  const introBox = $('intro-box');
  let seen = false; try { seen = localStorage.getItem('introSeen') === '1'; } catch (_) {}
  if (!seen) introBox.classList.remove('hidden');
  $('intro-close').addEventListener('click', () => { introBox.classList.add('hidden'); try { localStorage.setItem('introSeen', '1'); } catch (_) {} });
  $('info-btn').addEventListener('click', () => introBox.classList.toggle('hidden'));
  // מצב בהיר / כהה: מערכת → בהיר → כהה
  const themeBtn = $('theme-btn');
  const setTheme = th => {
    if (th) document.documentElement.setAttribute('data-theme', th); else document.documentElement.removeAttribute('data-theme');
    try { th ? localStorage.setItem('theme', th) : localStorage.removeItem('theme'); } catch (_) {}
    themeBtn.innerHTML = ico(th === 'light' ? 'sun' : th === 'dark' ? 'moon' : 'sun-moon');
    themeBtn.title = th === 'light' ? 'מצב בהיר (לחץ לכהה)' : th === 'dark' ? 'מצב כהה (לחץ לאוטומטי)' : 'אוטומטי לפי המכשיר (לחץ לבהיר)';
    if (data) renderAll();
  };
  let cur0 = null; try { cur0 = localStorage.getItem('theme'); } catch (_) {}
  setTheme(cur0);
  themeBtn.addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme');
    setTheme(cur === 'light' ? 'dark' : cur === 'dark' ? null : 'light');
  });
  if (window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => data && renderAll());
  setInterval(() => {
    renderUpdated();
    if (document.visibilityState === 'visible' && data && Date.now() - data.fetchedAt > CACHE_MAX_AGE) load(true);
  }, 60000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && data && Date.now() - data.fetchedAt > CACHE_MAX_AGE) load(true);
  });
  // מציירים מחדש רק כשהרוחב באמת משתנה (סיבוב מסך) – לא כשסרגל הכתובת בטלפון נעלם/מופיע בזמן גלילה
  let rT, lastW = window.innerWidth;
  window.addEventListener('resize', () => {
    fitWindy();
    if (Math.abs(window.innerWidth - lastW) < 2) return;
    lastW = window.innerWidth;
    clearTimeout(rT); rT = setTimeout(() => data && renderAll(), 250);
  });
  load(false);
});
