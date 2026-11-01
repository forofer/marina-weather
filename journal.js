'use strict';
/* יומן הפלגות – נשמר בדפדפן (localStorage), עם גיבוי לקובץ. מזג האוויר להפלגות שעברו נשלף מארכיון התחזיות של Open-Meteo
   (Historical Forecast API – מה שהמודלים חזו לאותן שעות) ומ-Open-Meteo Marine (גלים, גלי רוח וסוול).
   השדות לפי מה שנהוג לרשום ביומן הפלגות: כלי השיט, תאריך ושעות, מאיפה ולאן, מרחק, שעות לילה וימים בים, תפקיד (סקיפר/צוות),
   צוות, מזג אוויר ומצב הים, מפרשים וריפים, שעות מנוע ודלק, תדריך בטיחות, אירועים ותקלות – ומתי נוצרה ועודכנה כל רשומה. */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const FEEL = ['נוח', 'בינוני', 'מאתגר', 'קשה'];
const ROLES = ['סקיפר', 'סקיפר משנה', 'צוות'];
let J = loadJournal();
J.vessel = J.vessel || {};
const visible = () => J.trips.filter(t => !t.deleted);
const hrs = m => { const h = m / 60; return h >= 10 ? h.toFixed(0) : h.toFixed(1).replace(/\.0$/, ''); };
const save = () => { J.updatedAt = new Date().toISOString(); return saveJournal(J); };
const touch = t => { t.updatedAt = new Date().toISOString(); t.createdAt = t.createdAt || t.updatedAt; };
// בקשה מהדפדפן לא למחוק את הנתונים כשחסר מקום (לא מגן מהמחיקה של Safari אחרי 7 ימים בלי כניסה – לשם צריך מסך בית וגיבוי)
try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (_) {}

/* ===================== סיכום ותובנות ===================== */
function renderSummary() {
  const tr = visible();
  const el = $('summary-sec');
  if (!tr.length) {
    el.innerHTML = `<h2 class="sec-h">עדיין אין הפלגות ביומן</h2><p class="hint" style="margin:0">פתחו את "הוספת הפלגות" ובחרו את קובץ ציר הזמן מ-Google, או הוסיפו הפלגה ביד.</p>`;
    $('import-sec').open = true;
    return;
  }
  const st = tr.map(tripStats);
  const nm = st.reduce((s, x) => s + x.nm, 0), mins = st.reduce((s, x) => s + x.durMin, 0), night = st.reduce((s, x) => s + x.nightMin, 0), days = st.reduce((s, x) => s + x.days, 0);
  const asSkipper = tr.filter(t => (t.notes?.role || 'סקיפר') === 'סקיפר').length;
  const year = new Date().getFullYear();
  const thisYear = tr.filter(t => new Date(t.start).getFullYear() === year).length;
  let h = `<h2 class="sec-h">סיכום${J.vessel.name ? ` · <bdi>${esc(J.vessel.name)}</bdi>` : ''}</h2><div class="stats">
    <div class="stat"><div class="k">הפלגות</div><div class="v">${tr.length} <small>(${thisYear} השנה)</small></div></div>
    <div class="stat"><div class="k">מרחק</div><div class="v">${nm.toFixed(0)} <small>מייל ימי</small></div></div>
    <div class="stat"><div class="k">זמן בים</div><div class="v">${hrs(mins)} <small>שעות</small></div></div>
    <div class="stat"><div class="k">שעות לילה</div><div class="v">${hrs(night)} <small>שעות</small></div></div>
    ${days ? `<div class="stat"><div class="k">ימים בים (24 שעות)</div><div class="v">${days}</div></div>` : ''}
    <div class="stat"><div class="k">כסקיפר</div><div class="v">${asSkipper} <small>הפלגות</small></div></div>
  </div>`;
  // תחושה מול תחזית – רק להפלגות שדורגו ושיש להן נתוני מזג אוויר
  const pairs = tr.map(t => ({ t, f: t.notes?.feel, p: wxDemand(t) })).filter(x => x.f != null && x.p);
  if (pairs.length) {
    const harder = pairs.filter(x => x.f > x.p.lvl), easier = pairs.filter(x => x.f < x.p.lvl), same = pairs.length - harder.length - easier.length;
    h += `<p class="insight"><b>התחושה שלך מול התחזית</b> (${pairs.length === 1 ? 'הפלגה אחת' : pairs.length + ' הפלגות'} שדורגו): ${same} תאמו${harder.length ? ` · ${harder.length} הרגישו קשות מהתחזית` : ''}${easier.length ? ` · ${easier.length} הרגישו קלות מהתחזית` : ''}.</p>`;
    if (harder.length >= 2 && harder.length > easier.length) h += `<p class="insight">הים הרגיש לך לא פעם קשה יותר ממה שהתחזית העריכה. כדאי לשקול להוריד את הספים בהגדרות (רוח, משבים או גלים).</p>`;
    h += `<ul class="cmp">${pairs.slice(0, 6).map(x => `<li>${fmtDate(x.t.start)}: הרגיש <b>${FEEL[x.f]}</b> · התחזית: ${x.p.t}${x.p.wHi != null ? ` (רוח עד ${fmt(x.p.wHi)} קשר לפי המודלים)` : ''}</li>`).join('')}</ul>`;
  } else h += `<p class="insight muted">דרגו הפלגות ("איך הים הרגיש?") – ואחרי כמה הפלגות נראה כאן איך התחושה שלך מתיישבת עם התחזית.</p>`;
  el.innerHTML = h;
}

