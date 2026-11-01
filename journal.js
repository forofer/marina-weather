'use strict';
/* יומן הפלגות – נשמר בדפדפן (localStorage) עם גיבוי לקובץ.
   מזג אוויר להפלגות שעברו: נתוני מודלים מהארכיון של Open-Meteo (Historical Forecast API – משרשר את השעות הראשונות של ריצות
   מודלים עוקבות; זו לא בהכרח התחזית שנראתה לפני היציאה) ו-Open-Meteo Marine. תחזית שנשמרה במסך "תכנון" נשמרת בנפרד (planFc).
   שדות היומן לפי מה שנהוג ביומן הפלגות: כלי שיט, זמנים, מאיפה ולאן, מרחק, שעות לילה, ימים בים, תפקיד, צוות, מזג אוויר וים,
   מפרשים, מנוע ודלק, תדריך בטיחות, אירועים – ומתי נוצרה ועודכנה כל רשומה. */
const $ = id => document.getElementById(id);
const esc = escHtml;
const FEEL = ['נוח', 'בינוני', 'מאתגר', 'קשה'];
const ROLES = [ROLE_NONE, 'סקיפר', 'סקיפר משנה', 'צוות'];
const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
let J = loadJournal();
const live = () => J.trips.filter(t => !t.deleted);
const hrs = m => { const h = m / 60; return h >= 10 ? h.toFixed(0) : h.toFixed(1).replace(/\.0$/, ''); };
const nowIso = () => new Date().toISOString();
const touch = t => { t.updatedAt = nowIso(); t.createdAt = t.createdAt || t.updatedAt; };
const vesselOf = t => J.vessels.find(v => v.id === t.vesselId) || null;
const stats = t => tripStats(t, vesselOf(t));
try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (_) {}

/* ===================== שמירה – תמיד בודקים שהצליחה ===================== */
function persist() {
  J.updatedAt = nowIso();
  const ok = saveJournal(J);
  const el = $('save-error');
  el.classList.toggle('hidden', ok);
  if (!ok) {
    el.innerHTML = `${ico('triangle-alert', 18)}<span><b>השמירה נכשלה.</b> הדפדפן לא מאפשר לשמור (אחסון מלא או חסום, למשל בגלישה פרטית). מה שהקלדת עדיין כאן – אל תסגרו את הדף. <span class="j-actions" style="margin-top:0.3rem"><button class="btn" data-retry-save>נסה שוב</button><button class="btn" data-dl-backup>הורד גיבוי</button></span></span>`;
    el.querySelector('[data-retry-save]').addEventListener('click', () => { if (persist()) renderAll(); });
    el.querySelector('[data-dl-backup]').addEventListener('click', doBackup);
  }
  return ok;
}

/* ===================== סיכום ===================== */
function renderSummary() {
  const tr = live();
  const st = tr.map(stats);
  const withNm = st.filter(x => x.nm != null);
  const nm = withNm.reduce((s, x) => s + x.nm, 0), mins = st.reduce((s, x) => s + x.durMin, 0), night = st.reduce((s, x) => s + x.nightMin, 0), days = st.reduce((s, x) => s + x.days, 0);
  const asSkipper = tr.filter(t => t.notes?.role === 'סקיפר').length;
  let h = `<div class="stats">
    <div class="stat"><div class="k">הפלגות</div><div class="v">${tr.length}</div></div>
    <div class="stat"><div class="k">שעות בים</div><div class="v">${hrs(mins)}</div></div>
    <div class="stat"><div class="k">מיילים ימיים</div><div class="v">${nm.toFixed(0)}</div></div>
  </div>
  <p class="sum-sub">${night >= 6 ? `${hrs(night)} שעות לילה` : 'בלי שעות לילה'}${days ? ` · ${days} ימים בים` : ''}${asSkipper ? ` · ${asSkipper} כסקיפר` : ''}${withNm.length < tr.length ? ` · ${tr.length - withNm.length === 1 ? 'הפלגה אחת' : tr.length - withNm.length + ' הפלגות'} בלי מרחק` : ''}${st.some(x => x.distKind === 'estimated') ? ' · חלק מהמרחקים הם אומדן' : ''}</p>`;
  // התחושה מול נתוני הארכיון – רק כשההערכה מלאה (רוח וגלים)
  const pairs = tr.map(t => ({ t, f: t.notes?.feel, p: wxDemand(t) })).filter(x => x.f != null && x.p && !x.p.partial);
  if (pairs.length) {
    const harder = pairs.filter(x => x.f > x.p.lvl), easier = pairs.filter(x => x.f < x.p.lvl), same = pairs.length - harder.length - easier.length;
    h += `<details class="more"><summary>התחושה שלך מול נתוני המודלים (${pairs.length === 1 ? 'הפלגה אחת' : pairs.length + ' הפלגות'})</summary>
      <p class="insight">${same} תאמו${harder.length ? ` · ${harder.length} הרגישו קשות יותר` : ''}${easier.length ? ` · ${easier.length} הרגישו קלות יותר` : ''}.</p>
      ${harder.length >= 3 && harder.length > easier.length * 2 ? '<p class="insight">הים הרגיש לך שוב ושוב קשה יותר ממה שהמודלים העריכו. אפשר לשקול להוריד את הספים בהגדרות.</p>' : ''}
      <ul class="cmp">${pairs.slice(0, 8).map(x => `<li>${fmtDate(x.t.start)}: הרגיש <b>${FEEL[x.f]}</b> · לפי המודלים: ${x.p.t}</li>`).join('')}</ul>
      <p class="src">רק הפלגות עם נתוני רוח וגלים מלאים. נתוני ארכיון לנקודות מייצגות – לא מדידה.</p></details>`;
  }
  $('summary-sec').innerHTML = h;
}

/* ===================== תזכורת גיבוי ===================== */
function renderBackupWarn() {
  const el = $('backup-warn');
  const last = J.lastBackup ? Date.parse(J.lastBackup) : 0, changed = J.updatedAt ? Date.parse(J.updatedAt) : 0;
  const need = live().length && changed > last && Date.now() - last > 14 * 86400000;
  el.classList.toggle('hidden', !need);
  if (need) {
    el.innerHTML = `${ico('triangle-alert', 18)}<span>${last ? `הגיבוי האחרון: ${fmtDate(last)}.` : 'עדיין לא נשמר גיבוי.'} היומן שמור רק בטלפון הזה.</span><button type="button" class="btn" data-backup-now>שמור גיבוי</button>`;
    el.querySelector('[data-backup-now]').addEventListener('click', doBackup);
  }
  $('last-backup').textContent = last ? `גיבוי אחרון: ${fmtDate(last)}` : 'עדיין לא נשמר גיבוי.';
}

