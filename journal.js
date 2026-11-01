'use strict';
/* יומן הפלגות – נשמר בדפדפן בלבד (localStorage). מזג האוויר להפלגות שעברו נשלף מארכיון התחזיות של Open-Meteo
   (Historical Forecast API – מה שהמודלים חזו לאותן שעות) ומ-Open-Meteo Marine (גלים, גלי רוח וסוול). */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const FEEL = ['נוח', 'בינוני', 'מאתגר', 'קשה'];
let J = loadJournal();
const visible = () => J.trips.filter(t => !t.deleted);

/* ===================== סיכום ותובנות ===================== */
function renderSummary() {
  const tr = visible();
  const el = $('summary-sec');
  if (!tr.length) {
    el.innerHTML = `<h2 class="sec-h">עדיין אין הפלגות ביומן</h2><p class="hint" style="margin:0">פתחו את "הוספת הפלגות" ובחרו את קובץ ציר הזמן מ-Google, או השתמשו ב<a href="sailing-export.html">דף הסינון</a> ולחצו "הוסף ליומן".</p>`;
    $('import-sec').open = true;
    return;
  }
  const st = tr.map(tripStats);
  const nm = st.reduce((s, x) => s + x.nm, 0), hours = st.reduce((s, x) => s + x.durMin, 0) / 60;
  const year = new Date().getFullYear();
  const thisYear = tr.filter(t => new Date(t.start).getFullYear() === year).length;
  let h = `<h2 class="sec-h">סיכום</h2><div class="stats">
    <div class="stat"><div class="k">הפלגות</div><div class="v">${tr.length} <small>(${thisYear} השנה)</small></div></div>
    <div class="stat"><div class="k">מרחק</div><div class="v">${nm.toFixed(0)} <small>מייל ימי</small></div></div>
    <div class="stat"><div class="k">זמן בים</div><div class="v">${hours.toFixed(0)} <small>שעות</small></div></div>
    <div class="stat"><div class="k">הארוכה ביותר</div><div class="v">${Math.max(...st.map(x => x.nm)).toFixed(1)} <small>מייל</small></div></div>
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

/* ===================== מזג אוויר מהארכיון ===================== */
const kts = v => v == null ? null : +v;
async function fetchWx(trip) {
  const s = tripStats(trip);
  if (!s.centroid) throw new Error('אין מסלול להפלגה');
  const [lat, lng] = s.centroid.map(x => x.toFixed(4));
  const S = tStart(trip), E = tEnd(trip), d0 = localDate(S), d1 = localDate(E);
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
  const sum = [`רוח ${ws.length ? `${fmt(Math.min(...ws))}–${fmt(Math.max(...ws))} קשר (כל המודלים)` : '–'}`, `משבים עד ${gs.length ? fmt(Math.max(...gs)) : '–'}`,
    `גלים עד ${wv.length ? Math.round(Math.max(...wv) * 100) + ' ס״מ' : '– (אין נתוני גלים)'}`, rain >= 0.1 ? `גשם ${fmt(rain, 1)} מ"מ` : null].filter(Boolean).join(' · ');
  return `<p class="wx-sum">${sum}</p>
    ${dm ? `<div class="demand dm${dm.lvl}"><span class="dm-h">${ico('waves', 18)}<b>אופי הים לפי התחזית: ${dm.t}</b>${dm.d ? ` – ${dm.d}` : ''}</span>${dm.why.length ? `<span class="dm-w">${dm.why.join(' · ')}</span>` : ''}</div>` : ''}
    <div class="wx-wrap"><table class="wx-tab"><thead><tr><th>שעה</th><th>רוח<br>(מודלים)</th><th>משבים</th><th>גלים<br>ס״מ</th><th>סוול / גלי רוח</th><th>אופי</th></tr></thead><tbody>
    ${wx.rows.map(r => { const d = seaDemand(r); const ms = Object.values(r.models || {}).map(m => m.wind).filter(v => v != null);
      return `<tr><td>${r.t.slice(11, 16)}</td><td>${fmt(r.wind)}${ms.length > 1 ? `<br><small>${fmt(Math.min(...ms))}–${fmt(Math.max(...ms))}</small>` : ''}</td><td>${fmt(r.gust)}</td><td>${r.wave != null ? Math.round(r.wave * 100) : '–'}</td>
        <td>${r.sw != null ? `${Math.round(r.sw * 100)} ${from8(r.swDir)}` : '–'}<br><small>${r.ww != null ? `${Math.round(r.ww * 100)} ${from8(r.wwDir)}` : ''}</small></td>
        <td class="d${d ? d.lvl : 0}">${d ? FEEL[d.lvl] : '–'}</td></tr>`; }).join('')}
    </tbody></table></div>
    <p class="src">לפי ארכיון התחזיות של Open-Meteo (התחזית שהייתה לאותן שעות, לא מדידה), לנקודה במרכז המסלול. רוח: התחזית המשולבת, ובשורה השנייה הטווח בין ECMWF, ICON ו-GFS. גלים: Open-Meteo Marine.</p>`;
}