/* ===================== תזכורת גיבוי ===================== */
function renderBackupWarn() {
  const el = $('backup-warn');
  const last = J.lastBackup ? Date.parse(J.lastBackup) : 0, changed = J.updatedAt ? Date.parse(J.updatedAt) : 0;
  const need = visible().length && changed > last && Date.now() - last > 14 * 86400000;
  el.classList.toggle('hidden', !need);
  if (need) el.innerHTML = `${ico('triangle-alert', 18)}<span>${last ? `הגיבוי האחרון נשמר ב-${fmtDate(last)}` : 'עדיין לא נשמר גיבוי של היומן'}. היומן שמור רק בטלפון הזה – <button type="button" class="btn quiet" data-backup-now>שמור גיבוי עכשיו</button></span>`;
  el.querySelector('[data-backup-now]')?.addEventListener('click', doBackup);
}

/* ===================== מזג אוויר מהארכיון ===================== */
const kts = v => v == null ? null : +v;
async function fetchWx(trip) {
  const s = tripStats(trip);
  if (!s.centroid) throw new Error('אין מיקום להפלגה – בחרו נמל יציאה ב"תיקון פרטים"');
  const [lat, lng] = s.centroid.map(x => x.toFixed(4));
  const S = tStart(trip), E = tEnd(trip), d0 = localDate(S), d1 = localDate(E);
  if (Date.parse(d1) - Date.parse(d0) > 16 * 86400000) throw new Error('ההפלגה ארוכה מדי לשליפת תחזית (יותר מ-16 ימים)');
  const tz = encodeURIComponent(TL_TZ);
  const wUrl = `https://historical-forecast-api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&start_date=${d0}&end_date=${d1}` +
    `&hourly=wind_speed_10m,wind_gusts_10m,wind_direction_10m,precipitation,weather_code&models=best_match,ecmwf_ifs025,icon_seamless,gfs_seamless&wind_speed_unit=kn&cell_selection=sea&timezone=${tz}`;
  const mUrl = `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lng}&start_date=${d0}&end_date=${d1}` +
    `&hourly=wave_height,wave_period,wave_direction,wind_wave_height,wind_wave_period,wind_wave_direction,swell_wave_height,swell_wave_period,swell_wave_direction&timezone=${tz}`;
  const get = async u => { const r = await fetch(u); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.reason || 'השרת לא החזיר נתונים'); return j; };
  const [w, m] = await Promise.all([get(wUrl), get(mUrl).catch(() => null)]);
  const H = w.hourly, M = m && m.hourly;
  const pick = (k, i) => H[k + '_best_match']?.[i] ?? H[k]?.[i] ?? null;
  // השעות של ההפלגה: מהשעה העגולה שלפני היציאה עד השעה העגולה שאחרי החזרה
  const t0 = localDate(S) + 'T' + String(localHour(S)).padStart(2, '0') + ':00';
  const eh = localHour(E), t1 = localDate(E) + 'T' + String(eh).padStart(2, '0') + ':00';
  const rows = [];
  H.time.forEach((t, i) => {
    if (t < t0 || t > t1) return;
    const mi = M ? M.time.indexOf(t) : -1, mv = k => mi >= 0 ? M[k][mi] : null;
    rows.push({
      t, hour: +t.slice(11, 13), wind: kts(pick('wind_speed_10m', i)), gust: kts(pick('wind_gusts_10m', i)), dir: pick('wind_direction_10m', i),
      rain: pick('precipitation', i), code: pick('weather_code', i),
      models: Object.fromEntries([['ECMWF', 'ecmwf_ifs025'], ['ICON', 'icon_seamless'], ['GFS', 'gfs_seamless']].map(([n, id]) => [n, { wind: kts(H['wind_speed_10m_' + id]?.[i]) }]).filter(([, v]) => v.wind != null)),
      wave: mv('wave_height'), wavePer: mv('wave_period'), waveDir: mv('wave_direction'),
      ww: mv('wind_wave_height'), wwPer: mv('wind_wave_period'), wwDir: mv('wind_wave_direction'),
      sw: mv('swell_wave_height'), swPer: mv('swell_wave_period'), swDir: mv('swell_wave_direction')
    });
  });
  if (!rows.length) throw new Error('אין נתונים לשעות האלה בארכיון');
  return { fetchedAt: new Date().toISOString(), lat: +lat, lng: +lng, marine: !!M, rows };
}
// אופי הים לפי התחזית – אותה פונקציה כמו במסך הסיכום
function wxDemand(trip) { return trip.wx && trip.wx.rows ? demandOf(trip.wx.rows) : null; }