/* ===================== נתוני מודלים מהארכיון ===================== */
const kts = v => v == null ? null : +v;
// נקודות לאורך המסלול: בהפלגה קצרה אחת (מרכז המסלול); בארוכה – עד 5, וכל שעה לוקחת את הנקודה הקרובה למיקום המשוער באותה שעה
function samplePoints(trip, s) {
  if (!s.pts.length) return [];
  const L = pathLen(s.pts) / 1852;
  if (L < 20 && s.durMin < 8 * 60) return [s.centroid];
  const k = Math.min(5, Math.max(2, Math.ceil(L / 25)));
  const S = tms(tStart(trip)), E = tms(tEnd(trip));
  // נקודות כפולות (למשל הלוך וחזור באותה דרך) – בקשה אחת לכל נקודה
  const out = [];
  Array.from({ length: k }, (_, i) => posAt(s.pts, S + (E - S) * (i + 0.5) / k, S, E)).forEach(p => { if (!out.some(q => distM(p, q) < 5000)) out.push(p); });
  return out;
}
async function fetchWx(trip) {
  const s = stats(trip);
  const pts = samplePoints(trip, s);
  if (!pts.length) throw new Error('אין מיקום להפלגה – בחרו נמלים ב"תיקון פרטים"');
  const S = tStart(trip), E = tEnd(trip), d0 = localDate(S), d1 = localDate(E);
  if (Date.parse(d1) - Date.parse(d0) > 16 * 86400000) throw new Error('ההפלגה ארוכה מדי לשליפת נתונים (יותר מ-16 ימים)');
  const tz = encodeURIComponent(TL_TZ);
  const get = async u => { const r = await fetch(u); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.reason || 'השרת לא החזיר נתונים'); return j; };
  const data = await Promise.all(pts.map(async p => {
    const [lat, lng] = p.map(x => x.toFixed(3));
    const wUrl = `https://historical-forecast-api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&start_date=${d0}&end_date=${d1}` +
      `&hourly=wind_speed_10m,wind_gusts_10m,wind_direction_10m,precipitation,weather_code&models=best_match,ecmwf_ifs025,icon_seamless,gfs_seamless&wind_speed_unit=kn&cell_selection=sea&timezone=${tz}`;
    const mUrl = `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lng}&start_date=${d0}&end_date=${d1}` +
      `&hourly=wave_height,wave_period,wave_direction,wind_wave_height,wind_wave_period,wind_wave_direction,swell_wave_height,swell_wave_period,swell_wave_direction&timezone=${tz}`;
    const [w, m] = await Promise.all([get(wUrl), get(mUrl).catch(() => null)]);
    return { p: [+lat, +lng], H: w.hourly, M: m && m.hourly };
  }));
  const t0 = localDate(S) + 'T' + String(localHour(S)).padStart(2, '0') + ':00';
  const t1 = localDate(E) + 'T' + String(localHour(E)).padStart(2, '0') + ':00';
  const gaps = trip.gapAtSea ? [] : tripGaps(trip);
  const rows = [];
  data[0].H.time.forEach((t, i) => {
    if (t < t0 || t > t1) return;
    const ms = Date.parse(localToISO(t.slice(0, 10), t.slice(11, 16)));
    if (gaps.some(g => ms > g[0] + 3600000 && ms < g[1] - 3600000)) return;   // שעות בפער שלא נרשם
    let k = 0;
    if (data.length > 1) { const here = posAt(s.pts, ms, tms(S), tms(E)); let bd = Infinity; data.forEach((d, j) => { const dd = distM(here, d.p); if (dd < bd) { bd = dd; k = j; } }); }
    const { H, M } = data[k];
    const pick = key => H[key + '_best_match']?.[i] ?? H[key]?.[i] ?? null;
    const mi = M ? M.time.indexOf(t) : -1, mv = key => mi >= 0 ? M[key][mi] : null;
    rows.push({
      t, hour: +t.slice(11, 13), pt: k, wind: kts(pick('wind_speed_10m')), gust: kts(pick('wind_gusts_10m')), dir: pick('wind_direction_10m'),
      rain: pick('precipitation'), code: pick('weather_code'),
      models: Object.fromEntries([['ECMWF', 'ecmwf_ifs025'], ['ICON', 'icon_seamless'], ['GFS', 'gfs_seamless']].map(([n, id]) => [n, { wind: kts(H['wind_speed_10m_' + id]?.[i]) }]).filter(([, v]) => v.wind != null)),
      wave: mv('wave_height'), wavePer: mv('wave_period'), waveDir: mv('wave_direction'),
      ww: mv('wind_wave_height'), wwPer: mv('wind_wave_period'), wwDir: mv('wind_wave_direction'),
      sw: mv('swell_wave_height'), swPer: mv('swell_wave_period'), swDir: mv('swell_wave_direction')
    });
  });
  if (!rows.length) throw new Error('אין נתונים לשעות האלה בארכיון');
  return { fetchedAt: nowIso(), points: data.map(d => d.p), marine: data.some(d => d.M), rows, v: 2 };
}
function wxDemand(trip) { return trip.wx && trip.wx.rows ? demandOf(trip.wx.rows) : null; }
function rowsHtml(rows, multi) {
  const show = multi ? rows.filter(r => r.hour % 3 === 0) : rows;
  return `<div class="wx-wrap"><table class="wx-tab"><thead><tr><th>${multi ? 'יום ושעה' : 'שעה'}</th><th>רוח<br>(מודלים)</th><th>משבים</th><th>גלים<br>ס״מ</th><th>סוול / גלי רוח</th><th>אופי</th></tr></thead><tbody>
    ${show.map(r => { const d = seaDemand(r); const ms = Object.values(r.models || {}).map(m => m.wind).filter(v => v != null);
      return `<tr><td>${multi ? `${+r.t.slice(8, 10)}/${+r.t.slice(5, 7)} ` : ''}${r.t.slice(11, 16)}</td><td>${fmt(r.wind)}${ms.length > 1 ? `<br><small>${fmt(Math.min(...ms))}–${fmt(Math.max(...ms))}</small>` : ''}</td><td>${fmt(r.gust)}</td><td>${r.wave != null ? Math.round(r.wave * 100) : '–'}</td>
        <td>${r.sw != null ? `${Math.round(r.sw * 100)} ${from8(r.swDir)}` : '–'}<br><small>${r.ww != null ? `${Math.round(r.ww * 100)} ${from8(r.wwDir)}` : ''}</small></td>
        <td class="d${d && !(d.partial && d.lvl < 2) ? d.lvl : 0}">${!d || (d.partial && d.lvl < 2) ? '?' : FEEL[d.lvl] + (d.partial ? '*' : '')}</td></tr>`; }).join('')}
    </tbody></table></div>`;
}
function wxSummary(rows) {
  const dm = demandOf(rows);
  const ws = rows.flatMap(r => [r.wind, ...Object.values(r.models || {}).map(m => m.wind)]).filter(v => v != null);
  const gs = rows.map(r => r.gust).filter(v => v != null), wv = rows.map(r => r.wave).filter(v => v != null);
  const rain = rows.slice(1).reduce((s, r) => s + (r.rain || 0), 0);
  const sum = [`רוח ${ws.length ? `${fmt(Math.min(...ws))}–${fmt(Math.max(...ws))} קשר (כל המודלים)` : '– (אין נתונים)'}`, `משבים עד ${gs.length ? fmt(Math.max(...gs)) : '–'}`,
    `גלים ${wv.length ? 'עד ' + Math.round(Math.max(...wv) * 100) + ' ס״מ' : '– (אין נתונים)'}`, rain >= 0.1 ? `גשם ${fmt(rain, 1)} מ"מ` : null].filter(Boolean).join(' · ');
  // חסר מידע: לא אומרים "נוח". אם נתון ידוע כבר מראה סכנה – אומרים אותה במפורש
  const dmHtml = !dm || (dm.partial && dm.lvl < 2) ? `<div class="demand dm0"><span class="dm-h">${ico('waves', 18)}<b>אין מספיק נתונים להערכת נוחות הים</b></span><span class="dm-w">${dm ? `חסרים נתוני ${dm.missing.join(' ו')}` : 'חסרים נתונים'}${dm && dm.why.length ? ' · ידוע: ' + dm.why.join(' · ') : ''}</span></div>`
    : `<div class="demand dm${dm.lvl}"><span class="dm-h">${ico('waves', 18)}<b>אופי הים לפי המודלים: ${dm.t}</b>${dm.partial ? ` – לפי הנתונים החלקיים (חסרים ${dm.missing.join(' ו')})` : dm.d ? ` – ${dm.d}` : ''}</span>${dm.why.length ? `<span class="dm-w">${dm.why.join(' · ')}</span>` : ''}</div>`;
  return `<p class="wx-sum">${sum}</p>${dmHtml}`;
}
function wxHtml(trip) {
  const wx = trip.wx;
  if (!wx) return `<p class="src" data-wx-status>טוען נתוני מודלים לשעות ההפלגה…</p>`;
  if (wx.error) return `<p class="src">לא הצלחתי לטעון את הנתונים: ${esc(wx.error)}. <button class="btn quiet" data-retry>נסה שוב</button></p>`;
  const multi = wx.rows.length > 30;
  const np = (wx.points || [1]).length;
  return `${wxSummary(wx.rows)}${rowsHtml(wx.rows, multi)}
    <p class="src">נתוני מודלים מהארכיון של Open-Meteo – לא מדידה, ולא בהכרח התחזית שנראתה לפני היציאה. ${np > 1 ? `${np} נקודות לאורך המסלול; כל שעה לפי הנקודה הקרובה למיקום המשוער (קירוב).` : 'נקודה מייצגת אחת במרכז המסלול – לא לאורך כולו.'} ${multi ? 'מוצגת שורה כל 3 שעות; הסיכום לפי כל השעות. ' : ''}${tripGaps(trip).length && !trip.gapAtSea ? 'שעות הפער שלא נרשם לא נכללות. ' : ''}? = אין מספיק נתונים · * = לפי נתונים חלקיים.</p>`;
}
function planFcHtml(t) {
  const f = t.planFc; if (!f) return '';
  return `<section><h3 class="h3">התחזית ששמרת בתכנון</h3>${wxSummary(f.rows)}${rowsHtml(f.rows, f.rows.length > 30)}
    <p class="src">כך נראתה התחזית ב-${fmtDate(f.savedAt)} ${fmtTime(f.savedAt)}, כששמרת את התכנית.</p></section>`;
}

