'use strict';
/* סינון הפלגות מקובץ ציר הזמן של Google – הכול רץ בדפדפן, שום דבר לא נשלח.
   פורמטים נתמכים:
   A. ייצוא מהטלפון (אנדרואיד): { semanticSegments: [...], rawSignals, userLocationProfile }
      activity.start.latLng = "32.16°, 34.79°", activity.topCandidate.type = "SAILING", timelinePath[].point/time
   B. ייצוא מהטלפון (אייפון): מערך [...] עם activity.start = "geo:32.16,34.79", type באותיות קטנות ("sailing"),
      timelinePath[].point = "geo:…" ו-durationMinutesOffsetFromStartTime
   C. Takeout ישן (Semantic Location History): { timelineObjects: [{ activitySegment: { activityType, startLocation.latitudeE7, … } }] } */

const $ = id => document.getElementById(id);
// הקריאה, הניקוי והשמירה – ב-timeline-parse.js (משותף עם היומן)

let ALL = [], FMT = '';
const LAND_RE = /WALK|RUN|HIK|CYCL|VEHICLE|TAXI|MOTORCYCL|BUS|TRAIN|SUBWAY|TRAM|FLY|SKI/;   // בחיפוש לפי תאריכים – לא מסומנים מראש
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
  // חיפוש לפי תאריכים: כל סוגי התנועה בטווח (גם מה ש-Google לא סיווגה כשייט)
  const df = $('d-from').value, dt = $('d-to').value || df;
  const byDate = !!df;
  TRIPS = ALL.filter(a => byDate ? (localDate(a.end) >= df && localDate(a.start) <= dt) : types.includes(a.type)).sort((x, y) => y.start - x.start);
  $('merge-row').classList.toggle('hidden', !byDate);
  $('trips-sec').classList.remove('hidden');
  if (!TRIPS.length) { $('trips').innerHTML = `<p class="muted">${byDate ? 'Google לא רשמה שום תנועה בתאריכים האלה. אפשר להוסיף את ההפלגה ביד ביומן.' : 'לא נמצאו קטעים מהסוגים שסומנו.'}</p>`; $('trips-sum').textContent = ''; updateButtons(); return; }
  $('trips').innerHTML = TRIPS.map((a, i) => `<label class="trip-row"><input type="checkbox" data-i="${i}"${!byDate || !LAND_RE.test(a.type) ? ' checked' : ''}>
    <span class="meta"><b>${fmtDate(a.start)} · <bdi dir="ltr">${fmtTime(a.start)}–${fmtTime(a.end)}</bdi></b>
    <small>${typeName(a.type)} · ${durTxt((a.end - a.start) / 60000)} · ${a.dist != null ? `${(a.dist / 1000).toFixed(1)} ק"מ (${(a.dist / 1852).toFixed(1)} מייל ימי)` : 'בלי מרחק'} · ${a.path.length === 1 ? 'נקודת מסלול אחת' : a.path.length + ' נקודות מסלול'}</small></span>
    ${miniPath(a.path)}</label>`).join('');
  $('trips').querySelectorAll('input').forEach(i => i.addEventListener('change', updateButtons));
  updateButtons();
}
function selected() {
  const sel = [...$('trips').querySelectorAll('input:checked')].map(i => TRIPS[+i.dataset.i]);
  if (!$('merge').checked || sel.length < 2 || $('merge-row').classList.contains('hidden')) return sel;
  // איחוד לקטע אחד: מההתחלה הראשונה עד הסוף האחרון, עם כל נקודות המסלול לפי הזמן
  const path = sel.flatMap(a => a.path).sort((x, y) => (x[2] ?? 0) - (y[2] ?? 0));
  return [{ start: Math.min(...sel.map(a => a.start)), end: Math.max(...sel.map(a => a.end)), type: 'SAILING', prob: null,
    dist: sel.reduce((s, a) => s + (a.dist || 0), 0) || null, path }];
}
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
    const { format, acts, points } = parseTimeline(json);
    FMT = format; ALL = acts;
    if (!ALL.length) throw new Error('לא נמצאו בקובץ קטעי תנועה');
    $('status').textContent = `נקרא קובץ ${format}: ${ALL.length} קטעי תנועה, ${points.length} נקודות מסלול. הקובץ המלא נשאר בטלפון.`;
    renderTypes(); renderTrips();
  } catch (err) {
    $('status').className = 'status err';
    $('status').textContent = err instanceof SyntaxError ? 'הקובץ לא נקרא – זה לא קובץ JSON תקין.' : err.message;
  }
});
['d-from', 'd-to'].forEach(id => $(id).addEventListener('change', () => { if (id === 'd-from' && !$('d-to').value) $('d-to').value = $('d-from').value; if (ALL.length) renderTrips(); }));
$('d-clear').addEventListener('click', () => { $('d-from').value = $('d-to').value = ''; $('merge').checked = false; renderTrips(); });
$('merge').addEventListener('change', updateButtons);
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
// הוספה ישירה ליומן (באותו טלפון) – בלי להוריד קובץ
$('to-journal').addEventListener('click', () => {
  const j = loadJournal();
  const r = addTrips(j, selected().map(a => toJournalTrip(a, 'google-timeline')));
  if (!saveJournal(j)) { $('journal-msg').textContent = 'לא הצלחתי לשמור ביומן (הדפדפן חוסם שמירה).'; return; }
  $('journal-msg').innerHTML = `נוספו ליומן ${r.added === 1 ? 'הפלגה אחת' : r.added + ' הפלגות'}${r.dup ? ` (${r.dup} כבר היו ביומן)` : ''}. <a href="journal.html">פתח את היומן ←</a>`;
});
$('show').addEventListener('click', () => {
  $('preview').classList.toggle('hidden');
  $('preview-pre').textContent = JSON.stringify(output(), null, 1);
});
document.querySelectorAll('[data-ico]').forEach(el => { el.innerHTML = ico(el.dataset.ico, +(el.dataset.s || 20)); });