function wxHtml(trip) {
  const wx = trip.wx;
  if (!wx) return `<p class="muted" data-wx-status>טוען את התחזית לאותן שעות…</p>`;
  if (wx.error) return `<p class="muted">לא הצלחתי לטעון את התחזית: ${esc(wx.error)}. <button class="btn quiet" data-retry>נסה שוב</button></p>`;
  const dm = demandOf(wx.rows);
  const ws = wx.rows.flatMap(r => [r.wind, ...Object.values(r.models || {}).map(m => m.wind)]).filter(v => v != null);
  const gs = wx.rows.map(r => r.gust).filter(v => v != null), wv = wx.rows.map(r => r.wave).filter(v => v != null);
  const rain = wx.rows.slice(1).reduce((s, r) => s + (r.rain || 0), 0);
  const multi = wx.rows.length > 30;   // הפלגה של כמה ימים: שורה כל 3 שעות
  const rows = multi ? wx.rows.filter(r => r.hour % 3 === 0) : wx.rows;
  const sum = [`רוח ${ws.length ? `${fmt(Math.min(...ws))}–${fmt(Math.max(...ws))} קשר (כל המודלים)` : '–'}`, `משבים עד ${gs.length ? fmt(Math.max(...gs)) : '–'}`,
    `גלים עד ${wv.length ? Math.round(Math.max(...wv) * 100) + ' ס״מ' : '– (אין נתוני גלים)'}`, rain >= 0.1 ? `גשם ${fmt(rain, 1)} מ"מ` : null].filter(Boolean).join(' · ');
  return `<p class="wx-sum">${sum}</p>
    ${dm ? `<div class="demand dm${dm.lvl}"><span class="dm-h">${ico('waves', 18)}<b>אופי הים לפי התחזית: ${dm.t}</b>${dm.d ? ` – ${dm.d}` : ''}</span>${dm.why.length ? `<span class="dm-w">${dm.why.join(' · ')}</span>` : ''}</div>` : ''}
    <div class="wx-wrap"><table class="wx-tab"><thead><tr><th>${multi ? 'יום ושעה' : 'שעה'}</th><th>רוח<br>(מודלים)</th><th>משבים</th><th>גלים<br>ס״מ</th><th>סוול / גלי רוח</th><th>אופי</th></tr></thead><tbody>
    ${rows.map(r => { const d = seaDemand(r); const ms = Object.values(r.models || {}).map(m => m.wind).filter(v => v != null);
      return `<tr><td>${multi ? `${+r.t.slice(8, 10)}/${+r.t.slice(5, 7)} ` : ''}${r.t.slice(11, 16)}</td><td>${fmt(r.wind)}${ms.length > 1 ? `<br><small>${fmt(Math.min(...ms))}–${fmt(Math.max(...ms))}</small>` : ''}</td><td>${fmt(r.gust)}</td><td>${r.wave != null ? Math.round(r.wave * 100) : '–'}</td>
        <td>${r.sw != null ? `${Math.round(r.sw * 100)} ${from8(r.swDir)}` : '–'}<br><small>${r.ww != null ? `${Math.round(r.ww * 100)} ${from8(r.wwDir)}` : ''}</small></td>
        <td class="d${d ? d.lvl : 0}">${d ? FEEL[d.lvl] : '–'}</td></tr>`; }).join('')}
    </tbody></table></div>
    <p class="src">לפי ארכיון התחזיות של Open-Meteo (התחזית שהייתה לאותן שעות, לא מדידה), ${trip.source === 'manual' ? 'לנקודה באמצע הדרך בין הנמלים' : 'לנקודה במרכז המסלול'}${multi ? '. מוצגת שורה כל 3 שעות, אבל הסיכום מחושב לפי כל השעות' : ''}. רוח: התחזית המשולבת, ובשורה השנייה הטווח בין ECMWF, ICON ו-GFS. גלים: Open-Meteo Marine.</p>`;
}