/* ===================== מפה ===================== */
const maps = new Map();
function dropMap(id) { const m = maps.get(id); if (m) { try { m.remove(); } catch (_) {} maps.delete(id); } }
// מחלק את המסלול לקטעים שנרשמו: פער של יותר מ-20 דקות בין נקודות (או בין קטעים מאוחדים) = לא נרשם
function pieces(pts) {
  const out = [[]];
  pts.forEach((p, i) => { if (i && p[2] != null && pts[i - 1][2] != null && p[2] - pts[i - 1][2] > 20 * 60000) out.push([]); out[out.length - 1].push(p); });
  return out.filter(x => x.length);
}
function initMap(el, trip, showRaw) {
  dropMap(trip.id);
  if (typeof L === 'undefined') return;
  const s = stats(trip);
  const pts = s.pts;
  if (pts.length < 2 || pts.every(p => p[0] === pts[0][0] && p[1] === pts[0][1])) { el.innerHTML = '<p class="empty">אין מסלול להצגה במפה</p>'; el.classList.add('no-map'); return; }
  const m = L.map(el, { zoomControl: true, attributionControl: true, scrollWheelZoom: false });
  const base = L.tileLayer('https://t2.openseamap.org/tile/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenSeaMap, © OpenStreetMap' });
  let errs = 0, swapped = false;
  base.on('tileerror', () => { if (++errs >= 4 && !swapped) { swapped = true; m.removeLayer(base); L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', { maxZoom: 18, attribution: '© Esri' }).addTo(m); } });
  base.addTo(m);
  L.tileLayer('https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenSeaMap' }).addTo(m);
  const manual = trip.source !== 'google-timeline';
  const ps = manual ? [pts] : pieces(pts);
  const all = [];
  ps.forEach((pc, i) => {
    const ll_ = pc.map(p => [p[0], p[1]]); all.push(...ll_);
    if (ll_.length > 1) L.polyline(ll_, { color: '#0b67b2', weight: 3, dashArray: manual ? '6 6' : null }).addTo(m);
    if (i) { const a = ps[i - 1][ps[i - 1].length - 1]; L.polyline([[a[0], a[1]], ll_[0]], { color: '#8a94a3', weight: 2, dashArray: '2 6' }).bindTooltip('פער – לא נרשם').addTo(m); }
  });
  if (showRaw && s.suspicious.length) {
    L.polyline(s.raw.map(p => [p[0], p[1]]), { color: '#b26a00', weight: 1.5, dashArray: '4 4', opacity: 0.8 }).addTo(m);
    s.suspicious.forEach(p => { L.circleMarker([p[0], p[1]], { radius: 5, color: '#b26a00', fillOpacity: 0.6 }).bindTooltip('נקודה חשודה').addTo(m); all.push([p[0], p[1]]); });
  }
  L.circleMarker([pts[0][0], pts[0][1]], { radius: 6, color: '#17854a', fillOpacity: 1 }).bindTooltip('יציאה').addTo(m);
  L.circleMarker([pts[pts.length - 1][0], pts[pts.length - 1][1]], { radius: 6, color: '#a32424', fillOpacity: 1 }).bindTooltip('סיום').addTo(m);
  m.fitBounds(L.latLngBounds(all).pad(0.2));
  maps.set(trip.id, m);
  setTimeout(() => { if (maps.get(trip.id) === m) m.invalidateSize(); }, 60);
}

/* ===================== רשימה ===================== */
const routeTxt = (t, s) => (t.fix && t.fix.label) || placeTxt(s);
const timeRange = t => { const S = tStart(t), E = tEnd(t); return localDate(S) === localDate(E) ? `${fmtTime(S)}–${fmtTime(E)}` : `${fmtTime(S)} – ${fmtShort(E)} ${fmtTime(E)}`; };
const nmTxt = s => s.nm != null ? `${s.distKind === 'estimated' ? '~' : ''}${s.nm.toFixed(1)} מייל ימי` : 'מרחק לא הוזן';
const SRC_TXT = { 'google-timeline': 'ציר הזמן של Google', manual: 'הוזן ביד', plan: 'מתכנית הפלגה' };
function feelBadge(t) { const f = t.notes?.feel; return f != null ? `<span class="feel-b f${f}">${FEEL[f]}</span>` : ''; }
function filtered() {
  const q = $('q').value.trim().toLowerCase(), y = $('f-year').value, mo = $('f-month').value;
  return live().filter(t => {
    const d = localDate(t.start);
    if (y && d.slice(0, 4) !== y) return false;
    if (mo && +d.slice(5, 7) !== +mo) return false;
    if (!q) return true;
    const s = stats(t), n = t.notes || {};
    return [routeTxt(t, s), n.crew, n.text, n.events, n.skipper, n.sails, t.fix?.note, vesselOf(t)?.name, fmtDate(t.start)].filter(Boolean).join(' ').toLowerCase().includes(q);
  });
}
function renderFilters() {
  const years = [...new Set(live().map(t => localDate(t.start).slice(0, 4)))].sort().reverse();
  const y = $('f-year').value, mo = $('f-month').value;
  $('f-year').innerHTML = `<option value="">כל השנים</option>${years.map(v => `<option${v === y ? ' selected' : ''}>${v}</option>`).join('')}`;
  $('f-month').innerHTML = `<option value="">כל החודשים</option>${MONTHS.map((m, i) => `<option value="${i + 1}"${String(i + 1) === mo ? ' selected' : ''}>${m}</option>`).join('')}`;
}
function renderList() {
  const el = $('trips');
  maps.forEach((m, id) => dropMap(id));
  const tr = filtered();
  const all = live().length;
  $('list-sum').textContent = tr.length === all ? '' : `מוצגות ${tr.length} מתוך ${all} הפלגות`;
  if (!tr.length) { el.innerHTML = '<p class="empty">אין הפלגות שמתאימות לחיפוש.</p>'; return; }
  el.innerHTML = tr.map(t => {
    const s = stats(t);
    return `<details class="jtrip" data-id="${esc(t.id)}">
      <summary>
        <span class="t-main"><b>${fmtDate(t.start)}</b>
          <span class="t-sub"><bdi dir="ltr" class="nw t-time">${timeRange(t)}</bdi> · ${esc(routeTxt(t, s))}</span>
          <span class="t-nums">${durTxt(s.durMin)} · ${nmTxt(s)}${s.nightMin >= 30 ? ` · ${hrs(s.nightMin)} ש׳ לילה` : ''}</span>
          <span class="t-src">${SRC_TXT[t.source] || ''}${s.fixed ? ' · תוקן ביד' : ''}</span></span>
        <span class="t-side">${t.source !== 'google-timeline' ? `<span class="t-manual">${ico(t.source === 'plan' ? 'sailboat' : 'book-open', 22)}</span>` : miniPath(s.pts)}${feelBadge(t)}</span>
      </summary>
      <div class="t-body"></div>
    </details>`;
  }).join('');
  el.querySelectorAll('details.jtrip').forEach(d => d.addEventListener('toggle', () => { if (d.open) openTrip(d); else dropMap(d.dataset.id); }));
}
function tripById(id) { return J.trips.find(t => t.id === id); }

/* ===================== פירוט הפלגה ===================== */
let keepOpen = {};
function openTrip(d, showRaw) {
  const t = tripById(d.dataset.id); if (!t) return;
  const s = stats(t);
  const body = d.querySelector('.t-body');
  const n = t.notes || {};
  const manual = t.source !== 'google-timeline';
  const ko = keepOpen[t.id] || {};
  const gaps = s.gaps;
  body.innerHTML = `
    <div class="stats">
      <div class="stat"><div class="k">מרחק</div><div class="v">${s.nm != null ? `${s.nm.toFixed(1)} <small>מייל ימי</small>` : '<small>לא הוזן</small>'}</div><span class="kind">${DIST_KIND[s.distKind]}${s.distKind === 'estimated' && !t.fix?.nm ? ' (מסלול דליל)' : ''}${s.straightNm && s.nm == null ? ` · בקו ישר ${s.straightNm.toFixed(0)}` : ''}</span></div>
      <div class="stat"><div class="k">משך</div><div class="v">${durTxt(s.durMin)}</div>${gaps.length ? `<span class="kind">${t.gapAtSea ? 'כולל' : 'בלי'} ${durTxt(s.gapMin)} שלא נרשמו</span>` : ''}</div>
      <div class="stat"><div class="k">שעות לילה</div><div class="v">${hrs(s.nightMin)}</div></div>
      <div class="stat"><div class="k">מהירות ממוצעת</div><div class="v">${s.avgKn ? s.avgKn.toFixed(1) : '–'} <small>קשר</small></div></div>
    </div>
    ${s.fixed && !manual ? `<p class="note-box">${ico('info', 16)}<span><b>תוקן ביד.</b> ${esc(t.fix.note || '')}${t.fix.nm > 0 && s.recNm != null ? ` המפה מראה רק את מה ש-Google רשמה (${s.recNm.toFixed(1)} מייל ימי).` : ''}</span></p>` : ''}
    ${s.suspicious.length ? `<p class="note-box">${ico('info', 16)}<span>${s.suspicious.length === 1 ? 'נקודה חשודה אחת סוננה' : s.suspicious.length + ' נקודות חשודות סוננו'} – קפיצות חד-פעמיות שלא מתאימות למסלול. <button class="btn quiet" data-raw>${showRaw ? 'הסתר' : 'הצג במפה'}</button> <button class="btn quiet" data-noclean>בטל סינון</button></span></p>` : t.clean === false ? `<p class="note-box">${ico('info', 16)}<span>הסינון בוטל – מוצג המסלול המקורי. <button class="btn quiet" data-doclean>החזר סינון</button></span></p>` : ''}
    <div class="t-map" aria-label="מפת המסלול"></div>
    <p class="src">${manual ? 'הקו המקווקו מחבר בין הנמלים בקו ישר – זה לא המסלול האמיתי.' : `המסלול מציר הזמן של Google.${gaps.length || pieces(s.pts).length > 1 ? ' קו אפור מנוקד = פער שלא נרשם.' : ''}`}</p>
    <section><h3 class="h3">איך הים הרגיש?</h3>
      <div class="feel" role="group" aria-label="איך הים הרגיש">${FEEL.map((f, i) => `<button type="button" data-feel="${i}" aria-pressed="${n.feel === i}">${f}</button>`).join('')}</div>
      <div class="fields"><label class="wide">הערה<textarea data-note="text" placeholder="מה היה? מה כדאי לזכור לפעם הבאה?" maxlength="4000">${esc(n.text)}</textarea></label></div>
      <div class="saved-msg" role="status"></div>
    </section>
    ${planFcHtml(t)}
    <section><h3 class="h3">נתוני מודלים מהארכיון לשעות ההפלגה</h3><div data-wx>${s.pts.length ? wxHtml(t) : '<p class="src">אין מיקום להפלגה, ולכן אין נתונים. בחרו נמלים ב"תיקון פרטים".</p>'}</div></section>
    <details class="more sub-box" data-box="more"${ko.more ? ' open' : ''}><summary>פרטים נוספים: תפקיד, צוות, מנוע, אירועים</summary>
      <div class="fields">
        <label>כלי שיט<select data-vessel-sel>${`<option value="">${J.vessels.length ? 'לא צוין' : 'עדיין לא הוגדר כלי שיט'}</option>` + J.vessels.map(v => `<option value="${esc(v.id)}"${v.id === t.vesselId ? ' selected' : ''}>${esc(v.name || 'ללא שם')}</option>`).join('')}</select></label>
        <label>התפקיד שלי<select data-note="role">${ROLES.map(r => `<option${(n.role || ROLE_NONE) === r ? ' selected' : ''}>${r}</option>`).join('')}</select></label>
        <label>הסקיפר<input data-note="skipper" value="${esc(n.skipper)}" maxlength="200"></label>
        <label>מי היה על הסירה<input data-note="crew" value="${esc(n.crew)}" placeholder="למשל: אני + 3 אורחים" maxlength="500"></label>
        <label>מפרשים וריפים<input data-note="sails" value="${esc(n.sails)}" placeholder="למשל: ריף ראשון, ג׳נואה מלאה" maxlength="500"></label>
        <label>שעות מנוע ביציאה<input data-note="engStart" inputmode="decimal" value="${esc(n.engStart)}" maxlength="20"></label>
        <label>שעות מנוע בחזרה<input data-note="engEnd" inputmode="decimal" value="${esc(n.engEnd)}" maxlength="20"></label>
        <label>דלק ומים<input data-note="fuel" value="${esc(n.fuel)}" placeholder="למשל: תדלוק 40 ליטר" maxlength="300"></label>
        <label class="check"><input type="checkbox" data-note="safety"${n.safety ? ' checked' : ''}> ניתן תדריך בטיחות לצוות</label>
        <label class="wide">אירועים ותקלות<textarea data-note="events" placeholder="שינויי מפרשים, מעבר למנוע, תקלות, תיקונים…" maxlength="4000">${esc(n.events)}</textarea></label>
      </div>
      <p class="src">${SRC_TXT[t.source] || ''}${t.createdAt ? ` · נוסף ${fmtDate(t.createdAt)} ${fmtTime(t.createdAt)}` : ''}${t.updatedAt && t.updatedAt !== t.createdAt ? ` · עודכן ${fmtDate(t.updatedAt)} ${fmtTime(t.updatedAt)}` : ''}</p>
    </details>
    <details class="more sub-box" data-box="fix"${ko.fix ? ' open' : ''}><summary>${manual ? 'עריכת זמנים, נמלים ומרחק' : 'תיקון פרטים – כש-Google טעתה או פספסה חלק'}</summary>
      <div class="fields">
        <label class="wide">שם המסלול<input data-fix="label" value="${esc(t.fix?.label)}" placeholder="${esc(placeTxt(s))}" maxlength="200"></label>
        ${manual ? [['from', 'נמל יציאה', ''], ['via', 'עצירה בדרך', '—'], ['to', 'נמל סיום', '']].map(([k, l, e]) => `<div class="port-f"><label>${l}</label><select data-port="${k}">${portOptions(t.ports?.[k], e || (k === 'from' || k === 'to' ? '—' : ''))}</select><input data-port-o="${k}" class="hidden" placeholder="שם הנמל" maxlength="60" aria-label="${l} – שם"></div>`).join('') : ''}
        <label>יציאה<input type="datetime-local" data-dt="start" value="${dtLocal(tStart(t))}"></label>
        <label>סיום<input type="datetime-local" data-dt="end" value="${dtLocal(tEnd(t))}"></label>
        <label>מרחק כולל (מייל ימי)<input type="number" inputmode="decimal" step="0.1" min="0" data-fix="nm" value="${t.fix?.nm > 0 ? t.fix.nm : ''}" placeholder="${s.recNm != null ? s.recNm.toFixed(1) : 'לא הוזן'}"></label>
        ${manual ? '' : `<label class="wide">מה תוקן<input data-fix="note" value="${esc(t.fix?.note)}" placeholder="למשל: הדרך הלוך לא נרשמה" maxlength="500"></label>`}
        ${gaps.length ? `<label class="check wide"><input type="checkbox" data-gap${t.gapAtSea ? ' checked' : ''}> הייתי בים גם בפער שלא נרשם (${durTxt(s.gapMin)}) – לספור אותו</label>` : ''}
      </div>
      <div class="saved-msg" data-fix-msg role="status"></div>
      ${!manual && s.recNm != null ? `<div class="j-actions"><button type="button" class="btn" data-fix-rt>הלוך ושוב באותה דרך: ~${(s.recNm * 2).toFixed(1)} מייל ימי</button>${s.fixed ? '<button type="button" class="btn quiet" data-fix-clear>בטל את התיקונים</button>' : ''}</div>` : ''}
    </details>
    <div class="t-actions"><span></span><button class="btn danger" data-del>${ico('trash-2', 16)}מחק</button></div>`;
  setTimeout(() => { if (body.isConnected) initMap(body.querySelector('.t-map'), t, showRaw); }, 0);
  body.querySelectorAll('[data-box]').forEach(b => b.addEventListener('toggle', () => { keepOpen[t.id] = { ...(keepOpen[t.id] || {}), [b.dataset.box]: b.open }; }));
  const savedMsg = body.querySelector('.saved-msg');
  const saved = (msgEl = savedMsg) => {
    touch(t);
    const ok = persist();
    msgEl.classList.toggle('err', !ok);
    msgEl.textContent = ok ? 'נשמר ✓' : 'לא נשמר! ראו את ההודעה למעלה';
    clearTimeout(saved.tm); if (ok) saved.tm = setTimeout(() => { msgEl.textContent = ''; }, 1500);
    renderBackupWarn();
    return ok;
  };
  body.querySelectorAll('[data-feel]').forEach(b => b.addEventListener('click', () => {
    const v = +b.dataset.feel; t.notes = { ...(t.notes || {}), feel: t.notes?.feel === v ? undefined : v };
    if (t.notes.feel === undefined) delete t.notes.feel;
    body.querySelectorAll('[data-feel]').forEach(x => x.setAttribute('aria-pressed', String(+x.dataset.feel === t.notes.feel)));
    saved(); d.querySelector('.t-side .feel-b')?.remove(); if (t.notes.feel != null) d.querySelector('.t-side').insertAdjacentHTML('beforeend', feelBadge(t)); renderSummary();
  }));
  const moreMsg = () => body.querySelector('[data-box="more"] .src');
  body.querySelectorAll('[data-note]').forEach(inp => {
    const val = () => inp.type === 'checkbox' ? inp.checked : inp.value;
    const ev = inp.tagName === 'SELECT' || inp.type === 'checkbox' ? 'change' : 'input';
    inp.addEventListener(ev, () => {
      const v = val();
      t.notes = { ...(t.notes || {}), [inp.dataset.note]: v };
      if (v === '' || v === false || v === ROLE_NONE) delete t.notes[inp.dataset.note];
      clearTimeout(inp.tm); inp.tm = setTimeout(() => { saved(); if (inp.dataset.note === 'role') renderSummary(); }, ev === 'change' ? 0 : 400);
    });
  });
  body.querySelector('[data-vessel-sel]').addEventListener('change', e => { t.vesselId = e.target.value || undefined; if (!t.vesselId) delete t.vesselId; saved(); });
  // מחיקה רכה – אפשר לשחזר מ"נמחקו לאחרונה"
  const del = body.querySelector('[data-del]');
  del.addEventListener('click', () => {
    if (del.dataset.armed) { t.deleted = true; t.deletedAt = nowIso(); touch(t); persist(); renderAll(); flash(`ההפלגה נמחקה. אפשר לשחזר ב"נמחקו לאחרונה".`); return; }
    del.dataset.armed = '1'; del.innerHTML = `${ico('trash-2', 16)}בטוח? לחץ שוב`;
    setTimeout(() => { if (del.isConnected) { delete del.dataset.armed; del.innerHTML = `${ico('trash-2', 16)}מחק`; } }, 4000);
  });
  // תיקונים
  const fixMsg = body.querySelector('[data-fix-msg]');
  const setFix = patch => {
    const f = { ...(t.fix || {}), ...patch };
    Object.keys(f).forEach(k => { if (f[k] === '' || f[k] == null) delete f[k]; });
    const keys = ['label', 'start', 'end', 'nm', 'note', 'est'];
    if (keys.every(k => (f[k] ?? null) === (t.fix?.[k] ?? null))) return;
    if (['start', 'end'].some(k => k in patch && (patch[k] || null) !== (t.fix?.[k] || null))) t.wx = null;
    t.fix = Object.keys(f).length ? f : null;
    touch(t); persist(); keepOpen[t.id] = { ...(keepOpen[t.id] || {}), fix: true }; reopen(t.id);
  };
  body.querySelectorAll('[data-fix]').forEach(inp => inp.addEventListener('change', () => {
    const k = inp.dataset.fix, v = inp.value.trim();
    if (k === 'nm') setFix({ nm: v && +v > 0 ? Math.round(+v * 10) / 10 : null, est: null });
    else setFix({ [k]: v || null });
  }));
  body.querySelectorAll('[data-dt]').forEach(inp => inp.addEventListener('change', () => {
    const v = inp.value; if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(v)) return;
    const val = localToISO(v.slice(0, 10), v.slice(11, 16));
    const k = inp.dataset.dt;
    const ns = k === 'start' ? val : tStart(t), ne = k === 'end' ? val : tEnd(t);
    if (tms(ne) <= tms(ns)) { fixMsg.classList.add('err'); fixMsg.textContent = 'הסיום חייב להיות אחרי היציאה – לא נשמר.'; inp.value = dtLocal(k === 'start' ? tStart(t) : tEnd(t)); return; }
    if (tms(ne) - tms(ns) > MAX_DAYS * 86400000) { fixMsg.classList.add('err'); fixMsg.textContent = `הפלגה ארוכה מ-${MAX_DAYS} ימים – בדקו את התאריכים.`; return; }
    if (manual) { t.start = ns; t.end = ne; t.wx = null; touch(t); persist(); keepOpen[t.id] = { ...(keepOpen[t.id] || {}), fix: true }; reopen(t.id); }
    else setFix({ [k]: dtLocal(val) === dtLocal(k === 'start' ? t.start : t.end) ? null : val });
  }));
  body.querySelectorAll('[data-port]').forEach(sel => {
    const other = body.querySelector(`[data-port-o="${sel.dataset.port}"]`);
    wirePort(sel, other);
    const apply = () => {
    if (sel.value === OTHER && !other.value.trim()) return;
    t.ports = { ...(t.ports || {}), [sel.dataset.port]: portVal(sel, other) };
    Object.keys(t.ports).forEach(k => { if (!t.ports[k]) delete t.ports[k]; });
    t.path = portsPath(t.ports); t.wx = null; touch(t); persist(); keepOpen[t.id] = { ...(keepOpen[t.id] || {}), fix: true }; reopen(t.id);
    };
    sel.addEventListener('change', () => { if (sel.value !== OTHER) apply(); });
    other.addEventListener('change', apply);
  });
  body.querySelector('[data-gap]')?.addEventListener('change', e => { t.gapAtSea = e.target.checked || undefined; if (!t.gapAtSea) delete t.gapAtSea; t.wx = null; touch(t); persist(); keepOpen[t.id] = { ...(keepOpen[t.id] || {}), fix: true }; reopen(t.id); });
  body.querySelector('[data-fix-rt]')?.addEventListener('click', () => setFix({ nm: Math.round(s.recNm * 20) / 10, est: true, note: t.fix?.note || 'המרחק הוא אומדן – הלוך ושוב באותה דרך.' }));
  body.querySelector('[data-fix-clear]')?.addEventListener('click', () => { if (t.fix?.start || t.fix?.end) t.wx = null; t.fix = null; touch(t); persist(); reopen(t.id); });
  body.querySelector('[data-raw]')?.addEventListener('click', () => openTrip(d, !showRaw));
  body.querySelector('[data-noclean]')?.addEventListener('click', () => { t.clean = false; t.wx = null; touch(t); persist(); reopen(t.id); });
  body.querySelector('[data-doclean]')?.addEventListener('click', () => { delete t.clean; t.wx = null; touch(t); persist(); reopen(t.id); });
  if (s.pts.length) loadWx(t, body);
}
const portsPath = p => ['from', 'via', 'to'].map(k => p && portByName(p[k])).filter(Boolean).map(x => [x[1], x[2], null]);
function reopen(id) {
  const y = window.scrollY; renderAll();
  const d = [...document.querySelectorAll('details.jtrip')].find(x => x.dataset.id === id);
  if (d) d.open = true;
  window.scrollTo(0, y);
}
async function loadWx(t, body) {
  const box = body.querySelector('[data-wx]');
  const retry = () => box.querySelector('[data-retry]')?.addEventListener('click', () => { box.innerHTML = wxHtml({ ...t, wx: null }); loadWx(t, body); });
  if (t.wx && !t.wx.error && t.wx.v === 2) return;
  let wx;
  try { wx = await fetchWx(t); t.wx = wx; persist(); }
  catch (e) { wx = { error: /fetch|network|load failed/i.test(e.message) ? 'אין חיבור לאינטרנט או שהשרת לא זמין' : e.message }; }
  if (!box.isConnected) return;
  box.innerHTML = wxHtml(wx.error ? { ...t, wx } : t);
  if (wx.error) { retry(); return; }   // שגיאה לא נשמרת – בפתיחה הבאה ננסה שוב
  renderSummary();
}
function flash(msg) { const el = $('list-sum'); el.textContent = msg; }

