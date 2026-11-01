'use strict';
/* סינון הפלגות מקובץ ציר הזמן של Google – הכול רץ בדפדפן, שום דבר לא נשלח.
   פורמטים נתמכים:
   A. ייצוא מהטלפון (אנדרואיד): { semanticSegments: [...], rawSignals, userLocationProfile }
      activity.start.latLng = "32.16°, 34.79°", activity.topCandidate.type = "SAILING", timelinePath[].point/time
   B. ייצוא מהטלפון (אייפון): מערך [...] עם activity.start = "geo:32.16,34.79", type באותיות קטנות ("sailing"),
      timelinePath[].point = "geo:…" ו-durationMinutesOffsetFromStartTime
   C. Takeout ישן (Semantic Location History): { timelineObjects: [{ activitySegment: { activityType, startLocation.latitudeE7, … } }] } */

const $ = id => document.getElementById(id);
const TZ = 'Asia/Jerusalem';
const TYPE_HE = {
  SAILING: 'שייט', IN_BOAT: 'בסירה', IN_FERRY: 'מעבורת', KAYAKING: 'קיאק', ROWING: 'חתירה', SURFING: 'גלישה',
  WALKING: 'הליכה', RUNNING: 'ריצה', HIKING: 'טיול רגלי', CYCLING: 'רכיבה', IN_PASSENGER_VEHICLE: 'נהיגה', IN_VEHICLE: 'ברכב',
  IN_TAXI: 'מונית', MOTORCYCLING: 'אופנוע', IN_BUS: 'אוטובוס', IN_TRAIN: 'רכבת', IN_SUBWAY: 'רכבת תחתית', IN_TRAM: 'רכבת קלה',
  FLYING: 'טיסה', SKIING: 'סקי', STILL: 'במקום', UNKNOWN_ACTIVITY_TYPE: 'לא ידוע', UNKNOWN: 'לא ידוע'
};
const SAIL_RE = /SAIL|BOAT/;   // מסומן מראש
const normType = t => String(t || 'UNKNOWN').trim().toUpperCase().replace(/[\s-]+/g, '_');
const typeName = t => TYPE_HE[t] || t.toLowerCase().replace(/_/g, ' ');

