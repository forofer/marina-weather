// נתוני דמה קבועים לגשם (על בסיס mock-data). הכמות וההסתברות בשורה של H הן לשעה H-1…H (כמו Open-Meteo).
//  30/10: גשם קל 11:00–13:00 (שורות 12–13, הסתברות 70/80%), גשם בינוני 15:00–16:00 (שורה 16, 4 מ"מ, הסתברות נמוכה 30%)
//  31/10: סופת רעמים 11:00–12:00 עם מעט משקעים (שורה 12, קוד 95, 0.2 מ"מ)
//  31/10: נתוני גשם חסרים בשורות 17–21 (16:00–21:00)
//  שאר הימים: יבש
const base = require('./mock-data.js');
const clone = x => JSON.parse(JSON.stringify(x));
const fc = clone(base.fc), T = base.T;
const H = fc.hourly;
T.forEach((t, i) => { H.precipitation[i] = 0; H.precipitation_probability[i] = 0; if (H.weather_code[i] >= 51) H.weather_code[i] = 2; });
const at = t => T.indexOf(t);
const set = (t, mm, p, code) => { const i = at(t); H.precipitation[i] = mm; H.precipitation_probability[i] = p; if (code != null) H.weather_code[i] = code; };
set('2026-10-30T12:00', 0.8, 70, 61); set('2026-10-30T13:00', 1.5, 80, 61); set('2026-10-30T16:00', 4.0, 30, 63);
set('2026-10-31T12:00', 0.2, 20, 95);
for (let h = 17; h <= 21; h++) { const i = at(`2026-10-31T${String(h).padStart(2, '0')}:00`); H.precipitation[i] = null; H.precipitation_probability[i] = null; H.weather_code[i] = null; }
module.exports = { ...base, fc };
// גרסה עם אנסמבל: 20 תרחישים; בשעה גשומה 16 מהם צופים את הכמות (80%), בשעה חסרה – כולם null
const en = { hourly: { time: T } };
for (let k = 0; k < 20; k++) en.hourly['precipitation_member' + String(k).padStart(2, '0')] = T.map((_, i) => { const mm = H.precipitation[i]; return mm == null ? null : mm >= 0.5 ? (k < 16 ? mm : 0) : 0; });
module.exports.en = en;