/* ===================== נמחקו לאחרונה ===================== */
function renderDeleted() {
  const del = J.trips.filter(t => t.deleted).sort((a, b) => (b.deletedAt || '').localeCompare(a.deletedAt || ''));
  $('deleted-sec').classList.toggle('hidden', !del.length);
  $('deleted-sec').querySelector('summary').textContent = `נמחקו לאחרונה (${del.length})`;
  $('deleted-list').innerHTML = del.map(t => `<div class="del-row"><span>${fmtDate(t.start)} · ${esc(routeTxt(t, stats(t)))}</span><span class="j-actions"><button class="btn" data-undel="${esc(t.id)}">${ico('rotate-ccw', 16)}שחזר</button><button class="btn quiet" data-purge="${esc(t.id)}">מחק לצמיתות</button></span></div>`).join('');
  $('deleted-list').querySelectorAll('[data-undel]').forEach(b => b.addEventListener('click', () => { const t = tripById(b.dataset.undel); t.deleted = false; delete t.deletedAt; touch(t); persist(); renderAll(); }));
  $('deleted-list').querySelectorAll('[data-purge]').forEach(b => b.addEventListener('click', () => {
    if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'בטוח? אי אפשר לשחזר'; return; }
    J.trips = J.trips.filter(t => t.id !== b.dataset.purge); persist(); renderAll();
  }));
}