/* ===================== מפה ===================== */
const maps = new Map();
function initMap(el, trip) {
  if (typeof L === 'undefined' || maps.has(trip.id)) return;
  const pts = tripStats(trip).pts.map(p => [p[0], p[1]]);
  if (pts.length < 2 || pts.every(p => p[0] === pts[0][0] && p[1] === pts[0][1])) { el.innerHTML = '<p class="empty">אין מסלול להצגה במפה</p>'; el.classList.add('no-map'); return; }
  const m = L.map(el, { zoomControl: true, attributionControl: true, scrollWheelZoom: false });
  const base = L.tileLayer('https://t2.openseamap.org/tile/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenSeaMap, © OpenStreetMap' });
  let errs = 0, swapped = false;
  base.on('tileerror', () => { if (++errs >= 4 && !swapped) { swapped = true; m.removeLayer(base); L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', { maxZoom: 18, attribution: '© Esri' }).addTo(m); } });
  base.addTo(m);
  L.tileLayer('https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenSeaMap' }).addTo(m);
  const line = L.polyline(pts, { color: '#0b67b2', weight: 3, dashArray: trip.source === 'manual' ? '6 6' : null }).addTo(m);
  L.circleMarker(pts[0], { radius: 6, color: '#17854a', fillOpacity: 1 }).bindTooltip('יציאה').addTo(m);
  L.circleMarker(pts[pts.length - 1], { radius: 6, color: '#a32424', fillOpacity: 1 }).bindTooltip('סיום').addTo(m);
  m.fitBounds(line.getBounds().pad(0.2));
  maps.set(trip.id, m);
  setTimeout(() => m.invalidateSize(), 50);
}

/* ===================== רשימה ופירוט ===================== */
const routeTxt = (t, s) => (t.fix && t.fix.label) || placeTxt(s);
const timeRange = t => {
  const S = tStart(t), E = tEnd(t);
  return localDate(S) === localDate(E) ? `${fmtTime(S)}–${fmtTime(E)}` : `${fmtTime(S)} – ${fmtShort(E)} ${fmtTime(E)}`;
};
const fmtShort = t => new Date(t).toLocaleDateString('he-IL', { timeZone: TL_TZ, day: 'numeric', month: 'numeric' });
function feelBadge(t) { const f = t.notes?.feel; return f != null ? `<span class="feel-b f${f}">${FEEL[f]}</span>` : ''; }
function renderList() {
  const el = $('trips');
  maps.forEach(m => m.remove()); maps.clear();
  const tr = visible();
  if (!tr.length) { el.innerHTML = '<p class="empty">אין עדיין הפלגות ביומן.</p>'; return; }
  el.innerHTML = tr.map(t => {
    const s = tripStats(t);
    return `<details class="jtrip" data-id="${esc(t.id)}">
      <summary>
        <span class="t-main"><b>${fmtDate(t.start)} · <bdi dir="ltr" class="nw">${timeRange(t)}</bdi></b>
          <span class="t-sub">${esc(routeTxt(t, s))}</span>
          <span class="t-nums">${s.nm.toFixed(1)} מייל · ${s.days ? `${s.days === 1 ? 'יום' : s.days + ' ימים'} ו-` : ''}${durTxt(s.durMin % (s.days ? 1440 : Infinity))}${s.nightMin >= 30 ? ` · ${hrs(s.nightMin)} ש׳ לילה` : ''}${s.avgKn && !s.days ? ` · ${s.avgKn.toFixed(1)} קשר בממוצע` : ''}</span></span>
        <span class="t-side">${t.source === 'manual' && s.pts.length < 2 ? `<span class="t-manual">${ico('book-open', 22)}</span>` : miniPath(s.pts)}${feelBadge(t)}</span>
      </summary>
      <div class="t-body"></div>
    </details>`;
  }).join('');
  el.querySelectorAll('details.jtrip').forEach(d => d.addEventListener('toggle', () => { if (d.open) openTrip(d); }));
}
function tripById(id) { return J.trips.find(t => t.id === id); }
let keepFix = null;
function openTrip(d) {
  const t = tripById(d.dataset.id); if (!t) return;
  const s = tripStats(t);
  const body = d.querySelector('.t-body');
  const n = t.notes || {};
  const manual = t.source === 'manual';
  const portOpts = sel => `<option value="">—</option>${PORTS.map(p => `<option${p[0] === sel ? ' selected' : ''}>${esc(p[0])}</option>`).join('')}`;
  body.innerHTML = `
    <div class="stats">
      <div class="stat"><div class="k">מרחק</div><div class="v">${s.nm.toFixed(1)} <small>מייל ימי</small></div></div>
      <div class="stat"><div class="k">משך</div><div class="v">${s.days ? `${s.days} <small>${s.days === 1 ? 'יום' : 'ימים'}</small> ` : ''}${durTxt(s.durMin % (s.days ? 1440 : Infinity))}</div></div>
      <div class="stat"><div class="k">שעות לילה</div><div class="v">${hrs(s.nightMin)} <small>שעות</small></div></div>
      <div class="stat"><div class="k">מהירות ממוצעת</div><div class="v">${s.avgKn ? s.avgKn.toFixed(1) : '–'} <small>קשר</small></div></div>
      ${manual ? '' : `<div class="stat"><div class="k">מהירות מרבית (משוערת)</div><div class="v">${s.maxKn ? s.maxKn.toFixed(1) : '–'} <small>קשר</small></div></div>
      <div class="stat"><div class="k">התרחקות מקסימלית</div><div class="v">${s.farNm != null ? s.farNm.toFixed(1) : '–'} <small>מייל</small></div></div>`}
    </div>
    ${s.fixed && !manual ? `<p class="fix-note">${ico('info', 16)}<span><b>תוקן ידנית.</b> ${esc(t.fix.note || '')}${t.fix.nm > 0 ? ` המפה מראה רק את מה ש-Google רשמה (${s.recNm.toFixed(1)} מייל).` : ''}</span></p>` : ''}
    <div class="t-map" aria-label="מפת המסלול"></div>
    <p class="src" style="margin-top:-0.5rem">${manual ? 'הפלגה שנוספה ביד: הקו במפה מחבר בין הנמלים בקו ישר, והוא לא המסלול האמיתי.' : `המסלול מציר הזמן של Google (נקודה כל דקה–כמה דקות, מוחלק). ${s.removed ? `הוסרו ${s.removed === 1 ? 'נקודה שגויה אחת' : s.removed + ' נקודות שגויות'} (קפיצות שיאכטה לא יכולה לעשות).` : ''}`} שעות הלילה מחושבות לפי השקיעה והזריחה.</p>
    <section><h3 class="h3">מה התחזית אמרה</h3><div data-wx>${s.centroid ? wxHtml(t) : '<p class="muted">אין מיקום להפלגה, ולכן אין תחזית. בחרו נמל יציאה ב"תיקון פרטים".</p>'}</div></section>
    <section><h3 class="h3">איך הים הרגיש?</h3>
      <div class="feel" role="group" aria-label="איך הים הרגיש">${FEEL.map((f, i) => `<button type="button" data-feel="${i}" aria-pressed="${n.feel === i}">${f}</button>`).join('')}</div>
    </section>
    <section><h3 class="h3">פרטי היומן</h3>
      <div class="fields">
        <label>התפקיד שלי<select data-note="role">${ROLES.map(r => `<option${(n.role || 'סקיפר') === r ? ' selected' : ''}>${r}</option>`).join('')}</select></label>
        <label>הסקיפר<input data-note="skipper" value="${esc(n.skipper)}" placeholder="${(n.role || 'סקיפר') === 'סקיפר' ? 'אני' : 'שם הסקיפר'}"></label>
        <label>מי היה על הסירה<input data-note="crew" value="${esc(n.crew)}" placeholder="למשל: אני + 3 אורחים"></label>
        <label>מפרשים וריפים<input data-note="sails" value="${esc(n.sails)}" placeholder="למשל: ריף ראשון, ג׳נואה מלאה"></label>
        <label>שעות מנוע ביציאה<input data-note="engStart" inputmode="decimal" value="${esc(n.engStart)}" placeholder="למשל: 1234.5"></label>
        <label>שעות מנוע בחזרה<input data-note="engEnd" inputmode="decimal" value="${esc(n.engEnd)}"></label>
        <label>דלק ומים<input data-note="fuel" value="${esc(n.fuel)}" placeholder="למשל: תדלוק 40 ליטר"></label>
        <label class="check"><input type="checkbox" data-note="safety"${n.safety ? ' checked' : ''}> ניתן תדריך בטיחות לצוות</label>
        <label class="wide">אירועים ותקלות<textarea data-note="events" placeholder="שינויי מפרשים, מעבר למנוע, תקלות, תיקונים, כלי שיט מיוחדים…">${esc(n.events)}</textarea></label>
        <label class="wide">הערות<textarea data-note="text" placeholder="מה היה? מה כדאי לזכור לפעם הבאה?">${esc(n.text)}</textarea></label>
      </div>
      <div class="saved-msg" role="status"></div>
      <p class="src">${t.createdAt ? `נוצר ${fmtDate(t.createdAt)} ${fmtTime(t.createdAt)}` : ''}${t.updatedAt && t.updatedAt !== t.createdAt ? ` · עודכן ${fmtDate(t.updatedAt)} ${fmtTime(t.updatedAt)}` : ''}</p>
    </section>
    <details class="fix-box"${(s.fixed && !manual) || keepFix === t.id ? ' open' : ''}><summary>${manual ? 'עריכת פרטי ההפלגה' : 'תיקון פרטים – כש-Google טעתה או פספסה חלק'}</summary>
      <div class="fields">
        <label class="wide">מסלול<input data-fix="label" value="${esc(t.fix?.label)}" placeholder="${esc(placeTxt(s))}"></label>
        ${manual ? `<label>נמל יציאה<select data-port="from">${portOpts(t.ports?.from)}</select></label>
        <label>דרך (לא חובה)<select data-port="via">${portOpts(t.ports?.via)}</select></label>
        <label>נמל סיום<select data-port="to">${portOpts(t.ports?.to)}</select></label>` : ''}
        <label>${s.days || manual ? 'יציאה' : 'שעת יציאה'}${manual ? `<input type="datetime-local" data-dt="start" value="${dtLocal(tStart(t))}">` : `<input type="time" data-fix="start" value="${fmtTime(tStart(t))}">`}</label>
        <label>${s.days || manual ? 'סיום' : 'שעת חזרה'}${manual ? `<input type="datetime-local" data-dt="end" value="${dtLocal(tEnd(t))}">` : `<input type="time" data-fix="end" value="${fmtTime(tEnd(t))}">`}</label>
        <label>מרחק כולל (מייל)<input type="number" inputmode="decimal" step="0.1" min="0" data-fix="nm" value="${t.fix?.nm > 0 ? t.fix.nm : ''}" placeholder="${s.recNm.toFixed(1)}"></label>
        ${manual ? '' : `<label class="wide">מה תוקן<input data-fix="note" value="${esc(t.fix?.note)}" placeholder="למשל: הדרך הלוך לא נרשמה"></label>`}
      </div>
      ${manual ? '<p class="src">בלי מרחק כולל – המרחק מחושב בקו ישר בין הנמלים (פחות מהאמיתי).</p>' : `<div class="t-actions" style="margin-top:0.5rem">
        <button type="button" class="btn" data-fix-rt>הלוך ושוב באותה דרך: ${(s.recNm * 2).toFixed(1)} מייל</button>
        ${s.fixed ? '<button type="button" class="btn quiet" data-fix-clear>בטל את התיקונים</button>' : ''}
      </div>`}
    </details>
    <div class="t-actions"><span class="src">נשמר רק בטלפון הזה – כדאי לשמור גיבוי.</span><button class="btn danger" data-del>מחק מהיומן</button></div>`;
  requestAnimationFrame(() => initMap(body.querySelector('.t-map'), t));
  // פרטי היומן – שמירה אוטומטית
  const savedMsg = body.querySelector('.saved-msg');
  const saved = () => { touch(t); save(); renderBackupWarn(); savedMsg.textContent = 'נשמר ✓'; clearTimeout(saved.tm); saved.tm = setTimeout(() => { savedMsg.textContent = ''; }, 1500); };
  body.querySelectorAll('[data-feel]').forEach(b => b.addEventListener('click', () => {
    const v = +b.dataset.feel; t.notes = { ...(t.notes || {}), feel: t.notes?.feel === v ? null : v };
    body.querySelectorAll('[data-feel]').forEach(x => x.setAttribute('aria-pressed', String(+x.dataset.feel === t.notes.feel)));
    saved(); d.querySelector('.t-side .feel-b')?.remove(); if (t.notes.feel != null) d.querySelector('.t-side').insertAdjacentHTML('beforeend', feelBadge(t)); renderSummary();
  }));
  body.querySelectorAll('[data-note]').forEach(inp => {
    const val = () => inp.type === 'checkbox' ? inp.checked : inp.value;
    const ev = inp.tagName === 'SELECT' || inp.type === 'checkbox' ? 'change' : 'input';
    inp.addEventListener(ev, () => { t.notes = { ...(t.notes || {}), [inp.dataset.note]: val() }; clearTimeout(inp.tm); inp.tm = setTimeout(() => { saved(); if (inp.dataset.note === 'role') renderSummary(); }, ev === 'change' ? 0 : 400); });
  });
  // מחיקה – לחיצה שנייה מאשרת
  const del = body.querySelector('[data-del]');
  del.addEventListener('click', () => {
    if (del.dataset.armed) { t.deleted = true; touch(t); save(); renderAll(); return; }
    del.dataset.armed = '1'; del.textContent = 'בטוח? לחץ שוב למחיקה';
    setTimeout(() => { if (del.isConnected) { delete del.dataset.armed; del.textContent = 'מחק מהיומן'; } }, 4000);
  });
  // תיקון פרטים – נשמר כשעוזבים שדה; שינוי שעות או מקום טוען מחדש את התחזית
  const setFix = patch => {
    const f = { ...(t.fix || {}), ...patch };
    Object.keys(f).forEach(k => { if (f[k] === '' || f[k] == null) delete f[k]; });
    if (['label', 'start', 'end', 'nm', 'note'].every(k => (f[k] ?? null) === (t.fix?.[k] ?? null))) return;   // לא השתנה כלום
    if (['start', 'end'].some(k => k in patch && (patch[k] || null) !== (t.fix?.[k] || null))) t.wx = null;
    t.fix = Object.keys(f).length ? f : null;
    touch(t); save(); reopen(t.id);
  };
  body.querySelectorAll('[data-fix]').forEach(inp => inp.addEventListener('change', () => {
    const k = inp.dataset.fix, v = inp.value.trim();
    if (k === 'start' || k === 'end') {
      if (!/^\d\d:\d\d$/.test(v)) return;
      const iso = localToISO(localDate(k === 'start' ? t.start : t.end), v);
      const orig = k === 'start' ? t.start : t.end;
      setFix({ [k]: fmtTime(iso) === fmtTime(orig) ? null : iso });
    } else if (k === 'nm') setFix({ nm: v && +v > 0 ? Math.round(+v * 10) / 10 : null });
    else setFix({ [k]: v || null });
  }));
  // הפלגה ידנית: תאריכים ונמלים
  body.querySelectorAll('[data-dt]').forEach(inp => inp.addEventListener('change', () => {
    const v = inp.value; if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(v)) return;
    const iso = localToISO(v.slice(0, 10), v.slice(11, 16));
    const ns = inp.dataset.dt === 'start' ? iso : t.start, ne = inp.dataset.dt === 'end' ? iso : t.end;
    if (tms(ne) <= tms(ns)) { savedMsg.textContent = 'הסיום חייב להיות אחרי היציאה'; return; }
    t.start = ns; t.end = ne; t.wx = null; touch(t); save(); reopen(t.id);
  }));
  body.querySelectorAll('[data-port]').forEach(sel => sel.addEventListener('change', () => {
    t.ports = { ...(t.ports || {}), [sel.dataset.port]: sel.value || null };
    t.path = portsPath(t.ports); t.wx = null; touch(t); save(); reopen(t.id);
  }));
  body.querySelector('[data-fix-rt]')?.addEventListener('click', () => setFix({ nm: Math.round(s.recNm * 20) / 10, note: t.fix?.note || 'המרחק משוער – הלוך ושוב באותה דרך.' }));
  body.querySelector('[data-fix-clear]')?.addEventListener('click', () => { if (t.fix?.start || t.fix?.end) t.wx = null; t.fix = null; touch(t); save(); reopen(t.id); });
  if (s.centroid) loadWx(t, body);
}
const dtLocal = t => `${localDate(t)}T${fmtTime(t)}`;
const portsPath = p => ['from', 'via', 'to'].map(k => p && portByName(p[k])).filter(Boolean).map(x => [x[1], x[2], null]);
function reopen(id) {
  const y = window.scrollY; renderAll();
  const d = [...document.querySelectorAll('details.jtrip')].find(x => x.dataset.id === id);
  keepFix = id; if (d) d.open = true;
  window.scrollTo(0, y);
}
async function loadWx(t, body) {
  const box = body.querySelector('[data-wx]');
  const retry = () => box.querySelector('[data-retry]')?.addEventListener('click', () => { box.innerHTML = wxHtml(t); loadWx(t, body); });
  if (t.wx && !t.wx.error) return;
  if (t.wx) { t.wx = null; box.innerHTML = wxHtml(t); }
  let wx;
  try { wx = await fetchWx(t); t.wx = wx; saveJournal(J); }
  catch (e) { wx = { error: /fetch|network|load failed/i.test(e.message) ? 'אין חיבור לאינטרנט או שהשרת לא זמין' : e.message }; }
  if (wx.error) { t.wx = wx; box.innerHTML = wxHtml(t); t.wx = null; retry(); return; } // שגיאה לא נשמרת – בפתיחה הבאה ננסה שוב
  box.innerHTML = wxHtml(t);
  renderSummary();
}

