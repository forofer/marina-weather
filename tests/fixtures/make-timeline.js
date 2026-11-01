// יוצר קבצי ציר זמן לדוגמה בשלושת הפורמטים (נתונים מומצאים לחלוטין)
const fs = require('fs'), path = require('path');
const HOME = [32.0801, 34.7801];            // "בית" – אסור שיופיע בקובץ היוצא
const MARINA = [32.1631, 34.7962];
const sailPts = [];                          // 31/10 15:00–17:00 כל 4 דקות, יציאה מערבה וחזרה
for (let m = 0; m <= 120; m += 4) { const f = m <= 60 ? m / 60 : (120 - m) / 60; sailPts.push([MARINA[0] + 0.01 * f, MARINA[1] - 0.06 * f, Date.parse('2026-10-31T15:00:00+02:00') + m * 60000]); }
const iso = t => new Date(t).toISOString().replace('Z', '+00:00');
const deg = p => `${p[0]}°, ${p[1]}°`, geo = p => `geo:${p[0]},${p[1]}`;
// A. אנדרואיד
const A = { semanticSegments: [
  { startTime: '2026-10-31T06:00:00.000+02:00', endTime: '2026-10-31T13:00:00.000+02:00', visit: { topCandidate: { placeLocation: { latLng: deg(HOME) }, semanticType: 'HOME' } } },
  { startTime: '2026-10-31T13:00:00.000+02:00', endTime: '2026-10-31T13:40:00.000+02:00', activity: { start: { latLng: deg(HOME) }, end: { latLng: deg(MARINA) }, distanceMeters: 15000, topCandidate: { type: 'IN_PASSENGER_VEHICLE', probability: 0.9 } } },
  { startTime: '2026-10-31T13:40:00.000+02:00', endTime: '2026-10-31T14:50:00.000+02:00', activity: { start: { latLng: deg(MARINA) }, end: { latLng: deg(MARINA) }, distanceMeters: 300, topCandidate: { type: 'WALKING', probability: 0.8 } } },
  { startTime: '2026-10-31T15:00:00.000+02:00', endTime: '2026-10-31T17:00:00.000+02:00', activity: { start: { latLng: deg(MARINA) }, end: { latLng: deg(MARINA) }, distanceMeters: 11800, topCandidate: { type: 'SAILING', probability: 0.95 } } },
  { startTime: '2026-10-31T13:00:00.000+02:00', endTime: '2026-10-31T18:00:00.000+02:00', timelinePath: [[...HOME, Date.parse('2026-10-31T13:01:00+02:00')], ...sailPts].map(p => ({ point: deg(p), time: iso(p[2]) })) }
], rawSignals: [{ position: { LatLng: deg(HOME), timestamp: '2026-10-31T06:00:00.000+02:00' } }], userLocationProfile: { frequentPlaces: [{ placeLocation: deg(HOME), label: 'HOME' }] } };
// B. אייפון
const st = Date.parse('2026-10-31T15:00:00+02:00');
const B = [
  { startTime: '2026-10-31T06:00:00.000+02:00', endTime: '2026-10-31T13:00:00.000+02:00', visit: { topCandidate: { placeLocation: geo(HOME), semanticType: 'Home' } } },
  { startTime: '2026-10-31T13:00:00.000+02:00', endTime: '2026-10-31T13:40:00.000+02:00', activity: { start: geo(HOME), end: geo(MARINA), distanceMeters: '15000', topCandidate: { type: 'in passenger vehicle', probability: '0.9' } } },
  { startTime: '2026-10-31T15:00:00.000+02:00', endTime: '2026-10-31T17:00:00.000+02:00', activity: { start: geo(MARINA), end: geo(MARINA), distanceMeters: '11800', topCandidate: { type: 'sailing', probability: '0.93' } } },
  { startTime: '2026-10-31T15:00:00.000+02:00', endTime: '2026-10-31T17:00:00.000+02:00', timelinePath: sailPts.map(p => ({ point: geo(p), durationMinutesOffsetFromStartTime: String((p[2] - st) / 60000) })) }
];
// C. Takeout ישן
const e7 = p => ({ latitudeE7: Math.round(p[0] * 1e7), longitudeE7: Math.round(p[1] * 1e7) });
const C = { timelineObjects: [
  { placeVisit: { location: { ...e7(HOME), name: 'Home' } } },
  { activitySegment: { startLocation: e7(HOME), endLocation: e7(MARINA), duration: { startTimestamp: '2026-10-31T11:00:00Z', endTimestamp: '2026-10-31T11:40:00Z' }, distance: 15000, activityType: 'IN_PASSENGER_VEHICLE' } },
  { activitySegment: { startLocation: e7(MARINA), endLocation: e7(MARINA), duration: { startTimestamp: '2026-10-31T13:00:00Z', endTimestamp: '2026-10-31T15:00:00Z' }, activityType: 'SAILING',
    simplifiedRawPath: { points: sailPts.map(p => ({ latE7: Math.round(p[0] * 1e7), lngE7: Math.round(p[1] * 1e7), timestamp: new Date(p[2]).toISOString() })) } } }
] };
const dir = __dirname;
fs.writeFileSync(path.join(dir, 'timeline-android.json'), JSON.stringify(A));
fs.writeFileSync(path.join(dir, 'timeline-ios.json'), JSON.stringify(B));
fs.writeFileSync(path.join(dir, 'timeline-takeout.json'), JSON.stringify(C));
fs.writeFileSync(path.join(dir, 'timeline-bad.json'), '{"hello": 1}');
console.log('ok');