/* ===================== תכניות שעברו (מסך "תכנון") ===================== */
const planKey = p => `${p.date}-${p.from}-${p.to}`;
function pastPlans() {
  let plans = [];
  try { plans = JSON.parse(localStorage.getItem('trips_v1')) || []; } catch (_) {}
  if (!Array.isArray(plans)) return [];
  const done = new Set(J.plansDone || []);
  return plans.filter(p => p && /^\d{4}-\d\d-\d\d$/.test(p.date) && Number.isInteger(+p.from) && +p.to > +p.from).map(p => {
    const start = localToISO(p.date, String(+p.from).padStart(2, '0') + ':00');
    const end = new Date(Date.parse(localToISO(p.date, '00:00')) + +p.to * 3600000).toISOString();
    return { ...p, start, end };
  }).filter(p => Date.parse(p.end) < Date.now() && !done.has(planKey(p)) && classifyTrip(J, { start: p.start, end: p.end }).status === 'new');
}
function renderPlans() {
  const ps = pastPlans();
  $('plans-sec').classList.toggle('hidden', !ps.length);
  $('plans-sec').innerHTML = ps.map(p => `<div class="card plan-card"><span><b>הפלגתם?</b> תכנית ${fmtDate(p.start)} · <bdi dir="ltr">${fmtTime(p.start)}–${fmtTime(p.end)}</bdi>${p.fc ? ' · עם התחזית ששמרת' : ''}</span>
    <span class="j-actions"><button class="btn primary" data-plan-add="${esc(planKey(p))}">הוסף ליומן</button><button class="btn quiet" data-plan-no="${esc(planKey(p))}">לא הפלגנו</button></span></div>`).join('');
  $('plans-sec').querySelectorAll('[data-plan-add]').forEach(b => b.addEventListener('click', () => {
    const p = ps.find(x => planKey(x) === b.dataset.planAdd);
    const ports = { from: 'מרינה הרצליה', to: 'מרינה הרצליה' };
    const t = normTrip({ id: 'p-' + p.start, start: p.start, end: p.end, source: 'plan', ports, path: portsPath(ports), vesselId: J.defaultVessel,
      planFc: p.fc && Array.isArray(p.fc.rows) ? p.fc : undefined, notes: {} });
    touch(t); J.trips.push(t); J.trips.sort((a, x) => tms(x.start) - tms(a.start));
    J.plansDone = [...(J.plansDone || []), planKey(p)];
    if (persist()) { keepOpen[t.id] = { fix: true }; renderAll(); const d = [...document.querySelectorAll('details.jtrip')].find(x => x.dataset.id === t.id); if (d) { d.open = true; d.scrollIntoView({ block: 'start' }); } flash('נוסף ליומן – אפשר לתקן את השעות בפועל ב"עריכת זמנים".'); }
  }));
  $('plans-sec').querySelectorAll('[data-plan-no]').forEach(b => b.addEventListener('click', () => { J.plansDone = [...(J.plansDone || []), b.dataset.planNo]; persist(); renderPlans(); }));
}