// קואורדינטות בכל הצורות: "32.1°, 34.8°" · "geo:32.1,34.8" · {latitudeE7,longitudeE7} · {latE7,lngE7} · {latLng:"…"}
function ll(v) {
  if (v == null) return null;
  if (typeof v === 'string') {
    const m = v.replace('geo:', '').match(/(-?\d+(?:\.\d+)?)\s*°?\s*,\s*(-?\d+(?:\.\d+)?)/);
    return m ? [+m[1], +m[2]] : null;
  }
  if (typeof v === 'object') {
    if (v.latLng) return ll(v.latLng);
    if (v.point) return ll(v.point);
    if (v.latitudeE7 != null) return [v.latitudeE7 / 1e7, v.longitudeE7 / 1e7];
    if (v.latE7 != null) return [v.latE7 / 1e7, v.lngE7 / 1e7];
  }
  return null;
}
const ms = t => { const x = Date.parse(t); return Number.isFinite(x) ? x : null; };
function distM(a, b) {
  const R = 6371000, r = x => x * Math.PI / 180;
  const dLa = r(b[0] - a[0]), dLo = r(b[1] - a[1]);
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const pathLen = p => p.reduce((s, x, i) => i ? s + distM(p[i - 1], x) : 0, 0);

// מפרק כל פורמט לרשימה אחידה: פעילויות + נקודות מסלול עם זמן
function parse(json) {
  const acts = [], points = [];
  const segs = Array.isArray(json) ? json : Array.isArray(json.semanticSegments) ? json.semanticSegments : null;
  if (segs) {
    for (const s of segs) {
      const st = ms(s.startTime), en = ms(s.endTime);
      if (s.activity && st != null && en != null) {
        const a = s.activity, tc = a.topCandidate || {};
        acts.push({ type: normType(tc.type), prob: tc.probability != null ? +tc.probability : null, start: st, end: en,
          a: ll(a.start), b: ll(a.end), dist: a.distanceMeters != null ? +a.distanceMeters : null, path: [] });
      }
      if (Array.isArray(s.timelinePath)) for (const p of s.timelinePath) {
        const c = ll(p.point || p);
        const t = p.time ? ms(p.time) : p.durationMinutesOffsetFromStartTime != null && st != null ? st + (+p.durationMinutesOffsetFromStartTime) * 60000 : null;
        if (c && t != null) points.push([c[0], c[1], t]);
      }
    }
    return { format: Array.isArray(json) ? 'אייפון' : 'אנדרואיד', acts, points };
  }
  if (Array.isArray(json.timelineObjects)) {
    for (const o of json.timelineObjects) {
      const a = o.activitySegment; if (!a || !a.duration) continue;
      const st = ms(a.duration.startTimestamp) ?? +a.duration.startTimestampMs, en = ms(a.duration.endTimestamp) ?? +a.duration.endTimestampMs;
      const path = [];
      (a.simplifiedRawPath?.points || []).forEach(p => { const c = ll(p); const t = ms(p.timestamp) ?? +p.timestampMs; if (c) path.push([c[0], c[1], Number.isFinite(t) ? t : null]); });
      if (!path.length) (a.waypointPath?.waypoints || []).forEach(p => { const c = ll(p); if (c) path.push([c[0], c[1], null]); });
      acts.push({ type: normType(a.activityType), prob: null, start: st, end: en, a: ll(a.startLocation), b: ll(a.endLocation), dist: a.distance != null ? +a.distance : null, path });
    }
    return { format: 'Takeout ישן', acts, points };
  }
  throw new Error('זה לא נראה כמו קובץ ציר זמן של Google');
}

// מצמיד לכל פעילות את נקודות המסלול שבזמן שלה
function attachPaths(acts, points) {
  points.sort((x, y) => x[2] - y[2]);
  for (const a of acts) {
    if (!a.path.length) a.path = points.filter(p => p[2] >= a.start && p[2] <= a.end);
    if (a.a && !(a.path[0] && distM(a.path[0], a.a) < 5)) a.path.unshift([a.a[0], a.a[1], a.start]);
    if (a.b && !(a.path.length && distM(a.path[a.path.length - 1], a.b) < 5)) a.path.push([a.b[0], a.b[1], a.end]);
    if (a.dist == null && a.path.length > 1) a.dist = pathLen(a.path);
  }
  return acts;
}

let ALL = [], FMT = '';
const fmtDate = t => new Date(t).toLocaleDateString('he-IL', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'numeric', year: 'numeric' });
const fmtTime = t => new Date(t).toLocaleTimeString('he-IL', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const durTxt = m => { const h = Math.floor(m / 60), mm = Math.round(m % 60); return h ? `${h} ש׳ ${mm} ד׳` : `${mm} ד׳`; };
const r5 = x => Math.round(x * 1e5) / 1e5;

function miniPath(p) {
  if (p.length < 2) return '<svg aria-hidden="true"></svg>';
  const la = p.map(x => x[0]), lo = p.map(x => x[1]);
  const k = Math.cos(la[0] * Math.PI / 180);
  const x0 = Math.min(...lo), x1 = Math.max(...lo), y0 = Math.min(...la), y1 = Math.max(...la);
  const w = Math.max((x1 - x0) * k, y1 - y0, 1e-6), W = 88, H = 56, pad = 5;
  const sx = v => pad + ((v - x0) * k / w) * (W - 2 * pad), sy = v => H - pad - ((v - y0) / w) * (H - 2 * pad);
  // ציר X הפוך בתצוגה מימין לשמאל? לא – ה-SVG מצויר משמאל לימין כמו מפה רגילה
  return `<svg viewBox="0 0 ${W} ${H}" aria-hidden="true" style="direction:ltr"><polyline points="${p.map(x => `${sx(x[1]).toFixed(1)},${sy(x[0]).toFixed(1)}`).join(' ')}" fill="none" stroke="var(--accent)" stroke-width="1.8" stroke-linejoin="round"/></svg>`;
}

function renderTypes() {
  const by = new Map();
  ALL.forEach(a => { const x = by.get(a.type) || { n: 0, d: 0 }; x.n++; x.d += a.dist || 0; by.set(a.type, x); });
  const types = [...by.entries()].sort((x, y) => (SAIL_RE.test(y[0]) - SAIL_RE.test(x[0])) || y[1].n - x[1].n);
  $('types').innerHTML = types.map(([t, x]) => `<label><input type="checkbox" value="${t}"${SAIL_RE.test(t) ? ' checked' : ''}><span>${ico(SAIL_RE.test(t) ? 'sailboat' : 'route', 18)} <b>${typeName(t)}</b> <span class="n">· ${x.n === 1 ? 'קטע אחד' : x.n + ' קטעים'} · ${(x.d / 1000).toFixed(0)} ק"מ</span></span></label>`).join('');
  $('types').querySelectorAll('input').forEach(i => i.addEventListener('change', renderTrips));
  $('types-sec').classList.remove('hidden');
}
const chosenTypes = () => [...$('types').querySelectorAll('input:checked')].map(i => i.value);
let TRIPS = [];
function renderTrips() {
  const types = chosenTypes();
  TRIPS = ALL.filter(a => types.includes(a.type)).sort((x, y) => y.start - x.start);
  $('trips-sec').classList.remove('hidden');
  if (!TRIPS.length) { $('trips').innerHTML = '<p class="muted">לא נמצאו קטעים מהסוגים שסומנו.</p>'; $('trips-sum').textContent = ''; updateButtons(); return; }
  $('trips').innerHTML = TRIPS.map((a, i) => `<label class="trip-row"><input type="checkbox" data-i="${i}" checked>
    <span class="meta"><b>${fmtDate(a.start)} · <bdi dir="ltr">${fmtTime(a.start)}–${fmtTime(a.end)}</bdi></b>
    <small>${typeName(a.type)} · ${durTxt((a.end - a.start) / 60000)} · ${a.dist != null ? `${(a.dist / 1000).toFixed(1)} ק"מ (${(a.dist / 1852).toFixed(1)} מייל ימי)` : 'בלי מרחק'} · ${a.path.length} נקודות מסלול</small></span>
    ${miniPath(a.path)}</label>`).join('');
  $('trips').querySelectorAll('input').forEach(i => i.addEventListener('change', updateButtons));
  updateButtons();
}
function selected() { return [...$('trips').querySelectorAll('input:checked')].map(i => TRIPS[+i.dataset.i]); }
function updateButtons() {
  const n = selected().length;
  $('trips-sum').textContent = TRIPS.length ? `${TRIPS.length === 1 ? 'נמצא קטע אחד' : `נמצאו ${TRIPS.length} קטעים`} · ${n === 1 ? 'אחד מסומן' : n + ' מסומנים'} לקובץ` : '';
  $('download').disabled = !n; $('share').disabled = !n;
  if (!$('preview').classList.contains('hidden')) $('preview-pre').textContent = JSON.stringify(output(), null, 1);
}
// הקובץ שיוצא: רק ההפלגות שסומנו
function output() {
  return {
    format: 'marina-weather-sailing/1', source: 'google-timeline', sourceFormat: FMT, created: new Date().toISOString(),
    trips: selected().map(a => ({
      start: new Date(a.start).toISOString(), end: new Date(a.end).toISOString(), type: a.type,
      probability: a.prob, distanceM: a.dist != null ? Math.round(a.dist) : null,
      path: a.path.map(p => [r5(p[0]), r5(p[1]), p[2] != null ? new Date(p[2]).toISOString() : null])
    }))
  };
}
const outName = () => `sailing-trips-${new Date().toISOString().slice(0, 10)}.json`;
const outBlob = () => new Blob([JSON.stringify(output())], { type: 'application/json' });

$('file').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  $('status').className = 'status'; $('status').textContent = `קורא את ${f.name}…`;
  ['types-sec', 'trips-sec', 'preview'].forEach(id => $(id).classList.add('hidden'));
  try {
    const json = JSON.parse(await f.text());
    const { format, acts, points } = parse(json);
    FMT = format; ALL = attachPaths(acts, points);
    if (!ALL.length) throw new Error('לא נמצאו בקובץ קטעי תנועה');
    $('status').textContent = `נקרא קובץ ${format}: ${ALL.length} קטעי תנועה, ${points.length} נקודות מסלול. הקובץ המלא נשאר בטלפון.`;
    renderTypes(); renderTrips();
  } catch (err) {
    $('status').className = 'status err';
    $('status').textContent = err instanceof SyntaxError ? 'הקובץ לא נקרא – זה לא קובץ JSON תקין.' : err.message;
  }
});
$('download').addEventListener('click', () => {
  const a = document.createElement('a'); a.href = URL.createObjectURL(outBlob()); a.download = outName();
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
});
try {
  const test = new File(['{}'], 'x.json', { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [test] })) $('share').classList.remove('hidden');
} catch (_) {}
$('share').addEventListener('click', async () => {
  try { await navigator.share({ files: [new File([outBlob()], outName(), { type: 'application/json' })], title: 'ההפלגות שלי' }); } catch (_) {}
});
$('show').addEventListener('click', () => {
  $('preview').classList.toggle('hidden');
  $('preview-pre').textContent = JSON.stringify(output(), null, 1);
});
document.querySelectorAll('[data-ico]').forEach(el => { el.innerHTML = ico(el.dataset.ico, +(el.dataset.s || 20)); });