/* ===================== הוספת הפלגה ביד ===================== */
function initManual() {
  const sel = $('m-from'), via = $('m-via'), to = $('m-to');
  const opts = PORTS.map(p => `<option>${esc(p[0])}</option>`).join('');
  sel.innerHTML = opts; to.innerHTML = opts; via.innerHTML = `<option value="">—</option>${opts}`;
  sel.value = to.value = 'מרינה הרצליה';
  $('m-add').addEventListener('click', () => {
    const msg = $('m-msg'); msg.className = 'msg err';
    const a = $('m-start').value, b = $('m-end').value;
    if (!a || !b) { msg.textContent = 'צריך תאריך ושעה ליציאה ולסיום.'; return; }
    const start = localToISO(a.slice(0, 10), a.slice(11, 16)), end = localToISO(b.slice(0, 10), b.slice(11, 16));
    if (tms(end) <= tms(start)) { msg.textContent = 'הסיום חייב להיות אחרי היציאה.'; return; }
    const ports = { from: sel.value, via: via.value || null, to: to.value };
    const nm = +$('m-nm').value;
    const label = $('m-label').value.trim();
    const trip = { id: 'm-' + start, start, end, prob: null, source: 'manual', ports, path: portsPath(ports), distanceM: null,
      notes: {}, wx: null, fix: (label || nm > 0) ? { ...(label ? { label } : {}), ...(nm > 0 ? { nm: Math.round(nm * 10) / 10 } : {}) } : null, deleted: false };
    touch(trip);
    const r = addTrips(J, [trip]);
    if (!r.added) { msg.textContent = 'יש כבר ביומן הפלגה בזמנים האלה.'; return; }
    save(); msg.className = 'msg'; msg.textContent = 'ההפלגה נוספה ✓';
    ['m-start', 'm-end', 'm-nm', 'm-label'].forEach(id => { $(id).value = ''; });
    renderAll(); renderBackupWarn();
    const d = [...document.querySelectorAll('details.jtrip')].find(x => x.dataset.id === trip.id);
    if (d) { d.open = true; d.scrollIntoView({ block: 'start' }); }
  });
}