/* ===================== ייבוא: קובץ → בדיקה → בחירה → הוספה ===================== */
let IMP = null;
const tick = () => new Promise(r => setTimeout(r, 0));
$('file').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  const st = $('imp-status'); st.className = 'msg';
  try {
    if (f.size > 300 * 1024 * 1024) throw new Error('הקובץ גדול מדי (יותר מ-300MB).');
    st.textContent = `קורא את הקובץ (${(f.size / 1048576).toFixed(1)}MB)…`; await tick();
    const text = await f.text();
    st.textContent = 'מפענח…'; await tick();
    let json; try { json = JSON.parse(text); } catch (_) { throw new Error('זה לא קובץ JSON תקין. בחרו את הקובץ שמייצאים מ-Google Maps, או גיבוי של היומן.'); }
    st.textContent = 'מחפש הפלגות…'; await tick();
    const r = readAnyFile(json);
    IMP = { ...r, from: '', to: '', merge: false };
    st.textContent = '';
    buildCands(); showStep2();
  } catch (err) { st.className = 'msg err'; st.textContent = err.message; }
});
// מועמדים לייבוא, כל אחד עם סטטוס ופעולה מוצעת
function buildCands() {
  const I = IMP;
  if (I.kind === 'backup') {
    I.cands = I.trips.map(t => {
      const ex = J.trips.find(x => x.id === t.id);
      if (ex && BAD_FIX.has(t)) return { t, status: 'תיקון הזמנים בגיבוי לא תקין', cls: 'warn', acts: ['skip', 'replace'], act: 'skip', match: ex };
      if (ex) {
        const a = JSON.stringify({ ...ex, wx: null, updatedAt: null }), b = JSON.stringify({ ...t, wx: null, updatedAt: null });
        if (a === b) return { t, status: 'זהה', cls: '', acts: ['skip'], act: 'skip', match: ex };
        if (t.deleted && !ex.deleted) return { t, status: 'בגיבוי היא מחוקה', cls: 'warn', acts: ['skip', 'delete'], act: 'skip', match: ex };
        if (!t.deleted && ex.deleted) return { t, status: 'נמחקה כאן', cls: 'warn', acts: ['skip', 'restore'], act: 'skip', match: ex };
        const newer = (t.updatedAt || '') > (ex.updatedAt || '');
        return { t, status: newer ? 'בגיבוי גרסה חדשה יותר' : 'כאן גרסה חדשה יותר', cls: 'warn', acts: ['skip', 'replace'], act: newer ? 'replace' : 'skip', match: ex };
      }
      if (t.deleted) return { t, status: 'מחוקה בגיבוי', cls: '', acts: ['add', 'skip'], act: 'add', addLabel: 'שמור ב"נמחקו לאחרונה"' };
      return candFor(t);
    });
  } else {
    const acts = I.google.acts.filter(a => I.from ? (localDate(a.end) >= I.from && localDate(a.start) <= (I.to || I.from)) : SAIL_RE.test(a.type));
    I.shown = acts.slice(0, 300);
    I.cands = I.shown.map(a => {
      const c = candFor(toJournalTrip(a));
      c.type = a.type;
      if (I.from && LAND_RE.test(a.type)) c.act = 'skip';
      return c;
    });
  }
}
function candFor(t) {
  if (!t) return null;
  if (BAD_FIX.has(t)) return { t, s: tripStats(t), status: 'תיקון הזמנים בקובץ לא תקין', cls: 'warn', acts: ['add', 'skip'], act: 'add', addLabel: 'הוסף בלי תיקון הזמנים', match: null };
  const c = classifyTrip(J, t);
  const s = tripStats(t);
  const base = { t, s, match: c.match };
  if (c.status === 'same') return { ...base, status: c.match.deleted ? 'נמחקה מהיומן' : 'כבר ביומן', cls: '', acts: ['skip', 'separate'], act: 'skip' };
  if (c.status === 'part') return { ...base, status: 'קטע של הפלגה שביומן', cls: 'warn', acts: ['merge', 'separate', 'skip'], act: 'merge' };
  if (c.status === 'conflict') return { ...base, status: 'חופפת חלקית להפלגה שביומן', cls: 'warn', acts: ['skip', 'separate', 'merge'], act: 'skip' };
  return { ...base, status: 'חדשה', cls: 'new', acts: ['add', 'skip'], act: 'add' };
}
const ACT_TXT = { add: 'הוסף', skip: 'דלג', separate: 'הוסף בנפרד', merge: 'מזג עם ההפלגה שביומן', replace: 'עדכן לגרסה מהגיבוי', restore: 'שחזר', delete: 'מחק גם כאן' };
function showStep2() {
  const I = IMP;
  $('imp-step1').classList.add('hidden'); $('imp-step2').classList.remove('hidden');
  $('imp-date').classList.toggle('hidden', I.kind !== 'google');
  $('merge-row').classList.toggle('hidden', !I.from);
  const bad = I.kind === 'google' ? I.google.bad : I.bad;
  const total = I.kind === 'google' ? I.google.acts.length : I.trips.length;
  $('imp-found').textContent = `${I.label}: ${I.kind === 'google' ? (I.from ? `${I.cands.length} קטעים בתאריכים שנבחרו` : `${I.cands.length === 1 ? 'נמצאה הפלגה אחת' : `נמצאו ${I.cands.length} הפלגות`} (מתוך ${total} קטעי תנועה)`) : `${I.cands.length} הפלגות בגיבוי`}${bad ? ` · ${bad} רשומות לא תקינות דולגו` : ''}${I.shown && I.google.acts.length > I.shown.length && I.from ? ' · מוצגים 300 הראשונים – צמצמו את התאריכים' : ''}.`;
  const list = $('imp-list');
  if (!I.cands.length) list.innerHTML = `<p class="empty">${I.kind === 'google' ? (I.from ? 'Google לא רשמה שום תנועה בתאריכים האלה. אפשר להוסיף את ההפלגה ביד.' : 'לא נמצאו קטעים ש-Google סימנה כשייט. נסו חיפוש לפי תאריכים למטה.') : 'אין הפלגות בגיבוי.'}</p>`;
  else list.innerHTML = I.cands.map((c, i) => {
    const s = c.s || tripStats(c.t);
    return `<div class="imp-row${c.act === 'skip' ? ' skip' : ''}" data-i="${i}">
      <span class="meta"><b>${fmtDate(c.t.start)} · <bdi dir="ltr" class="nw">${timeRange(c.t)}</bdi></b>
        <small>${c.type ? esc(typeName(c.type)) + ' · ' : ''}${durTxt(s.durMin)} · ${nmTxt(s)}${s.suspicious.length ? ` · ${s.suspicious.length} נקודות חשודות` : ''}${c.t.notes && Object.keys(c.t.notes).length ? ' · עם הערות' : ''}</small>
        <span><span class="badge ${c.cls}">${esc(c.status)}</span>${c.match && c.status !== 'חדשה' ? ` <small>(${fmtDate(c.match.start)} ${timeRange(c.match)})</small>` : ''}</span></span>
      ${c.t.source !== 'google-timeline' ? `<span class="t-manual">${ico('book-open', 20)}</span>` : miniPath(s.pts)}
      <select aria-label="מה לעשות">${c.acts.map(a => `<option value="${a}"${a === c.act ? ' selected' : ''}>${a === 'add' && c.addLabel ? c.addLabel : ACT_TXT[a]}</option>`).join('')}</select>
    </div>`;
  }).join('');
  list.querySelectorAll('.imp-row select').forEach(sel => sel.addEventListener('change', () => {
    const row = sel.closest('.imp-row'); IMP.cands[+row.dataset.i].act = sel.value; row.classList.toggle('skip', sel.value === 'skip'); planLine();
  }));
  planLine();
}
function planLine() {
  const c = IMP.cands, n = a => c.filter(x => x.act === a).length;
  const keepDel = c.filter(x => x.act === 'add' && x.t.deleted).length;
  const add = n('add') + n('separate') - keepDel, parts = [];
  if (keepDel) parts.push(`${keepDel} יישמרו כמחוקות`);
  if (IMP.merge && IMP.from && n('add') > 1) parts.push(`${n('add')} קטעים יאוחדו להפלגה אחת`);
  else if (add) parts.push(`${add === 1 ? 'הפלגה אחת תתווסף' : add + ' הפלגות יתווספו'}`);
  if (n('merge')) parts.push(`${n('merge')} ימוזגו להפלגות קיימות`);
  if (n('replace')) parts.push(`${n('replace')} יתעדכנו`);
  if (n('restore')) parts.push(`${n('restore')} ישוחזרו`);
  if (n('delete')) parts.push(`${n('delete')} יימחקו`);
  if (n('skip')) parts.push(`${n('skip')} ידולגו`);
  $('imp-plan').textContent = parts.join(' · ') || 'אין מה להוסיף.';
  $('imp-apply').disabled = c.every(x => x.act === 'skip');
}
['d-from', 'd-to'].forEach(id => $(id).addEventListener('change', () => {
  if (id === 'd-from' && !$('d-to').value) $('d-to').value = $('d-from').value;
  if ($('d-to').value && $('d-from').value && $('d-to').value < $('d-from').value) $('d-to').value = $('d-from').value;
  IMP.from = $('d-from').value; IMP.to = $('d-to').value; buildCands(); showStep2();
}));
$('d-clear').addEventListener('click', () => { $('d-from').value = $('d-to').value = ''; IMP.from = IMP.to = ''; IMP.merge = false; $('merge').checked = false; buildCands(); showStep2(); });
$('merge').addEventListener('change', e => { IMP.merge = e.target.checked; planLine(); });
$('imp-again').addEventListener('click', resetImport);
function resetImport() { IMP = null; $('imp-step1').classList.remove('hidden'); $('imp-step2').classList.add('hidden'); $('imp-status').textContent = ''; $('d-from').value = $('d-to').value = ''; $('merge').checked = false; }
$('imp-apply').addEventListener('click', () => {
  const I = IMP; if (!I) return;
  const snapshot = JSON.stringify(J);
  const stamp = t => { touch(t); if (!t.vesselId && J.defaultVessel && t.source === 'google-timeline') t.vesselId = J.defaultVessel; return t; };
  let added = 0, merged = 0, updated = 0;   // added לא כולל רשומות מחוקות שנשמרות לזיכרון
  // איחוד קטעים מתאריכים (Google) להפלגה אחת
  let list = I.cands;
  if (I.kind === 'google' && I.merge && I.from) {
    const sel = I.cands.filter(c => c.act === 'add');
    if (sel.length > 1) {
      const m = toJournalTrip(mergeActs(sel.map(c => ({ start: tms(c.t.start), end: tms(c.t.end), path: c.t.path.map(p => [p[0], p[1], tms(p[2])]) }))));
      // אם ההפלגה המאוחדת חופפת להפלגה שכבר ביומן – ממזגים לתוכה במקום ליצור כפילות
      const cm = classifyTrip(J, m);
      list = [...I.cands.filter(c => c.act !== 'add'), cm.status === 'new' || cm.match?.deleted ? { t: m, act: 'add' } : { t: m, act: 'merge', match: cm.match }];
    }
  }
  for (const c of list) {
    const t = c.t;
    if (c.act === 'add' || c.act === 'separate') {
      const nt = { ...t };
      if (J.trips.some(x => x.id === nt.id)) nt.id = nt.id + '-' + Math.random().toString(36).slice(2, 6);
      if (I.kind !== 'backup') stamp(nt); else if (!nt.createdAt) touch(nt);
      J.trips.push(nt); if (!nt.deleted) added++;
    } else if (c.act === 'merge' && c.match) { mergeInto(c.match, t); touch(c.match); merged++; }
    else if (c.act === 'replace' && c.match) { Object.keys(c.match).forEach(k => delete c.match[k]); Object.assign(c.match, t); updated++; }
    else if (c.act === 'restore' && c.match) { Object.keys(c.match).forEach(k => delete c.match[k]); Object.assign(c.match, t, { deleted: false }); delete c.match.deletedAt; updated++; }
    else if (c.act === 'delete' && c.match) { c.match.deleted = true; c.match.deletedAt = nowIso(); touch(c.match); updated++; }
  }
  // כלי שיט מהגיבוי שעדיין אין כאן
  if (I.vessels) I.vessels.forEach(v => { if (v && v.id && !J.vessels.some(x => x.id === v.id)) J.vessels.push(normVessel(v)); });
  if (!J.defaultVessel && I.defaultVessel && J.vessels.some(v => v.id === I.defaultVessel)) J.defaultVessel = I.defaultVessel;
  if (!J.defaultVessel && J.vessels.length) J.defaultVessel = J.vessels[0].id;
  if (I.plansDone && I.plansDone.length) J.plansDone = [...new Set([...(J.plansDone || []), ...I.plansDone])];
  J.trips.sort((a, b) => tms(b.start) - tms(a.start));
  if (!persist()) { J = JSON.parse(snapshot); return; }
  closePanels();
  renderAll();
  flash(`נוספו ${added}${merged ? `, מוזגו ${merged}` : ''}${updated ? `, עודכנו ${updated}` : ''}.`);
});

