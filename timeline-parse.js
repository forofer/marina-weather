'use strict';
/* שכבת הנתונים של יומן ההפלגות: קריאת קבצים, ניקוי מסלול, חישובים, זיהוי כפילויות ושמירה מקומית.
   קריאת הקבצים רצה בדפדפן בלבד – הקובץ לא נשלח לשום מקום.
   פורמטים נתמכים:
   A. ציר הזמן מאנדרואיד: { semanticSegments: [...] }, activity.start.latLng = "32.16°, 34.79°", type = "SAILING"
   B. ציר הזמן מאייפון: מערך [...], activity.start = "geo:32.16,34.79", type = "sailing", timelinePath[].durationMinutesOffsetFromStartTime
   C. Takeout ישן: { timelineObjects: [{ activitySegment: {...} }] }
   D. קובץ הפלגות מסונן (גרסאות קודמות): { format: "marina-weather-sailing/1", trips: [...] }
   E. גיבוי היומן: { format: "marina-weather-journal/1" | "/2", trips: [...], vessels? } */

const TL_TZ = 'Asia/Jerusalem';
const TYPE_HE = {
  SAILING: 'שייט', IN_BOAT: 'בסירה', IN_FERRY: 'מעבורת', KAYAKING: 'קיאק', ROWING: 'חתירה', SURFING: 'גלישה',
  WALKING: 'הליכה', RUNNING: 'ריצה', HIKING: 'טיול רגלי', CYCLING: 'רכיבה', IN_PASSENGER_VEHICLE: 'נהיגה', IN_VEHICLE: 'ברכב',
  IN_TAXI: 'מונית', MOTORCYCLING: 'אופנוע', IN_BUS: 'אוטובוס', IN_TRAIN: 'רכבת', IN_SUBWAY: 'רכבת תחתית', IN_TRAM: 'רכבת קלה',
  FLYING: 'טיסה', SKIING: 'סקי', STILL: 'במקום', UNKNOWN_ACTIVITY_TYPE: 'לא ידוע', UNKNOWN: 'לא ידוע'
};
const SAIL_RE = /SAIL|BOAT/;
const LAND_RE = /WALK|RUN|HIK|CYCL|VEHICLE|TAXI|MOTORCYCL|BUS|TRAIN|SUBWAY|TRAM|FLY|SKI/;
const normType = t => String(t || 'UNKNOWN').trim().toUpperCase().replace(/[^A-Z0-9_ -]/g, '').replace(/[\s-]+/g, '_').slice(0, 40) || 'UNKNOWN';
const typeName = t => TYPE_HE[t] || String(t).toLowerCase().replace(/_/g, ' ');
const escHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// קואורדינטות בכל הצורות: "32.1°, 34.8°" · "geo:32.1,34.8" · {latitudeE7,longitudeE7} · {latE7,lngE7} · {latLng:"…"}
const okLL = c => c && Number.isFinite(c[0]) && Number.isFinite(c[1]) && Math.abs(c[0]) <= 90 && Math.abs(c[1]) <= 180 && !(c[0] === 0 && c[1] === 0);
function ll(v) {
  if (v == null) return null;
  let c = null;
  if (typeof v === 'string') {
    const m = v.replace('geo:', '').match(/(-?\d+(?:\.\d+)?)\s*°?\s*,\s*(-?\d+(?:\.\d+)?)/);
    c = m ? [+m[1], +m[2]] : null;
  } else if (typeof v === 'object') {
    if (v.latLng) return ll(v.latLng);
    if (v.point) return ll(v.point);
    if (v.latitudeE7 != null) c = [v.latitudeE7 / 1e7, v.longitudeE7 / 1e7];
    else if (v.latE7 != null) c = [v.latE7 / 1e7, v.lngE7 / 1e7];
  }
  return okLL(c) ? c : null;
}
// זמן תקין: בין 2005 לעוד שנה מהיום
const T_MIN = Date.parse('2005-01-01T00:00:00Z');
const tms = t => { if (t == null || t === '') return null; const x = typeof t === 'number' ? t : Date.parse(t); return Number.isFinite(x) && x > T_MIN && x < Date.now() + 366 * 86400000 ? x : null; };
function distM(a, b) {
  const R = 6371000, r = x => x * Math.PI / 180;
  const dLa = r(b[0] - a[0]), dLo = r(b[1] - a[1]);
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const pathLen = p => p.reduce((s, x, i) => i ? s + distM(p[i - 1], x) : 0, 0);
const MAX_DAYS = 30;   // קטע ארוך מזה – כנראה שגיאה בקובץ

/* מפרק כל פורמט של Google לרשימה אחידה: פעילויות + נקודות מסלול עם זמן.
   רשומות לא תקינות (זמן חסר, סוף לפני התחלה, קואורדינטות מחוץ לטווח) מדולגות ונספרות. */
function parseTimeline(json) {
  const acts = [], points = [];
  let bad = 0;
  const addAct = a => { if (a.start == null || a.end == null || a.end <= a.start || a.end - a.start > MAX_DAYS * 86400000) { bad++; return; } acts.push(a); };
  const segs = Array.isArray(json) ? json : json && Array.isArray(json.semanticSegments) ? json.semanticSegments : null;
  if (segs) {
    for (const s of segs) {
      if (!s || typeof s !== 'object') { bad++; continue; }
      const st = tms(s.startTime), en = tms(s.endTime);
      if (s.activity) {
        const a = s.activity, tc = a.topCandidate || {};
        addAct({ type: normType(tc.type), prob: Number.isFinite(+tc.probability) && tc.probability != null ? +tc.probability : null, start: st, end: en,
          a: ll(a.start), b: ll(a.end), dist: Number.isFinite(+a.distanceMeters) && a.distanceMeters != null ? +a.distanceMeters : null, path: [] });
      }
      if (Array.isArray(s.timelinePath)) for (const p of s.timelinePath) {
        const c = ll(p && (p.point || p));
        const off = p && p.durationMinutesOffsetFromStartTime;
        const t = p && p.time ? tms(p.time) : off != null && st != null && Number.isFinite(+off) ? st + (+off) * 60000 : null;
        if (c && t != null) points.push([c[0], c[1], t]); else bad++;
      }
    }
    if (!acts.length && !points.length && segs.length && !segs.some(s => s && (s.visit || s.activity || s.timelinePath))) throw new Error(UNSUPPORTED);
    return attach({ format: Array.isArray(json) ? 'אייפון' : 'אנדרואיד', acts, points, bad });
  }
  if (json && Array.isArray(json.timelineObjects)) {
    for (const o of json.timelineObjects) {
      const a = o && o.activitySegment; if (!a) continue;
      if (!a.duration) { bad++; continue; }
      const st = tms(a.duration.startTimestamp) ?? tms(+a.duration.startTimestampMs), en = tms(a.duration.endTimestamp) ?? tms(+a.duration.endTimestampMs);
      const path = [];
      (a.simplifiedRawPath?.points || []).forEach(p => { const c = ll(p); const t = tms(p.timestamp) ?? tms(+p.timestampMs); if (c) path.push([c[0], c[1], t]); });
      if (!path.length) (a.waypointPath?.waypoints || []).forEach(p => { const c = ll(p); if (c) path.push([c[0], c[1], null]); });
      addAct({ type: normType(a.activityType), prob: null, start: st, end: en, a: ll(a.startLocation), b: ll(a.endLocation), dist: Number.isFinite(+a.distance) && a.distance != null ? +a.distance : null, path });
    }
    return attach({ format: 'Takeout ישן', acts, points, bad });
  }
  throw new Error(UNSUPPORTED);
}
const UNSUPPORTED = 'הקובץ לא נתמך. אפשר לבחור: קובץ ציר הזמן שמייצאים מ-Google Maps (בדרך כלל location-history.json או Timeline.json), או גיבוי של היומן.';
// חיפוש בינארי: האינדקס הראשון שהזמן שלו ≥ t
function lowerBound(pts, t) { let lo = 0, hi = pts.length; while (lo < hi) { const m = (lo + hi) >> 1; if (pts[m][2] < t) lo = m + 1; else hi = m; } return lo; }
// מצמיד לכל פעילות את נקודות המסלול שבזמן שלה, ואת נקודות ההתחלה והסיום ש-Google רשמה
function attach(res) {
  const { acts, points } = res;
  points.sort((x, y) => x[2] - y[2]);
  for (const a of acts) {
    if (!a.path.length) { const i = lowerBound(points, a.start), j = lowerBound(points, a.end + 1); a.path = points.slice(i, j); }
    if (a.a && !(a.path[0] && distM(a.path[0], a.a) < 5)) a.path.unshift([a.a[0], a.a[1], a.start]);
    if (a.b && !(a.path.length && distM(a.path[a.path.length - 1], a.b) < 5)) a.path.push([a.b[0], a.b[1], a.end]);
    if (a.dist == null && a.path.length > 1) a.dist = pathLen(a.path);
  }
  acts.sort((x, y) => y.start - x.start);
  return res;
}

/* ניקוי מסלול – "נקודות חשודות": קפיצה חד-פעמית שאחריה המסלול חוזר למקום (ספייק), ולא סתם מהירות גבוהה.
   נקודה חשודה אם המהירות אליה וממנה גבוהה מהמהירות הסבירה, אבל בלעדיה המסלול רציף (השכנות שלה קרובות זו לזו בזמן ובמקום),
   והקפיצה רחוקה מ-300 מ'. נקודת קצה חשודה אם הקפיצה אליה לא סבירה והמשך המסלול סביר. מסלול מהיר ועקבי לא נפגע.
   המסלול המקורי נשמר תמיד; הניקוי מחושב בהצגה ואפשר לבטל אותו לכל הפלגה. */
const KN = 1.943844; // מ'/שנ' → קשר
const DEF_MAX_KN = 15; // מהירות סבירה ליאכטה (גם במנוע); אפשר לשנות לכל כלי שיט
function cleanPath(path, maxKn = DEF_MAX_KN) {
  const p = (path || []).filter(x => x && okLL(x)).map(x => [x[0], x[1], tms(x[2])]);
  const spd = (a, b) => a[2] != null && b[2] != null && b[2] > a[2] ? distM(a, b) / ((b[2] - a[2]) / 1000) * KN : (a[2] != null && b[2] === a[2] && distM(a, b) > 300 ? Infinity : null);
  const fast = v => v != null && v > maxKn;
  const sus = new Set();
  for (let pass = 0; pass < 3; pass++) {
    const keep = p.map((x, i) => i).filter(i => !sus.has(i));
    let changed = false;
    for (let k = 0; k < keep.length; k++) {
      const i = keep[k], prev = k > 0 ? p[keep[k - 1]] : null, next = k < keep.length - 1 ? p[keep[k + 1]] : null, cur = p[i];
      if (prev && next) {
        if (fast(spd(prev, cur)) && fast(spd(cur, next)) && !fast(spd(prev, next)) && Math.min(distM(prev, cur), distM(cur, next)) > 300) { sus.add(i); changed = true; }
      } else if (next) {   // נקודת התחלה
        const n2 = k + 2 < keep.length ? p[keep[k + 2]] : null;
        if (fast(spd(cur, next)) && distM(cur, next) > 300 && (!n2 || !fast(spd(next, n2)))) { sus.add(i); changed = true; }
      } else if (prev) {   // נקודת סיום
        const p2 = k >= 2 ? p[keep[k - 2]] : null;
        if (fast(spd(prev, cur)) && distM(prev, cur) > 300 && (!p2 || !fast(spd(p2, prev)))) { sus.add(i); changed = true; }
      }
    }
    if (!changed) break;
  }
  return { pts: p.filter((x, i) => !sus.has(i)), suspicious: p.filter((x, i) => sus.has(i)) };
}

// מרינות ונמלים לאורך החוף – לתיאור "מאיפה לאן"
const MARINAS = [
  ['מרינה הרצליה', 32.1631, 34.7962], ['מרינה תל אביב', 32.0866, 34.7676], ['נמל יפו', 32.0533, 34.7503],
  ['מרינה אשדוד', 31.7945, 34.6300], ['מרינה אשקלון', 31.6828, 34.5561], ['מרינה חיפה', 32.8070, 35.0300], ['נמל עכו', 32.9195, 35.0685]
];
// נמלים להפלגה שמוסיפים ביד. בקפריסין – קירוב, רק לבחירה ביד
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
const fmtShort = t => new Date(t).toLocaleDateString('he-IL', { timeZone: TL_TZ, day: 'numeric', month: 'numeric' });
const localDate = t => new Intl.DateTimeFormat('en-CA', { timeZone: TL_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
const localHour = t => +new Intl.DateTimeFormat('en-GB', { timeZone: TL_TZ, hour: '2-digit', hourCycle: 'h23' }).format(new Date(t));
const durTxt = m => { m = Math.max(0, Math.round(m)); const d = Math.floor(m / 1440), h = Math.floor(m % 1440 / 60), mm = m % 60; return (d ? `${d === 1 ? 'יום' : d + ' ימים'} ` : '') + (h || d ? `${h} ש׳ ` : '') + `${mm} ד׳`; };
const r5 = x => Math.round(x * 1e5) / 1e5;
// תאריך ושעה מקומיים (ישראל) → ISO
function localToISO(dateStr, hm) {
  let t = Date.parse(`${dateStr}T${hm}:00Z`);
  for (let k = 0; k < 2; k++) {
    const d = localDate(t), h = new Intl.DateTimeFormat('en-GB', { timeZone: TL_TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(t));
    t += Date.parse(`${dateStr}T${hm}:00Z`) - Date.parse(`${d}T${h}:00Z`);
  }
  return new Date(t).toISOString();
}
const dtLocal = t => `${localDate(t)}T${new Intl.DateTimeFormat('en-GB', { timeZone: TL_TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(t))}`;

// זריחה ושקיעה (נוסחת NOAA המקוצרת, דיוק של דקות) – לחישוב שעות לילה
function sunTimes(ms, lat, lng) {
  const rad = Math.PI / 180, d = Math.floor(ms / 86400000) + 0.5 - 10957.5 + 0.0008;
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
function nightMinutes(s, e, lat, lng) {
  if (!(e > s)) return 0;
  let day = 0;
  for (let t = Math.floor(s / 86400000) * 86400000 - 86400000; t <= e + 86400000; t += 86400000) {
    const st = sunTimes(t + 43200000, lat, lng); if (!st) continue;
    day += Math.max(0, Math.min(e, st.set) - Math.max(s, st.rise));
  }
  return Math.max(0, Math.round((e - s - day) / 60000));
}

/* ===================== חישובי הפלגה ===================== */
// תיקון ידני (trip.fix): מסלול, זמנים ומרחק כולל – כשחלק מההפלגה לא נרשם ב-Google
const tStart = t => (t.fix && t.fix.start) || t.start, tEnd = t => (t.fix && t.fix.end) || t.end;
// פערים בהפלגה מאוחדת: בין הקטעים שנרשמו
function tripGaps(t) {
  const sg = (t.segments || []).map(x => [tms(x[0]), tms(x[1])]).filter(x => x[0] != null && x[1] != null).sort((a, b) => a[0] - b[0]);
  const gaps = [];
  for (let i = 1; i < sg.length; i++) if (sg[i][0] > sg[i - 1][1]) gaps.push([sg[i - 1][1], sg[i][0]]);
  return gaps;
}
// סוגי מרחק: recorded (מהמסלול שנרשם) · estimated (אומדן: מסלול דליל או הלוך-ושוב משוער) · manual (הוזן ביד) · none (לא הוזן)
const DIST_KIND = { recorded: 'נרשם במסלול', estimated: 'אומדן', manual: 'הוזן ביד', none: 'לא הוזן' };
function tripStats(trip, vessel) {
  const maxKn = vessel && +vessel.maxKn > 0 ? +vessel.maxKn : DEF_MAX_KN;
  const raw = (trip.path || []).filter(x => x && okLL(x)).map(x => [x[0], x[1], tms(x[2])]);
  const cl = trip.clean === false ? { pts: raw, suspicious: [] } : cleanPath(raw, maxKn);
  const pts = cl.pts;
  const fx = trip.fix || {};
  const start = tms(tStart(trip)), end = tms(tEnd(trip));
  const gaps = tripGaps(trip), gapMin = gaps.reduce((s, g) => s + (g[1] - g[0]) / 60000, 0);
  const spanMin = (end - start) / 60000;
  const durMin = trip.gapAtSea || !gaps.length ? spanMin : spanMin - gapMin;
  const manual = trip.source === 'manual' || trip.source === 'plan';
  const recM = !manual && pts.length > 1 ? pathLen(pts) : (!manual && trip.distanceM > 0 ? trip.distanceM : null);
  // מסלול דליל: מעט נקודות, או רווח חציוני של יותר מ-5 דקות – המרחק הוא אומדן (קו ישר בין נקודות מקצר)
  const dts = pts.slice(1).map((x, i) => x[2] != null && pts[i][2] != null ? x[2] - pts[i][2] : null).filter(v => v != null).sort((a, b) => a - b);
  const sparse = pts.length < 6 || (dts.length ? dts[dts.length >> 1] > 300000 : true);
  let distKind, distM_ = null;
  if (fx.nm > 0) { distM_ = fx.nm * 1852; distKind = fx.est ? 'estimated' : 'manual'; }
  else if (recM != null) { distM_ = recM; distKind = sparse ? 'estimated' : 'recorded'; }
  else distKind = 'none';
  const nm = distM_ != null ? distM_ / 1852 : null;
  // קו ישר בין הנמלים (רק כרמז בהפלגה ידנית)
  const straightNm = manual && pts.length > 1 ? pathLen(pts) / 1852 : null;
  // מהירות מרבית (משוערת): על קטעים של 5 דקות לפחות, בקו ישר – כדי שריצוד לא ינפח אותה
  let maxSp = 0;
  if (!manual) for (let i = 0, j = 0; i < pts.length; i++) {
    if (j < i) j = i;
    while (j < pts.length && (pts[j][2] == null || pts[i][2] == null || pts[j][2] - pts[i][2] < 300000)) j++;
    if (j < pts.length && pts[i][2] != null && pts[j][2] - pts[i][2] < 1800000) { const v = distM(pts[i], pts[j]) / ((pts[j][2] - pts[i][2]) / 1000) * KN; if (v > maxSp && v <= maxKn) maxSp = v; }
  }
  const from = manual ? (trip.ports?.from || null) : pts.length ? nearestMarina(pts[0]) : null;
  const to = manual ? (trip.ports?.to || null) : pts.length ? nearestMarina(pts[pts.length - 1]) : null;
  const c = pts.length ? [pts.reduce((s, x) => s + x[0], 0) / pts.length, pts.reduce((s, x) => s + x[1], 0) / pts.length] : null;
  const far = !manual && pts.length ? pts.reduce((m, x) => distM(pts[0], x) > distM(pts[0], m) ? x : m, pts[0]) : null;
  // ממוצע: רק כשהמרחק והזמן מתאימים זה לזה (מרחק מתוקן בלי זמנים מתוקנים – לפי מה שנרשם)
  const avgBase = fx.nm > 0 && !fx.start && !fx.end && recM != null ? recM / 1852 : nm;
  return {
    pts, suspicious: cl.suspicious, raw, durMin, spanMin, gapMin, gaps, nm, distKind, straightNm, km: nm != null ? nm * 1.852 : null,
    avgKn: durMin > 0 && avgBase != null && !(manual && fx.nm == null) ? avgBase / (durMin / 60) : null,
    maxKn: maxSp || null, from, to, centroid: c, farNm: far ? distM(pts[0], far) / 1852 : null,
    recNm: recM != null ? recM / 1852 : null, fixed: !!(fx.start || fx.end || fx.nm > 0 || fx.label),
    nightMin: nightMinutes(start, end, ...(pts[0] || c || [32.16, 34.79]).slice(0, 2)) - (trip.gapAtSea ? 0 : gaps.reduce((s, g) => s + nightMinutes(g[0], g[1], ...(pts[0] || [32.16, 34.79]).slice(0, 2)), 0)),
    days: Math.floor(durMin / 1440)
  };
}
const placeTxt = s => s.from && s.to ? (s.from === s.to ? `מ${s.from} ובחזרה` : `מ${s.from} אל ${s.to}`) : s.from ? `יציאה מ${s.from}` : s.to ? `הגעה אל ${s.to}` : 'בים';
// נקודה על המסלול בזמן נתון (אינטרפולציה); בלי זמנים – לפי חלק יחסי מהמרחק
function posAt(pts, t, t0, t1) {
  if (!pts.length) return null;
  if (pts.every(p => p[2] != null)) {
    if (t <= pts[0][2]) return pts[0]; if (t >= pts[pts.length - 1][2]) return pts[pts.length - 1];
    const i = lowerBound(pts, t), a = pts[i - 1], b = pts[i], f = (t - a[2]) / ((b[2] - a[2]) || 1);
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  }
  const L = pathLen(pts), want = L * Math.min(1, Math.max(0, (t - t0) / ((t1 - t0) || 1)));
  let acc = 0;
  for (let i = 1; i < pts.length; i++) { const d = distM(pts[i - 1], pts[i]); if (acc + d >= want) { const f = d ? (want - acc) / d : 0; return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f]; } acc += d; }
  return pts[pts.length - 1];
}

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
const ROLE_NONE = 'לא צוין';
function migrateJournal(j) {
  if (!j || !Array.isArray(j.trips)) j = { trips: [] };
  if (!Array.isArray(j.vessels)) {
    j.vessels = [];
    if (j.vessel && Object.values(j.vessel).some(Boolean)) { j.vessels.push({ id: 'v1', ...j.vessel }); j.defaultVessel = 'v1'; }
  }
  delete j.vessel;
  j.trips = j.trips.map(t => normTrip(t)).filter(Boolean);
  j.v = 2;
  return j;
}
function loadJournal() {
  try { const j = JSON.parse(localStorage.getItem(JOURNAL_KEY)); if (j && Array.isArray(j.trips)) return migrateJournal(j); } catch (_) {}
  return migrateJournal(null);
}
// מחזיר true/false – מי שקורא חייב לבדוק ולהציג שגיאה אם השמירה נכשלה (אחסון מלא או חסום)
function saveJournal(j) {
  try { localStorage.setItem(JOURNAL_KEY, JSON.stringify(j)); return localStorage.getItem(JOURNAL_KEY) != null; } catch (_) { return false; }
}
const iso = t => { const x = tms(t); return x != null ? new Date(x).toISOString() : null; };
const str = (v, n = 4000) => v == null ? undefined : String(v).slice(0, n);
// כל השדות הנתמכים של הפלגה, אחרי בדיקה – גיבוי ושחזור לא מאבדים כלום
function normTrip(t) {
  if (!t || typeof t !== 'object') return null;
  const start = iso(t.start), end = iso(t.end);
  if (!start || !end || tms(end) <= tms(start)) return null;
  const notes = {};
  const n = t.notes && typeof t.notes === 'object' ? t.notes : {};
  ['crew', 'sails', 'text', 'skipper', 'engStart', 'engEnd', 'fuel', 'events', 'role'].forEach(k => { if (n[k] != null && n[k] !== '') notes[k] = str(n[k]); });
  if ([0, 1, 2, 3].includes(n.feel)) notes.feel = n.feel;
  if (n.safety) notes.safety = true;
  const fx = t.fix && typeof t.fix === 'object' ? t.fix : null;
  const fix = fx ? Object.fromEntries(Object.entries({ label: str(fx.label, 200), note: str(fx.note, 500), start: iso(fx.start), end: iso(fx.end), nm: +fx.nm > 0 ? Math.round(+fx.nm * 10) / 10 : null, est: fx.est ? true : null }).filter(([, v]) => v != null && v !== '')) : null;
  const ports = t.ports && typeof t.ports === 'object' ? Object.fromEntries(['from', 'via', 'to'].map(k => [k, portByName(t.ports[k]) ? t.ports[k] : null]).filter(([, v]) => v)) : null;
  const out = {
    id: str(t.id, 80) || start, start, end, source: ['manual', 'plan', 'google-timeline'].includes(t.source) ? t.source : 'google-timeline',
    type: t.type ? normType(t.type) : undefined, prob: Number.isFinite(+t.prob) && t.prob != null ? +t.prob : (Number.isFinite(+t.probability) && t.probability != null ? +t.probability : null),
    path: (Array.isArray(t.path) ? t.path : []).filter(p => Array.isArray(p) && okLL(p)).map(p => [r5(+p[0]), r5(+p[1]), p[2] != null ? iso(p[2]) : null]),
    distanceM: Number.isFinite(+(t.distanceM ?? t.dist)) && (t.distanceM ?? t.dist) != null ? Math.round(+(t.distanceM ?? t.dist)) : null,
    notes, fix: fix && Object.keys(fix).length ? fix : null, ports: ports && Object.keys(ports).length ? ports : null,
    segments: Array.isArray(t.segments) ? t.segments.map(s => [iso(s[0]), iso(s[1])]).filter(s => s[0] && s[1]) : undefined,
    gapAtSea: t.gapAtSea ? true : undefined, clean: t.clean === false ? false : undefined,
    vesselId: t.vesselId ? str(t.vesselId, 40) : undefined,
    wx: t.wx && Array.isArray(t.wx.rows) ? t.wx : null, planFc: t.planFc && Array.isArray(t.planFc.rows) ? t.planFc : undefined,
    createdAt: iso(t.createdAt) || undefined, updatedAt: iso(t.updatedAt) || undefined,
    deleted: !!t.deleted, deletedAt: t.deleted ? (iso(t.deletedAt) || undefined) : undefined
  };
  Object.keys(out).forEach(k => out[k] === undefined && delete out[k]);
  return out;
}
// הפלגה מקובץ Google → רשומת יומן
function toJournalTrip(a) {
  return normTrip({ id: new Date(a.start).toISOString(), start: a.start, end: a.end, type: a.type, prob: a.prob ?? a.probability, source: 'google-timeline',
    path: (a.path || []).map(p => [p[0], p[1], p[2]]), distanceM: a.dist ?? a.distanceM, segments: a.segments });
}

/* ===================== כפילויות =====================
   same      – אותה הפלגה (התחלה וסוף בהפרש של עד 10 דקות, או חפיפה של 90% לפחות לשתיהן)
   part      – קטע שנמצא כולו בתוך הפלגה קיימת (כנראה חלק ממנה)
   conflict  – חפיפה חלקית משמעותית – צריך להחליט
   new       – אין חפיפה, או חפיפה של דקות בודדות בקצוות (שתי הפלגות צמודות) */
function overlapInfo(a, b) {
  const as = tms(tStart(a)), ae = tms(tEnd(a)), bs = tms(tStart(b)), be = tms(tEnd(b));
  const ov = Math.max(0, Math.min(ae, be) - Math.max(as, bs));
  return { ov, fa: ov / Math.max(1, ae - as), fb: ov / Math.max(1, be - bs), ds: Math.abs(as - bs), de: Math.abs(ae - be) };
}
function classifyTrip(journal, t) {
  if (t.id) { const byId = journal.trips.find(x => x.id === t.id); if (byId) return { status: 'same', match: byId, byId: true }; }
  let best = null;
  for (const x of journal.trips) {
    const o = overlapInfo(t, x);
    if (!o.ov) continue;
    let status;
    if ((o.ds <= 600000 && o.de <= 600000) || (o.fa >= 0.9 && o.fb >= 0.9)) status = 'same';
    else if (o.fa >= 0.9) status = 'part';
    else if (o.ov < 15 * 60000 && o.fa < 0.15 && o.fb < 0.15) continue;   // נוגעות בקצה – שתי הפלגות נפרדות
    else status = 'conflict';
    const rank = { same: 3, part: 2, conflict: 1 }[status];
    if (!best || rank > best.rank) best = { status, match: x, rank };
  }
  return best ? { status: best.status, match: best.match } : { status: 'new', match: null };
}
// מיזוג קטע לתוך הפלגה קיימת: מרחיב זמנים ומוסיף נקודות, בלי למחוק את הקיים
function mergeInto(ex, t) {
  const segs = ex.segments && ex.segments.length ? ex.segments.slice() : [[ex.start, ex.end]];
  segs.push(...(t.segments && t.segments.length ? t.segments : [[t.start, t.end]]));
  ex.segments = segs.sort((a, b) => tms(a[0]) - tms(b[0]));
  if (tms(t.start) < tms(ex.start)) ex.start = t.start;
  if (tms(t.end) > tms(ex.end)) ex.end = t.end;
  const seen = new Set(ex.path.map(p => p[2] + ',' + p[0] + ',' + p[1]));
  ex.path = ex.path.concat(t.path.filter(p => !seen.has(p[2] + ',' + p[0] + ',' + p[1]))).sort((a, b) => (tms(a[2]) ?? 0) - (tms(b[2]) ?? 0));
  ex.wx = null;
}
// איחוד כמה קטעים (מאותו קובץ) להפלגה אחת – הפערים נשמרים כפערים
function mergeActs(list) {
  const s = list.slice().sort((a, b) => a.start - b.start);
  return { start: s[0].start, end: Math.max(...s.map(a => a.end)), type: 'SAILING', prob: null, dist: null,
    path: s.flatMap(a => a.path).sort((x, y) => (x[2] ?? 0) - (y[2] ?? 0)), segments: s.map(a => [new Date(a.start).toISOString(), new Date(a.end).toISOString()]) };
}

/* ===================== קריאת קובץ ===================== */
// מזהה את סוג הקובץ ומחזיר מועמדים: { kind, google?: {acts, format, bad}, trips?: [...], vessels? }
function readAnyFile(json) {
  if (json && typeof json === 'object' && !Array.isArray(json) && typeof json.format === 'string') {
    if (/^marina-weather-journal\/[12]$/.test(json.format)) {
      if (!Array.isArray(json.trips)) throw new Error('קובץ הגיבוי פגום – אין בו רשימת הפלגות.');
      const trips = json.trips.map(normTrip);
      return { kind: 'backup', label: 'גיבוי של היומן', trips: trips.filter(Boolean), bad: trips.filter(x => !x).length,
        vessels: Array.isArray(json.vessels) ? json.vessels : json.vessel && Object.values(json.vessel).some(Boolean) ? [{ id: 'v1', ...json.vessel }] : [],
        defaultVessel: typeof json.defaultVessel === 'string' ? json.defaultVessel : null, plansDone: Array.isArray(json.plansDone) ? json.plansDone.filter(x => typeof x === 'string') : [] };
    }
    if (json.format === 'marina-weather-sailing/1') {
      if (!Array.isArray(json.trips)) throw new Error('הקובץ פגום – אין בו רשימת הפלגות.');
      const acts = json.trips.map(t => ({ type: normType(t.type || 'SAILING'), prob: t.probability ?? null, start: tms(t.start), end: tms(t.end), dist: t.distanceM ?? null,
        path: (t.path || []).map(p => [+p[0], +p[1], tms(p[2])]).filter(okLL) })).filter(a => a.start != null && a.end != null && a.end > a.start);
      return { kind: 'google', label: 'קובץ הפלגות מסונן', google: { acts, format: 'מסונן', bad: json.trips.length - acts.length } };
    }
    throw new Error(UNSUPPORTED);
  }
  const r = parseTimeline(json);
  return { kind: 'google', label: `ציר הזמן של Google (${r.format})`, google: r };
}