/* ===================== כלי השיט ===================== */
function initVessel() {
  document.querySelectorAll('[data-vessel]').forEach(inp => {
    inp.value = J.vessel[inp.dataset.vessel] || '';
    inp.addEventListener('input', () => { J.vessel[inp.dataset.vessel] = inp.value.trim(); clearTimeout(inp.tm); inp.tm = setTimeout(() => { save(); renderSummary(); $('vessel-msg').textContent = 'נשמר ✓'; }, 400); });
  });
  if (!J.vessel.name) $('vessel-sec').open = false;
}

/* ===================== ייבוא, גיבוי וייצוא ===================== */
$('file').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  const msg = $('import-msg'); msg.className = 'msg'; msg.textContent = 'קורא…';
  try {
    const json = JSON.parse(await f.text());
    const { kind, trips } = tripsFromFile(json);
    if (!trips.length) throw new Error(`נקרא ${kind}, אבל לא נמצאו בו הפלגות (שייט).`);
    if (json.vessel && !Object.keys(J.vessel).length) J.vessel = json.vessel;
    const r = addTrips(J, trips);
    if (!save()) throw new Error('הדפדפן לא מאפשר לשמור (מצב גלישה פרטית?).');
    msg.textContent = `נקרא ${kind}: נוספו ${r.added === 1 ? 'הפלגה אחת' : r.added + ' הפלגות'}${r.dup ? `, ${r.dup} כבר היו ביומן` : ''}${r.restored ? `, ${r.restored} שוחזרו` : ''}${r.removed ? `, ${r.removed === 1 ? 'אחת נמחקה' : r.removed + ' נמחקו'}` : ''}${r.fixed ? `, ${r.fixed === 1 ? 'אחת תוקנה' : r.fixed + ' תוקנו'}` : ''}. שאר המידע בקובץ לא נשמר.`;
    renderAll(); initVessel();
  } catch (err) {
    msg.className = 'msg err';
    msg.textContent = err instanceof SyntaxError ? 'הקובץ לא נקרא – זה לא קובץ JSON תקין.' : err.message;
  }
  e.target.value = '';
});
function download(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
function doBackup() {
  const out = { format: 'marina-weather-journal/1', created: new Date().toISOString(), vessel: J.vessel, trips: J.trips.map(t => { const { wx, ...rest } = t; return { ...rest, wx: wx && !wx.error ? wx : null }; }) };
  download(`sailing-journal-${new Date().toISOString().slice(0, 10)}.json`, new Blob([JSON.stringify(out)], { type: 'application/json' }));
  J.lastBackup = new Date().toISOString(); saveJournal(J); renderBackupWarn();
}
$('backup').addEventListener('click', doBackup);

// שורות היומן – לטבלה (CSV) ולהדפסה
function logRows() {
  return visible().slice().sort((a, b) => tms(a.start) - tms(b.start)).map(t => {
    const s = tripStats(t), n = t.notes || {}, dm = wxDemand(t);
    const ws = t.wx?.rows?.map(r => r.wind).filter(v => v != null) || [], wv = t.wx?.rows?.map(r => r.wave).filter(v => v != null) || [];
    return {
      'תאריך': fmtShort(t.start) + '/' + localDate(t.start).slice(0, 4), 'יציאה': fmtTime(tStart(t)), 'סיום': `${localDate(tEnd(t)) !== localDate(tStart(t)) ? fmtShort(tEnd(t)) + ' ' : ''}${fmtTime(tEnd(t))}`,
      'מסלול': routeTxt(t, s), 'מייל': s.nm.toFixed(1), 'שעות': hrs(s.durMin), 'שעות לילה': hrs(s.nightMin), 'ימים בים': s.days || '',
      'תפקיד': n.role || 'סקיפר', 'סקיפר': n.skipper || ((n.role || 'סקיפר') === 'סקיפר' ? 'אני' : ''), 'צוות': n.crew || '',
      'רוח (תחזית)': ws.length ? `${fmt(Math.min(...ws))}–${fmt(Math.max(...ws))} קשר` : '', 'גלים (תחזית)': wv.length ? `עד ${Math.round(Math.max(...wv) * 100)} ס"מ` : '',
      'אופי הים (תחזית)': dm ? dm.t : '', 'איך הרגיש': n.feel != null ? FEEL[n.feel] : '', 'מפרשים': n.sails || '',
      'שעות מנוע': n.engStart || n.engEnd ? `${n.engStart || '?'}–${n.engEnd || '?'}` : '', 'דלק': n.fuel || '', 'תדריך בטיחות': n.safety ? 'כן' : '',
      'אירועים': n.events || '', 'הערות': n.text || '', 'מקור': t.source === 'manual' ? 'הוזן ביד' : (s.fixed ? 'Google + תיקון ידני' : 'ציר הזמן של Google')
    };
  });
}
$('csv').addEventListener('click', () => {
  const rows = logRows(); if (!rows.length) return;
  const q = v => `"${String(v).replace(/"/g, '""')}"`;
  const head = J.vessel.name ? [`${q('כלי שיט')},${q([J.vessel.name, J.vessel.type, J.vessel.loa && J.vessel.loa + ' מ׳', J.vessel.reg].filter(Boolean).join(' · '))}`, ''] : [];
  const csv = '\ufeff' + [...head, Object.keys(rows[0]).map(q).join(','), ...rows.map(r => Object.values(r).map(q).join(','))].join('\r\n');
  download(`sailing-log-${new Date().toISOString().slice(0, 10)}.csv`, new Blob([csv], { type: 'text/csv;charset=utf-8' }));
});
$('print').addEventListener('click', () => {
  const rows = logRows(); if (!rows.length) return;
  const cols = ['תאריך', 'יציאה', 'סיום', 'מסלול', 'מייל', 'שעות', 'שעות לילה', 'תפקיד', 'צוות', 'רוח (תחזית)', 'גלים (תחזית)', 'איך הרגיש', 'אירועים', 'הערות'];
  const st = visible().map(tripStats);
  const v = J.vessel;
  $('print-area').innerHTML = `<h1>יומן הפלגות</h1>
    <p>${v.name ? `כלי שיט: <b>${esc(v.name)}</b>${v.type ? ` · ${esc(v.type)}` : ''}${v.loa ? ` · ${esc(v.loa)} מ׳` : ''}${v.reg ? ` · מספר רישום ${esc(v.reg)}` : ''}${v.mmsi ? ` · MMSI/אות קריאה ${esc(v.mmsi)}` : ''}${v.home ? ` · נמל בית ${esc(v.home)}` : ''}` : ''}</p>
    <p>${rows.length} הפלגות · ${st.reduce((s, x) => s + x.nm, 0).toFixed(0)} מייל ימי · ${hrs(st.reduce((s, x) => s + x.durMin, 0))} שעות בים · ${hrs(st.reduce((s, x) => s + x.nightMin, 0))} שעות לילה · הופק ${fmtDate(Date.now())}</p>
    <table><thead><tr>${cols.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${cols.map(c => `<td>${esc(r[c])}</td>`).join('')}</tr>`).join('')}</tbody></table>
    <p class="sig">חתימת הסקיפר: ____________________</p>`;
  window.print();
});

function renderAll() {
  renderSummary(); renderList(); renderBackupWarn();
  $('backup-sec').classList.toggle('hidden', !J.trips.length);
  $('export-sec').classList.toggle('hidden', !visible().length);
}
document.querySelectorAll('[data-ico]').forEach(el => { el.innerHTML = ico(el.dataset.ico, +(el.dataset.s || 20)); });
initVessel(); initManual();
renderAll();
// מסך הבית באייפון: הסבר למי שפותח ב-Safari
try {
  const ios = /iP(hone|ad|od)/.test(navigator.userAgent), standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  if (ios && !standalone) $('home-tip').classList.remove('hidden');
} catch (_) {}