/* ===================== הוספה ידנית ===================== */
// בחירת נמל: מהרשימה, או "נמל אחר" עם שם חופשי
const OTHER = '__other';
const portOptions = (sel, empty) => `${empty ? `<option value="">${empty}</option>` : ''}${PORTS.map(p => `<option${p[0] === sel ? ' selected' : ''}>${esc(p[0])}</option>`).join('')}${sel && !portByName(sel) ? `<option selected>${esc(sel)}</option>` : ''}<option value="${OTHER}">נמל אחר…</option>`;
function wirePort(sel, other) {
  const sync = () => { other.classList.toggle('hidden', sel.value !== OTHER); if (sel.value === OTHER) other.focus(); };
  sel.addEventListener('change', sync); sync();
}
const portVal = (sel, other) => sel.value === OTHER ? (other.value.trim().slice(0, 60) || null) : (sel.value || null);
function initManual() {
  $('m-from').innerHTML = portOptions('מרינה הרצליה'); $('m-to').innerHTML = portOptions('מרינה הרצליה'); $('m-via').innerHTML = portOptions('', '—');
  ['from', 'to', 'via'].forEach(k => wirePort($('m-' + k), $('m-' + k + '-o')));
  // היום / אתמול – בוחרים תאריך; שעות לא משלימים מעצמנו
  document.querySelectorAll('[data-day]').forEach(b => b.addEventListener('click', () => { $('m-date').value = localDate(Date.now() - +b.dataset.day * 86400000); $('m-t0').focus(); }));
  $('m-multi').addEventListener('change', e => { $('m-end-date-l').classList.toggle('hidden', !e.target.checked); if (e.target.checked && !$('m-end-date').value) $('m-end-date').value = $('m-date').value; });
  $('m-add').addEventListener('click', () => {
    const msg = $('m-msg'); msg.className = 'msg err';
    const d0 = $('m-date').value, d1 = $('m-multi').checked ? $('m-end-date').value : d0, a = $('m-t0').value, b = $('m-t1').value;
    if (!d0 || !a || !b || !d1) { msg.textContent = 'צריך תאריך, שעת יציאה ושעת חזרה.'; return; }
    const start = localToISO(d0, a), end = localToISO(d1, b);
    if (tms(end) <= tms(start)) { msg.textContent = $('m-multi').checked ? 'הסיום חייב להיות אחרי היציאה.' : 'שעת החזרה לפני שעת היציאה. אם חזרתם אחרי חצות – סמנו "החזרה הייתה ביום אחר".'; return; }
    if (tms(end) - tms(start) > MAX_DAYS * 86400000) { msg.textContent = `הפלגה ארוכה מ-${MAX_DAYS} ימים – בדקו את התאריכים.`; return; }
    const ports = { from: portVal($('m-from'), $('m-from-o')), via: portVal($('m-via'), $('m-via-o')), to: portVal($('m-to'), $('m-to-o')) };
    const nm = +$('m-nm').value, label = $('m-label').value.trim();
    const t = normTrip({ id: 'm-' + start, start, end, source: 'manual', ports, path: portsPath(ports), vesselId: J.defaultVessel,
      fix: { label: label || null, nm: nm > 0 ? nm : null }, notes: {} });
    const c = classifyTrip(J, t);
    if (c.status !== 'new' && !c.match.deleted) { msg.textContent = `יש כבר ביומן הפלגה בזמנים האלה (${fmtDate(c.match.start)} ${timeRange(c.match)}).`; return; }
    if (J.trips.some(x => x.id === t.id)) t.id += '-' + Math.random().toString(36).slice(2, 6);
    touch(t); J.trips.push(t); J.trips.sort((x, y) => tms(y.start) - tms(x.start));
    if (!persist()) { J.trips = J.trips.filter(x => x !== t); return; }
    msg.className = 'msg'; msg.textContent = '';
    ['m-date', 'm-t0', 'm-t1', 'm-end-date', 'm-nm', 'm-label', 'm-from-o', 'm-to-o', 'm-via-o'].forEach(id => { $(id).value = ''; });
    $('m-multi').checked = false; $('m-end-date-l').classList.add('hidden');
    closePanels(); renderAll(); flash('ההפלגה נוספה ✓');
    const d = [...document.querySelectorAll('details.jtrip')].find(x => x.dataset.id === t.id);
    if (d) { d.open = true; d.scrollIntoView({ block: 'start' }); }
  });
}

/* ===================== כלי שיט ===================== */
const VFIELDS = [['name', 'שם הסירה', ''], ['type', 'סוג ודגם', 'למשל: מפרשית 40 רגל'], ['loa', 'אורך (מטר)', '12'], ['reg', 'מספר רישום', ''], ['mmsi', 'MMSI / אות קריאה', ''], ['home', 'נמל בית', 'מרינה הרצליה'], ['maxKn', 'מהירות מרבית סבירה (קשר)', String(DEF_MAX_KN)]];
const normVessel = v => Object.fromEntries([['id', str(v.id, 40)], ...VFIELDS.map(([k]) => [k, v[k] != null ? str(v[k], 200) : ''])]);
function renderVessels() {
  const el = $('vessels');
  if (!J.vessels.length) { el.innerHTML = '<p class="hint" style="margin:0">עדיין לא הוגדר כלי שיט.</p>'; return; }
  const noVessel = live().filter(t => !t.vesselId).length;
  el.innerHTML = J.vessels.map(v => `<div class="vessel" data-v="${esc(v.id)}"><div class="fields">${VFIELDS.map(([k, l, ph]) => `<label>${l}<input data-vf="${k}" value="${esc(v[k])}" placeholder="${esc(ph)}"${k === 'loa' || k === 'maxKn' ? ' inputmode="decimal"' : ''} maxlength="200"></label>`).join('')}</div>
    <div class="j-actions" style="margin-top:0.4rem"><label class="check"><input type="radio" name="defv" value="${esc(v.id)}"${J.defaultVessel === v.id ? ' checked' : ''}> ברירת המחדל להפלגות חדשות</label>
    ${noVessel ? `<button class="btn quiet" data-assign>שייך לה ${noVessel === 1 ? 'הפלגה אחת' : noVessel + ' הפלגות'} בלי כלי שיט</button>` : ''}<span class="saved-msg" data-vmsg></span></div></div>`).join('');
  el.querySelectorAll('.vessel').forEach(box => {
    const v = J.vessels.find(x => x.id === box.dataset.v);
    const msg = box.querySelector('[data-vmsg]');
    box.querySelectorAll('[data-vf]').forEach(inp => inp.addEventListener('input', () => {
      v[inp.dataset.vf] = inp.value.trim(); clearTimeout(inp.tm);
      inp.tm = setTimeout(() => { const ok = persist(); msg.classList.toggle('err', !ok); msg.textContent = ok ? 'נשמר ✓' : 'לא נשמר!'; if (inp.dataset.vf === 'maxKn') renderList(); }, 400);
    }));
    box.querySelector('input[type=radio]').addEventListener('change', () => { J.defaultVessel = v.id; persist(); });
    box.querySelector('[data-assign]')?.addEventListener('click', () => { live().filter(t => !t.vesselId).forEach(t => { t.vesselId = v.id; touch(t); }); persist(); renderVessels(); });
  });
}
$('v-add').addEventListener('click', () => { const id = 'v' + Date.now().toString(36); J.vessels.push(normVessel({ id })); if (!J.defaultVessel) J.defaultVessel = id; persist(); renderVessels(); $('vessels').querySelector(`[data-v="${id}"] input`)?.focus(); });

