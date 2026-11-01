'use strict';
/* משותף לדף הסינון וליומן ההפלגות: קריאת ציר הזמן של Google, ניקוי מסלול, חישובים ושמירה מקומית.
   הכול רץ בדפדפן. שום דבר לא נשלח.
   פורמטים נתמכים:
   A. ייצוא מהטלפון (אנדרואיד): { semanticSegments: [...] }, activity.start.latLng = "32.16°, 34.79°", type = "SAILING"
   B. ייצוא מהטלפון (אייפון): מערך [...], activity.start = "geo:32.16,34.79", type = "sailing", timelinePath[].durationMinutesOffsetFromStartTime
   C. Takeout ישן: { timelineObjects: [{ activitySegment: {...} }] }
   D. קובץ ההפלגות המסונן שלנו: { format: "marina-weather-sailing/1", trips: [...] }
   E. גיבוי היומן: { format: "marina-weather-journal/1", trips: [...] } */

const TL_TZ = 'Asia/Jerusalem';
const TYPE_HE = {
  SAILING: 'שייט', IN_BOAT: 'בסירה', IN_FERRY: 'מעבורת', KAYAKING: 'קיאק', ROWING: 'חתירה', SURFING: 'גלישה',
  WALKING: 'הליכה', RUNNING: 'ריצה', HIKING: 'טיול רגלי', CYCLING: 'רכיבה', IN_PASSENGER_VEHICLE: 'נהיגה', IN_VEHICLE: 'ברכב',
  IN_TAXI: 'מונית', MOTORCYCLING: 'אופנוע', IN_BUS: 'אוטובוס', IN_TRAIN: 'רכבת', IN_SUBWAY: 'רכבת תחתית', IN_TRAM: 'רכבת קלה',
  FLYING: 'טיסה', SKIING: 'סקי', STILL: 'במקום', UNKNOWN_ACTIVITY_TYPE: 'לא ידוע', UNKNOWN: 'לא ידוע'
};
const SAIL_RE = /SAIL|BOAT/;
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
const tms = t => { if (t == null) return null; const x = typeof t === 'number' ? t : Date.parse(t); return Number.isFinite(x) ? x : null; };
function distM(a, b) {
  const R = 6371000, r = x => x * Math.PI / 180;
  const dLa = r(b[0] - a[0]), dLo = r(b[1] - a[1]);
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const pathLen = p => p.reduce((s, x, i) => i ? s + distM(p[i - 1], x) : 0, 0);

// מפרק כל פורמט של Google לרשימה אחידה: פעילויות + נקודות מסלול עם זמן
function parseTimeline(json) {
  const acts = [], points = [];
  const segs = Array.isArray(json) ? json : Array.isArray(json.semanticSegments) ? json.semanticSegments : null;
  if (segs) {
    for (const s of segs) {
      const st = tms(s.startTime), en = tms(s.endTime);
      if (s.activity && st != null && en != null) {
        const a = s.activity, tc = a.topCandidate || {};
        acts.push({ type: normType(tc.type), prob: tc.probability != null ? +tc.probability : null, start: st, end: en,
          a: ll(a.start), b: ll(a.end), dist: a.distanceMeters != null ? +a.distanceMeters : null, path: [] });
      }
      if (Array.isArray(s.timelinePath)) for (const p of s.timelinePath) {
        const c = ll(p.point || p);
        const t = p.time ? tms(p.time) : p.durationMinutesOffsetFromStartTime != null && st != null ? st + (+p.durationMinutesOffsetFromStartTime) * 60000 : null;
        if (c && t != null) points.push([c[0], c[1], t]);
      }
    }
    return attach({ format: Array.isArray(json) ? 'אייפון' : 'אנדרואיד', acts, points });
  }
  if (Array.isArray(json.timelineObjects)) {
    for (const o of json.timelineObjects) {
      const a = o.activitySegment; if (!a || !a.duration) continue;
      const st = tms(a.duration.startTimestamp) ?? tms(+a.duration.startTimestampMs), en = tms(a.duration.endTimestamp) ?? tms(+a.duration.endTimestampMs);
      const path = [];
      (a.simplifiedRawPath?.points || []).forEach(p => { const c = ll(p); const t = tms(p.timestamp) ?? tms(+p.timestampMs); if (c) path.push([c[0], c[1], t]); });
      if (!path.length) (a.waypointPath?.waypoints || []).forEach(p => { const c = ll(p); if (c) path.push([c[0], c[1], null]); });
      acts.push({ type: normType(a.activityType), prob: null, start: st, end: en, a: ll(a.startLocation), b: ll(a.endLocation), dist: a.distance != null ? +a.distance : null, path });
    }
    return attach({ format: 'Takeout ישן', acts, points });
  }
  throw new Error('זה לא נראה כמו קובץ ציר זמן של Google');
}
// מצמיד לכל פעילות את נקודות המסלול שבזמן שלה, ואת נקודות ההתחלה והסיום ש-Google רשמה
function attach(res) {
  const { acts, points } = res;
  points.sort((x, y) => x[2] - y[2]);
  for (const a of acts) {
    if (!a.path.length) a.path = points.filter(p => p[2] >= a.start && p[2] <= a.end);
    if (a.a && !(a.path[0] && distM(a.path[0], a.a) < 5)) a.path.unshift([a.a[0], a.a[1], a.start]);
    if (a.b && !(a.path.length && distM(a.path[a.path.length - 1], a.b) < 5)) a.path.push([a.b[0], a.b[1], a.end]);
    if (a.dist == null && a.path.length > 1) a.dist = pathLen(a.path);
  }
  return res;
}

/* ניקוי מסלול: Google רושמת לפעמים נקודה רחוקה (למשל נקודת "התחלה" באמצע הים) – קפיצה שמחייבת מהירות
   שיאכטה לא מגיעה אליה, או ריצוד של המיקום בתוך הנמל. יאכטה של 12 מ' לא עוברת ~9 קשר לאורך זמן,
   ולכן נקודה שהמהירות אליה *וגם* ממנה גבוהה מ-10 קשר (או נקודת קצה עם מהירות כזו) מוסרת. */
const KN = 1.943844; // מ'/שנ' → קשר
const MAX_KN = 10;
function cleanPath(path) {
  let p = path.filter(x => x && Number.isFinite(x[0]) && Number.isFinite(x[1])).map(x => [x[0], x[1], tms(x[2])]);
  const spd = (a, b) => a[2] != null && b[2] != null && b[2] > a[2] ? distM(a, b) / ((b[2] - a[2]) / 1000) * KN : null;
  for (let pass = 0; pass < 5; pass++) {
    const out = [];
    let removed = false;
    for (let i = 0; i < p.length; i++) {
      const prev = out[out.length - 1], next = p[i + 1];
      const s1 = prev ? spd(prev, p[i]) : null, s2 = next ? spd(p[i], next) : null;
      const bad = (s1 == null || s1 > MAX_KN) && (s2 == null || s2 > MAX_KN) && (s1 != null || s2 != null);
      if (bad) { removed = true; continue; }
      out.push(p[i]);
    }
    p = out;
    if (!removed) break;
  }
  return p;
}

// מרינות ונמלים לאורך החוף – לתיאור "מאיפה לאן"
const MARINAS = [
  ['מרינה הרצליה', 32.1631, 34.7962], ['מרינה תל אביב', 32.0866, 34.7676], ['נמל יפו', 32.0533, 34.7503],
  ['מרינה אשדוד', 31.7945, 34.6300], ['מרינה אשקלון', 31.6828, 34.5561], ['מרינה חיפה', 32.8070, 35.0300], ['נמל עכו', 32.9195, 35.0685]
];
// נמלים להפלגה שמוסיפים ביד (נקודת התחזית ומרחק בקו ישר). בקפריסין – קירוב, רק לבחירה ביד
const PORTS = [...MARINAS,
  ['מרינה לרנקה (קפריסין)', 34.9170, 33.6380], ['מרינה לימסול (קפריסין)', 34.6690, 33.0420], ['מרינה איה נאפה (קפריסין)', 34.9820, 33.9590],
  ['פאפוס (קפריסין)', 34.7540, 32.4060], ['מרינה קרפאס (קפריסין)', 35.6280, 34.3640]];
const portByName = n => PORTS.find(x => x[0] === n) || null;
function nearestMarina(p, maxM = 2500) {
  let best = null;
  for (const [n, la, lo] of MARINAS) { const d = distM(p, [la, lo]); if (d <= maxM && (!best || d < best.d)) best = { n, d }; }
  return best ? best.n : null;
}
const fmtDate = t => new Date(t).toLocaleDateString('he-IL', { timeZone: TL_TZ, weekday: 'short', day: 'numeric', month: 'numeric', year: 'numeric' });
const fmtTime = t => new Date(t).toLocaleTimeString('he-IL', { timeZone: TL_TZ, hour: '2-digit', minute: '2-digit' });
const localDate = t => new Intl.DateTimeFormat('en-CA', { timeZone: TL_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
const localHour = t => +new Intl.DateTimeFormat('en-GB', { timeZone: TL_TZ, hour: '2-digit', hourCycle: 'h23' }).format(new Date(t));
const durTxt = m => { const h = Math.floor(m / 60), mm = Math.round(m % 60); return h ? `${h} ש׳ ${mm} ד׳` : `${mm} ד׳`; };
const r5 = x => Math.round(x * 1e5) / 1e5;

// זריחה ושקיעה (נוסחת NOAA המקוצרת, דיוק של דקות) – לחישוב שעות לילה
function sunTimes(ms, lat, lng) {
  const rad = Math.PI / 180, d = Math.floor(ms / 86400000) + 0.5 - 10957.5 + 0.0008;   // ימים מ-J2000
  const J = d - lng / 360, M = (357.5291 + 0.98560028 * J) % 360;
  const C = 1.9148 * Math.sin(M * rad) + 0.02 * Math.sin(2 * M * rad) + 0.0003 * Math.sin(3 * M * rad);
  const L = (M + C + 180 + 102.9372) % 360;
  const Jt = 2451545 + J + 0.0053 * Math.sin(M * rad) - 0.0069 * Math.sin(2 * L * rad);
  const dec = Math.asin(Math.sin(L * rad) * Math.sin(23.44 * rad));
  const cw = (Math.sin(-0.833 * rad) - Math.sin(lat * rad) * Math.sin(dec)) / (Math.cos(lat * rad) * Math.cos(dec));
  if (cw < -1 || cw > 1) return null;
  const w = Math.acos(cw) / rad / 360, toMs = jd => (jd - 2440587.5) * 86400000;
  return { rise: toMs(Jt - w), set: toMs(Jt + w) };
}
// כמה דקות מההפלגה היו בחושך (בין השקיעה לזריחה)
function nightMinutes(s, e, lat, lng) {
  if (!(e > s)) return 0;
  let day = 0;
  for (let t = Math.floor(s / 86400000) * 86400000 - 86400000; t <= e + 86400000; t += 86400000) {
    const st = sunTimes(t + 43200000, lat, lng); if (!st) continue;
    day += Math.max(0, Math.min(e, st.set) - Math.max(s, st.rise));
  }
  return Math.max(0, Math.round((e - s - day) / 60000));
}

// נתוני הפלגה מחושבים מהמסלול הנקי (המרחק של Google לא תמיד אמין)
// תיקון ידני (trip.fix): מסלול, שעות ומרחק כולל – כשחלק מההפלגה לא נרשם ב-Google
const tStart = t => (t.fix && t.fix.start) || t.start, tEnd = t => (t.fix && t.fix.end) || t.end;
// שעה מקומית (ישראל) בתאריך נתון → ISO
function localToISO(dateStr, hm) {
  let t = Date.parse(`${dateStr}T${hm}:00Z`);
  for (let k = 0; k < 2; k++) {
    const [d, h] = [localDate(t), new Intl.DateTimeFormat('en-GB', { timeZone: TL_TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(t))];
    t += Date.parse(`${dateStr}T${hm}:00Z`) - Date.parse(`${d}T${h}:00Z`);
  }
  return new Date(t).toISOString();
}
function tripStats(trip) {
  const pts = cleanPath(trip.path || []);
  const fx = trip.fix || {};
  const start = tms(tStart(trip)), end = tms(tEnd(trip));
  const durMin = (end - start) / 60000;
  const dist0 = pts.length > 1 ? pathLen(pts) : (trip.distanceM || 0);
  const dist = fx.nm > 0 ? fx.nm * 1852 : dist0;
  const nm = dist / 1852;
  // מהירות מרבית (משוערת): על קטעים של 5 דקות לפחות, בקו ישר – כדי שריצוד לא ינפח אותה
  let maxKn = 0;
  for (let i = 0, j = 0; i < pts.length; i++) {
    if (j < i) j = i;
    while (j < pts.length && (pts[j][2] == null || pts[i][2] == null || pts[j][2] - pts[i][2] < 300000)) j++;
    if (j < pts.length && pts[i][2] != null) { const v = distM(pts[i], pts[j]) / ((pts[j][2] - pts[i][2]) / 1000) * KN; if (v > maxKn && v <= MAX_KN) maxKn = v; }
  }
  const from = pts.length ? nearestMarina(pts[0]) : null, to = pts.length ? nearestMarina(pts[pts.length - 1]) : null;
  const c = pts.length ? [pts.reduce((s, x) => s + x[0], 0) / pts.length, pts.reduce((s, x) => s + x[1], 0) / pts.length] : null;
  // הנקודה הרחוקה ביותר מהיציאה
  const far = pts.length ? pts.reduce((m, x) => distM(pts[0], x) > distM(pts[0], m) ? x : m, pts[0]) : null;
  return { pts, durMin, dist, nm, km: dist / 1000, avgKn: durMin > 0 ? (fx.nm > 0 && !fx.start && !fx.end ? dist0 / 1852 : nm) / (durMin / 60) : null,  // מרחק מתוקן בלי שעות מתוקנות – הממוצע לפי מה שנרשם
     maxKn: maxKn || null, from, to, centroid: c, farNm: far ? distM(pts[0], far) / 1852 : null, removed: (trip.path || []).length - pts.length,
    recNm: dist0 / 1852, fixed: !!(fx.start || fx.end || fx.nm > 0 || fx.label),
    nightMin: nightMinutes(start, end, ...(pts[0] || c || [32.16, 34.79]).slice(0, 2)), days: Math.floor(durMin / 1440) };
}
const placeTxt = s => s.from && s.to ? (s.from === s.to ? `מ${s.from} ובחזרה` : `מ${s.from} אל ${s.to.replace(/^מרינה /, 'מרינה ')}`) : s.from ? `יציאה מ${s.from}` : s.to ? `הגעה אל ${s.to}` : 'בים';

function miniPath(p, W = 88, H = 56) {
  if (!p || p.length < 2) return '<svg aria-hidden="true"></svg>';
  const la = p.map(x => x[0]), lo = p.map(x => x[1]);
  const k = Math.cos(la[0] * Math.PI / 180);
  const x0 = Math.min(...lo), x1 = Math.max(...lo), y0 = Math.min(...la), y1 = Math.max(...la);
  const w = Math.max((x1 - x0) * k, y1 - y0, 1e-6), pad = 5;
  const sx = v => pad + ((v - x0) * k / w) * (W - 2 * pad), sy = v => H - pad - ((v - y0) / w) * (H - 2 * pad);
  return `<svg viewBox="0 0 ${W} ${H}" aria-hidden="true" style="direction:ltr"><polyline points="${p.map(x => `${sx(x[1]).toFixed(1)},${sy(x[0]).toFixed(1)}`).join(' ')}" fill="none" stroke="var(--accent)" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${sx(p[0][1]).toFixed(1)}" cy="${sy(p[0][0]).toFixed(1)}" r="2.6" fill="var(--go)"/></svg>`;
}

/* ===================== יומן: שמירה מקומית ===================== */
const JOURNAL_KEY = 'journal_v1';
function loadJournal() {
  try { const j = JSON.parse(localStorage.getItem(JOURNAL_KEY)); if (j && Array.isArray(j.trips)) return j; } catch (_) {}
  return { v: 1, trips: [] };
}
function saveJournal(j) {
  try { localStorage.setItem(JOURNAL_KEY, JSON.stringify(j)); return true; } catch (_) { return false; }
}
// הפלגה ביומן: { id, start, end, path:[[lat,lng,iso]], prob, source, notes:{feel,crew,sails,text}, wx }
function toJournalTrip(t, source) {
  const start = new Date(tms(t.start)).toISOString(), end = new Date(tms(t.end)).toISOString();
  return { id: start, start, end, prob: t.prob ?? t.probability ?? null, source: source || t.source || 'google-timeline',
    path: (t.path || []).map(p => [r5(p[0]), r5(p[1]), p[2] != null ? new Date(tms(p[2])).toISOString() : null]),
    distanceM: t.dist ?? t.distanceM ?? null, notes: t.notes || {}, wx: t.wx || null, fix: t.fix || null, deleted: false };
}
// הוספה בלי כפילויות: הפלגה שחופפת בזמן להפלגה קיימת לא נוספת שוב (ההערות הקיימות נשמרות)
function addTrips(journal, trips) {
  let added = 0, dup = 0, restored = 0, removed = 0, fixed = 0;
  for (const t of trips) {
    const s = tms(t.start), e = tms(t.end);
    const ex = journal.trips.find(x => tms(x.start) < e && s < tms(x.end));
    if (ex) {
      // קובץ יומן (גיבוי או קובץ תיקונים) קובע אם ההפלגה מחוקה
      if (t.restore && ex.deleted && !t.deleted) { ex.deleted = false; restored++; }
      else if (t.restore && !ex.deleted && t.deleted) { ex.deleted = true; removed++; }
      else dup++;
      // גיבוי משוחזר מביא איתו הערות, תיקונים ונתוני מזג אוויר שאולי חסרים
      if (t.notes && Object.keys(t.notes).length && !Object.keys(ex.notes || {}).length) ex.notes = t.notes;
      if (t.fix && !ex.fix) { ex.fix = t.fix; fixed++; if (t.fix.start || t.fix.end) ex.wx = null; }
      if (t.wx && !ex.wx && !(ex.fix && !t.fix)) ex.wx = t.wx;
      continue;
    }
    const { restore, ...clean } = t; journal.trips.push(clean); added++;
  }
  journal.trips.sort((a, b) => tms(b.start) - tms(a.start));
  return { added, dup, restored, removed, fixed };
}
// קורא כל קובץ נתמך ומחזיר הפלגות מוכנות ליומן
function tripsFromFile(json) {
  if (json && json.format === 'marina-weather-sailing/1') return { kind: 'קובץ הפלגות מסונן', trips: json.trips.map(t => toJournalTrip(t, 'google-timeline')) };
  if (json && json.format === 'marina-weather-journal/1') return { kind: 'גיבוי יומן', trips: json.trips.map(t => ({ ...toJournalTrip(t, t.source), notes: t.notes || {}, wx: t.wx || null, deleted: !!t.deleted, restore: true })) };
  const r = parseTimeline(json);
  return { kind: `ציר זמן מ-Google (${r.format})`, trips: r.acts.filter(a => SAIL_RE.test(a.type)).map(a => toJournalTrip(a, 'google-timeline')) };
}