/* ===================== מפה ===================== */
const maps = new Map();
function initMap(el, trip) {
  if (typeof L === 'undefined' || maps.has(trip.id)) return;
  const pts = tripStats(trip).pts.map(p => [p[0], p[1]]);
  if (pts.length < 2) { el.innerHTML = '<p class="empty">אין מספיק נקודות למפה</p>'; return; }
  const m = L.map(el, { zoomControl: true, attributionControl: true, scrollWheelZoom: false });
  const base = L.tileLayer('https://t2.openseamap.org/tile/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenSeaMap, © OpenStreetMap' });
  let errs = 0, swapped = false;
  base.on('tileerror', () => { if (++errs >= 4 && !swapped) { swapped = true; m.removeLayer(base); L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', { maxZoom: 18, attribution: '© Esri' }).addTo(m); } });
  base.addTo(m);
  L.tileLayer('https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenSeaMap' }).addTo(m);
  const line = L.polyline(pts, { color: '#0b67b2', weight: 3 }).addTo(m);
  L.circleMarker(pts[0], { radius: 6, color: '#17854a', fillOpacity: 1 }).bindTooltip('יציאה').addTo(m);
  L.circleMarker(pts[pts.length - 1], { radius: 6, color: '#a32424', fillOpacity: 1 }).bindTooltip('חזרה').addTo(m);
  m.fitBounds(line.getBounds().pad(0.2));
  maps.set(trip.id, m);
  setTimeout(() => m.invalidateSize(), 50);
}

/* ===================== רשימה ופירוט ===================== */
const routeTxt = (t, s) => (t.fix && t.fix.label) || placeTxt(s);
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
        <span class="t-main"><b>${fmtDate(t.start)} · <bdi dir="ltr" class="nw">${fmtTime(tStart(t))}–${fmtTime(tEnd(t))}</bdi></b>
          <span class="t-sub">${esc(routeTxt(t, s))}</span>
          <span class="t-nums">${s.nm.toFixed(1)} מייל · ${durTxt(s.durMin)}${s.avgKn ? ` · ${s.avgKn.toFixed(1)} קשר בממוצע` : ''}</span></span>
        <span class="t-side">${miniPath(s.pts)}${feelBadge(t)}</span>
      </summary>
      <div class="t-body"></div>
    </details>`;
  }).join('');
  el.querySelectorAll('details.jtrip').forEach(d => d.addEventListener('toggle', () => { if (d.open) openTrip(d); }));
}
function tripById(id) { return J.trips.find(t => t.id === id); }
function openTrip(d) {
  const t = tripById(d.dataset.id); if (!t) return;
  const s = tripStats(t);
  const body = d.querySelector('.t-body');
  const n = t.notes || {};
  body.innerHTML = `
    <div class="stats">
      <div class="stat"><div class="k">מרחק</div><div class="v">${s.nm.toFixed(1)} <small>מייל ימי</small></div></div>
      <div class="stat"><div class="k">משך</div><div class="v">${durTxt(s.durMin)}</div></div>
      <div class="stat"><div class="k">מהירות ממוצעת</div><div class="v">${s.avgKn ? s.avgKn.toFixed(1) : '–'} <small>קשר</small></div></div>
      <div class="stat"><div class="k">מהירות מרבית (משוערת)</div><div class="v">${s.maxKn ? s.maxKn.toFixed(1) : '–'} <small>קשר</small></div></div>
      <div class="stat"><div class="k">התרחקות מקסימלית</div><div class="v">${s.farNm != null ? s.farNm.toFixed(1) : '–'} <small>מייל</small></div></div>
    </div>
    ${s.fixed ? `<p class="fix-note">${ico('info', 16)}<span><b>תוקן ידנית.</b> ${esc(t.fix.note || '')}${t.fix.nm > 0 ? ` המפה מראה רק את מה ש-Google רשמה (${s.recNm.toFixed(1)} מייל).` : ''}</span></p>` : ''}
    <div class="t-map" aria-label="מפת המסלול"></div>
    <p class="src" style="margin-top:-0.5rem">המסלול מציר הזמן של Google (נקודה כל דקה–כמה דקות, מוחלק). ${s.removed ? `הוסרו ${s.removed === 1 ? 'נקודה שגויה אחת' : s.removed + ' נקודות שגויות'} (קפיצות שיאכטה לא יכולה לעשות). ` : ''}</p>
    <section><h3 class="h3">מה התחזית אמרה</h3><div data-wx>${wxHtml(t)}</div></section>
    <section><h3 class="h3">איך הים הרגיש?</h3>
      <div class="feel" role="group" aria-label="איך הים הרגיש">${FEEL.map((f, i) => `<button type="button" data-feel="${i}" aria-pressed="${n.feel === i}">${f}</button>`).join('')}</div>
      <div class="fields">
        <label>מי היה על הסירה<input data-note="crew" value="${esc(n.crew)}" placeholder="למשל: אני + 3 אורחים"></label>
        <label>מפרשים<input data-note="sails" value="${esc(n.sails)}" placeholder="למשל: ריף ראשון, ג׳נואה מלאה"></label>
        <label class="wide">הערות<textarea data-note="text" placeholder="מה היה? מה כדאי לזכור לפעם הבאה?">${esc(n.text)}</textarea></label>
      </div>
      <div class="saved-msg" role="status"></div>
    </section>
    <details class="fix-box"${s.fixed || keepFix === t.id ? ' open' : ''}><summary>תיקון פרטים – כש-Google טעתה או פספסה חלק</summary>
      <div class="fields">
        <label class="wide">מסלול<input data-fix="label" value="${esc(t.fix?.label)}" placeholder="${esc(placeTxt(s))}"></label>
        <label>שעת יציאה<input type="time" data-fix="start" value="${fmtTime(tStart(t))}"></label>
        <label>שעת חזרה<input type="time" data-fix="end" value="${fmtTime(tEnd(t))}"></label>
        <label>מרחק כולל (מייל)<input type="number" inputmode="decimal" step="0.1" min="0" data-fix="nm" value="${t.fix?.nm > 0 ? t.fix.nm : ''}" placeholder="${s.recNm.toFixed(1)}"></label>
        <label class="wide">מה תוקן<input data-fix="note" value="${esc(t.fix?.note)}" placeholder="למשל: הדרך הלוך לא נרשמה"></label>
      </div>
      <div class="t-actions" style="margin-top:0.5rem">
        <button type="button" class="btn" data-fix-rt>הלוך ושוב באותה דרך: ${(s.recNm * 2).toFixed(1)} מייל</button>
        ${s.fixed ? '<button type="button" class="btn quiet" data-fix-clear>בטל את התיקונים</button>' : ''}
      </div>
    </details>
    <div class="t-actions"><span class="src">נשמר רק בטלפון הזה.</span><button class="btn danger" data-del>מחק מהיומן</button></div>`;
  requestAnimationFrame(() => initMap(body.querySelector('.t-map'), t));
  // הערות – שמירה אוטומטית
  const savedMsg = body.querySelector('.saved-msg');
  const save = () => { t.notes = t.notes || {}; saveJournal(J); savedMsg.textContent = 'נשמר ✓'; clearTimeout(save.tm); save.tm = setTimeout(() => { savedMsg.textContent = ''; }, 1500); };
  body.querySelectorAll('[data-feel]').forEach(b => b.addEventListener('click', () => {
    const v = +b.dataset.feel; t.notes = { ...(t.notes || {}), feel: t.notes?.feel === v ? null : v };
    body.querySelectorAll('[data-feel]').forEach(x => x.setAttribute('aria-pressed', String(+x.dataset.feel === t.notes.feel)));
    save(); d.querySelector('.t-side .feel-b')?.remove(); if (t.notes.feel != null) d.querySelector('.t-side').insertAdjacentHTML('beforeend', feelBadge(t)); renderSummary();
  }));
  body.querySelectorAll('[data-note]').forEach(inp => inp.addEventListener('input', () => { t.notes = { ...(t.notes || {}), [inp.dataset.note]: inp.value }; clearTimeout(inp.tm); inp.tm = setTimeout(save, 400); }));
  // מחיקה – לחיצה שנייה מאשרת
  const del = body.querySelector('[data-del]');
  del.addEventListener('click', () => {
    if (del.dataset.armed) { t.deleted = true; saveJournal(J); maps.delete(t.id); renderAll(); return; }
    del.dataset.armed = '1'; del.textContent = 'בטוח? לחץ שוב למחיקה';
    setTimeout(() => { if (del.isConnected) { delete del.dataset.armed; del.textContent = 'מחק מהיומן'; } }, 4000);
  });
  // תיקון פרטים – נשמר כשעוזבים שדה; שינוי שעות טוען מחדש את התחזית
  const setFix = patch => {
    const f = { ...(t.fix || {}), ...patch };
    Object.keys(f).forEach(k => { if (f[k] === '' || f[k] == null) delete f[k]; });
    if (['start', 'end'].some(k => k in patch && (patch[k] || null) !== (t.fix?.[k] || null))) t.wx = null;
    if (['label', 'start', 'end', 'nm', 'note'].every(k => (f[k] ?? null) === (t.fix?.[k] ?? null))) return;   // לא השתנה כלום
    t.fix = Object.keys(f).length ? f : null;
    saveJournal(J); reopen(t.id);
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
  body.querySelector('[data-fix-rt]').addEventListener('click', () => setFix({ nm: Math.round(s.recNm * 20) / 10, note: t.fix?.note || 'המרחק משוער – הלוך ושוב באותה דרך.' }));
  body.querySelector('[data-fix-clear]')?.addEventListener('click', () => { if (t.fix?.start || t.fix?.end) t.wx = null; t.fix = null; saveJournal(J); reopen(t.id); });
  loadWx(t, body);
}
let keepFix = null;
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

/* ===================== ייבוא וגיבוי ===================== */
$('file').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  const msg = $('import-msg'); msg.className = 'msg'; msg.textContent = 'קורא…';
  try {
    const { kind, trips } = tripsFromFile(JSON.parse(await f.text()));
    if (!trips.length) throw new Error(`נקרא ${kind}, אבל לא נמצאו בו הפלגות (שייט).`);
    const r = addTrips(J, trips);
    if (!saveJournal(J)) throw new Error('הדפדפן לא מאפשר לשמור (מצב גלישה פרטית?).');
    msg.textContent = `נקרא ${kind}: נוספו ${r.added === 1 ? 'הפלגה אחת' : r.added + ' הפלגות'}${r.dup ? `, ${r.dup} כבר היו ביומן` : ''}${r.restored ? `, ${r.restored} שוחזרו` : ''}${r.removed ? `, ${r.removed === 1 ? 'אחת נמחקה' : r.removed + ' נמחקו'}` : ''}${r.fixed ? `, ${r.fixed === 1 ? 'אחת תוקנה' : r.fixed + ' תוקנו'}` : ''}. שאר המידע בקובץ לא נשמר.`;
    renderAll();
  } catch (err) {
    msg.className = 'msg err';
    msg.textContent = err instanceof SyntaxError ? 'הקובץ לא נקרא – זה לא קובץ JSON תקין.' : err.message;
  }
  e.target.value = '';
});
$('backup').addEventListener('click', () => {
  const out = { format: 'marina-weather-journal/1', created: new Date().toISOString(), trips: J.trips.map(t => { const { wx, ...rest } = t; return { ...rest, wx: wx && !wx.error ? wx : null }; }) };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(out)], { type: 'application/json' }));
  a.download = `sailing-journal-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
});

function renderAll() { renderSummary(); renderList(); $('backup-sec').classList.toggle('hidden', !J.trips.length); }
document.querySelectorAll('[data-ico]').forEach(el => { el.innerHTML = ico(el.dataset.ico, +(el.dataset.s || 20)); });
renderAll();