/* ===================== גיבוי וייצוא ===================== */
function download(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
function doBackup() {
  const out = { format: 'marina-weather-journal/2', created: nowIso(), vessels: J.vessels, defaultVessel: J.defaultVessel, plansDone: J.plansDone || [], trips: J.trips };
  download(`sailing-journal-${new Date().toISOString().slice(0, 10)}.json`, new Blob([JSON.stringify(out)], { type: 'application/json' }));
  J.lastBackup = nowIso(); persist(); renderBackupWarn();
}
$('backup').addEventListener('click', doBackup);
function logRows() {
  return live().slice().sort((a, b) => tms(a.start) - tms(b.start)).map(t => {
    const s = stats(t), n = t.notes || {}, dm = wxDemand(t), v = vesselOf(t);
    const ws = t.wx?.rows?.map(r => r.wind).filter(x => x != null) || [], wv = t.wx?.rows?.map(r => r.wave).filter(x => x != null) || [];
    return {
      'תאריך': fmtShort(t.start) + '/' + localDate(t.start).slice(0, 4), 'יציאה': fmtTime(tStart(t)), 'סיום': `${localDate(tEnd(t)) !== localDate(tStart(t)) ? fmtShort(tEnd(t)) + ' ' : ''}${fmtTime(tEnd(t))}`,
      'כלי שיט': v ? v.name : '', 'מסלול': routeTxt(t, s), 'מייל ימי': s.nm != null ? s.nm.toFixed(1) : '', 'סוג מרחק': DIST_KIND[s.distKind], 'שעות': hrs(s.durMin), 'שעות לילה': hrs(s.nightMin), 'ימים בים': s.days || '',
      'תפקיד': n.role || ROLE_NONE, 'סקיפר': n.skipper || '', 'צוות': n.crew || '',
      'רוח (מודלים)': ws.length ? `${fmt(Math.min(...ws))}–${fmt(Math.max(...ws))} קשר` : '', 'גלים (מודלים)': wv.length ? `עד ${Math.round(Math.max(...wv) * 100)} ס"מ` : '',
      'אופי הים (מודלים)': dm ? dm.t + (dm.partial ? ' (חלקי)' : '') : '', 'איך הרגיש': n.feel != null ? FEEL[n.feel] : '', 'מפרשים': n.sails || '',
      'שעות מנוע': n.engStart || n.engEnd ? `${n.engStart || '?'}–${n.engEnd || '?'}` : '', 'דלק': n.fuel || '', 'תדריך בטיחות': n.safety ? 'כן' : '',
      'אירועים': n.events || '', 'הערות': n.text || '', 'מקור': SRC_TXT[t.source] + (s.fixed ? ' + תיקון ידני' : '')
    };
  });
}
// תא CSV: מרכאות, ומניעת נוסחאות (טקסט שמתחיל ב-= + - @ נפתח באקסל כנוסחה)
const csvCell = v => { let x = String(v ?? ''); if (/^[=+\-@\t\r]/.test(x)) x = "'" + x; return `"${x.replace(/"/g, '""')}"`; };
$('csv').addEventListener('click', () => {
  const rows = logRows(); if (!rows.length) return;
  const csv = '\ufeff' + [Object.keys(rows[0]).map(csvCell).join(','), ...rows.map(r => Object.values(r).map(csvCell).join(','))].join('\r\n');
  download(`sailing-log-${new Date().toISOString().slice(0, 10)}.csv`, new Blob([csv], { type: 'text/csv;charset=utf-8' }));
});
$('print').addEventListener('click', () => {
  const rows = logRows(); if (!rows.length) return;
  const cols = ['תאריך', 'יציאה', 'סיום', 'כלי שיט', 'מסלול', 'מייל ימי', 'שעות', 'שעות לילה', 'תפקיד', 'צוות', 'רוח (מודלים)', 'גלים (מודלים)', 'איך הרגיש', 'אירועים', 'הערות'];
  const st = live().map(stats);
  $('print-area').innerHTML = `<h1>יומן הפלגות</h1>
    ${J.vessels.map(v => `<p>${esc(v.name || 'כלי שיט')}${v.type ? ` · ${esc(v.type)}` : ''}${v.loa ? ` · ${esc(v.loa)} מ׳` : ''}${v.reg ? ` · מספר רישום ${esc(v.reg)}` : ''}${v.mmsi ? ` · MMSI/אות קריאה ${esc(v.mmsi)}` : ''}${v.home ? ` · נמל בית ${esc(v.home)}` : ''}</p>`).join('')}
    <p>${rows.length} הפלגות · ${st.filter(x => x.nm != null).reduce((s, x) => s + x.nm, 0).toFixed(0)} מייל ימי · ${hrs(st.reduce((s, x) => s + x.durMin, 0))} שעות בים · ${hrs(st.reduce((s, x) => s + x.nightMin, 0))} שעות לילה · הופק ${fmtDate(Date.now())}</p>
    <table><thead><tr>${cols.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${cols.map(c => `<td>${esc(r[c])}</td>`).join('')}</tr>`).join('')}</tbody></table>
    <p class="sig">חתימת הסקיפר: ____________________</p>`;
  window.print();
});

/* ===================== פאנלים, ערכת צבעים, הכול ===================== */
function openPanel(which) {
  closePanels();
  $('empty').classList.add('hidden');
  const p = $(which + '-panel'); p.classList.remove('hidden');
  if (which === 'import') resetImport();
  p.scrollIntoView({ block: 'start' });
}
function closePanels() { ['import', 'manual'].forEach(k => $(k + '-panel').classList.add('hidden')); $('empty').classList.toggle('hidden', live().length > 0); }
document.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => openPanel(b.dataset.open)));
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', closePanels));
['q', 'f-year', 'f-month'].forEach(id => $(id).addEventListener(id === 'q' ? 'input' : 'change', renderList));
(function theme() {
  const btn = $('theme-btn');
  const set = th => {
    if (th) document.documentElement.setAttribute('data-theme', th); else document.documentElement.removeAttribute('data-theme');
    try { th ? localStorage.setItem('theme', th) : localStorage.removeItem('theme'); } catch (_) {}
    btn.innerHTML = ico(th === 'light' ? 'sun' : th === 'dark' ? 'moon' : 'sun-moon');
    btn.title = th === 'light' ? 'מצב בהיר (לחץ לכהה)' : th === 'dark' ? 'מצב כהה (לחץ לאוטומטי)' : 'אוטומטי לפי המכשיר (לחץ לבהיר)';
  };
  let cur = null; try { cur = localStorage.getItem('theme'); } catch (_) {}
  set(cur);
  btn.addEventListener('click', () => { cur = cur === null ? 'light' : cur === 'light' ? 'dark' : null; set(cur); });
})();
function renderAll() {
  const has = live().length > 0;
  $('empty').classList.toggle('hidden', has);
  $('full').classList.toggle('hidden', !has);
  if (has) { renderSummary(); renderFilters(); renderList(); }
  renderBackupWarn(); renderDeleted(); renderPlans(); renderVessels();
}
/* ===================== יומן לדוגמה (?demo) ===================== */
function seedDemo() {
  const routes = [[0.01, -0.05], [0.025, -0.06], [-0.02, -0.04], [0.04, -0.03], [0.015, -0.08]];
  const t0 = Date.parse('2025-11-08T08:30:00Z');
  for (let i = 0; i < 24; i++) {
    const s = t0 + i * 15 * 86400000 + (i % 4) * 3600000, e = s + (2 + (i % 3)) * 3600000, [la, lo] = routes[i % routes.length];
    const path = Array.from({ length: 40 }, (_, k) => { const f = k < 20 ? k / 20 : (40 - k) / 20; return [32.1631 + la * f + Math.sin(k) * 0.0008, 34.7962 + lo * f, new Date(s + (e - s) * k / 39).toISOString()]; });
    const t = normTrip({ id: 'demo-' + i, start: s, end: e, source: 'google-timeline', path, vesselId: 'demo-v',
      notes: i % 3 === 2 ? {} : { feel: i % 4, role: i % 5 ? 'סקיפר' : 'צוות', crew: i % 2 ? 'סקיפר + 3 אורחים' : 'צוות קבוע', text: ['ים נעים, רוח מערבית', 'ריף ראשון אחרי שעה', 'גלים קצרים ביציאה מהנמל', 'הפלגת שקיעה'][i % 4] } });
    touch(t); J.trips.push(t);
  }
  const ports = { from: 'מרינה הרצליה', via: 'מרינה לרנקה (קפריסין)', to: 'מרינה הרצליה' };
  const m = normTrip({ id: 'demo-cy', start: '2026-05-28T05:00:00Z', end: '2026-06-02T15:00:00Z', source: 'manual', ports, path: portsPath(ports), vesselId: 'demo-v', fix: { label: 'הרצליה – לרנקה – הרצליה', nm: 330 }, notes: { role: 'סקיפר', crew: '4 אנשי צוות', feel: 2 } });
  touch(m); J.trips.push(m);
  J.vessels = [{ id: 'demo-v', name: 'סירה לדוגמה', type: 'מפרשית 40 רגל', loa: '12', reg: '', mmsi: '', home: 'מרינה הרצליה', maxKn: '' }];
  J.defaultVessel = 'demo-v'; J.lastBackup = nowIso();
  J.trips.sort((a, b) => tms(b.start) - tms(a.start));
  saveJournal(J);
}
if (DEMO) {
  if (!J.trips.length) seedDemo();
  $('demo-banner').classList.remove('hidden');
  $('demo-banner').innerHTML = `${ico('info', 18)}<span><b>יומן לדוגמה</b> – נתונים מומצאים, שמורים בנפרד. היומן שלך לא השתנה.</span><a class="btn" href="journal.html">חזרה ליומן שלי</a>`;
  document.title = 'יומן לדוגמה';
  $('demo-link').closest('p').classList.add('hidden');
}
document.querySelectorAll('[data-ico]').forEach(el => { el.innerHTML = ico(el.dataset.ico, +(el.dataset.s || 20)); });
initManual();
renderAll();
if (location.hash === '#import') openPanel('import');
