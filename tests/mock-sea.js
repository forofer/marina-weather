// נתוני דמה: 30/10 10:00–17:00 בתנאים של ההפלגה ב-31/10 (כפי שנחזו יום קודם):
// רוח 11.4 קשר (ECMWF 12.5 / ICON 13 / GFS 8.6), משבים 15, סוול 72 ס"מ מ-288° + גלי רוח 32 ס"מ קצרים מ-333° → ים צולב
const base = require('./mock-data.js');
const clone = x => JSON.parse(JSON.stringify(x));
const fc = clone(base.fc), md = clone(base.md), mr = clone(base.mr), T = base.T;
for (let h = 10; h <= 17; h++) {
  const i = T.indexOf(`2026-10-30T${String(h).padStart(2, '0')}:00`);
  Object.assign(fc.hourly, {});
  fc.hourly.wind_speed_10m[i] = 11.4; fc.hourly.wind_gusts_10m[i] = 15.2; fc.hourly.wind_direction_10m[i] = 335; fc.hourly.weather_code[i] = 2; fc.hourly.visibility[i] = 24000;
  md.hourly.wind_speed_10m_ecmwf_ifs025[i] = 12.5; md.hourly.wind_speed_10m_icon_seamless[i] = 13; md.hourly.wind_speed_10m_gfs_seamless[i] = 8.6;
  md.hourly.wind_gusts_10m_ecmwf_ifs025[i] = 16; md.hourly.wind_gusts_10m_icon_seamless[i] = 16.7; md.hourly.wind_gusts_10m_gfs_seamless[i] = 7.2;
  mr.hourly.wave_height[i] = 0.8; mr.hourly.wave_period[i] = 6.15; mr.hourly.wave_direction[i] = 296;
  mr.hourly.wind_wave_height[i] = 0.32; mr.hourly.wind_wave_period[i] = 2.4; mr.hourly.wind_wave_direction = mr.hourly.wind_wave_direction || T.map(() => 300); mr.hourly.wind_wave_direction[i] = 333;
  mr.hourly.swell_wave_height[i] = 0.72; mr.hourly.swell_wave_period[i] = 5.8; mr.hourly.swell_wave_direction[i] = 288;
}
module.exports = { ...base, fc, md, mr };
