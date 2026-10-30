'use strict';
/* ים הרצליה – שליפת נתונים מ-Open-Meteo, איחוד לשורות שעתיות ושמירה מקומית */
/* ===================== אחסון (עובד גם מחוץ לתוסף) ===================== */
const store = {
  get(area, key) {
    return new Promise(res => {
      try { chrome.storage[area].get(key, v => res(v ? v[key] : undefined)); }
      catch (e) { try { res(JSON.parse(localStorage.getItem(key))); } catch (_) { res(undefined); } }
    });
  },
  set(area, key, val) {
    return new Promise(res => {
      try { chrome.storage[area].set({ [key]: val }, () => res()); }
      catch (e) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (_) {} res(); }
    });
  }
};

/* ===================== שליפת נתונים ===================== */
function buildUrls(s) {
  const common = `timezone=${encodeURIComponent(TZ)}&forecast_days=${DAYS}`;
  return {
    forecast: `https://api.open-meteo.com/v1/forecast?latitude=${s.windLat}&longitude=${s.windLon}` +
      `&hourly=temperature_2m,precipitation_probability,precipitation,weather_code,cloud_cover,visibility,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,cape` +
      `&daily=sunrise,sunset&current=temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,pressure_msl,weather_code` +
      `&wind_speed_unit=kn&cell_selection=sea&${common}`,
    models: `https://api.open-meteo.com/v1/forecast?latitude=${s.windLat}&longitude=${s.windLon}` +
      `&hourly=wind_speed_10m,wind_gusts_10m&models=${MODELS.map(m => m.id).join(',')}&wind_speed_unit=kn&cell_selection=sea&${common}`,
    marine: `https://marine-api.open-meteo.com/v1/marine?latitude=${s.waveLat}&longitude=${s.waveLon}` +
      `&hourly=wave_height,wave_direction,wave_period,wind_wave_height,wind_wave_period,wind_wave_direction,swell_wave_height,swell_wave_direction,swell_wave_period,sea_surface_temperature` +
      `&current=wave_height,wave_period,wave_direction,sea_surface_temperature&${common}`,
    // אנסמבל: 122 הרצות (ECMWF 51 + GFS 31 + ICON 40) – לחישוב סיכוי לגשם אמיתי
    ensemble: `https://ensemble-api.open-meteo.com/v1/ensemble?latitude=${s.windLat}&longitude=${s.windLon}` +
      `&hourly=precipitation&models=ecmwf_ifs025,gfs025,icon_global&cell_selection=sea&${common}`
  };
}

async function getJson(url, ms = 15000) {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => ctl && ctl.abort(), ms);
  try {
    const r = await fetch(url, { cache: 'no-store', signal: ctl ? ctl.signal : undefined });
    if (!r.ok) {
      let msg = `HTTP ${r.status}`;
      try { const j = await r.json(); if (j.reason) msg += ` – ${j.reason}`; } catch (_) {}
      throw new Error(msg);
    }
    return await r.json();
  } catch (e) {
    throw new Error(e && e.name === 'AbortError' ? 'השרת לא ענה בזמן' : (e.message || 'שגיאת רשת'));
  } finally { clearTimeout(timer); }
}

// טעינה בשני שלבים: קודם רוח וגלים (חובה), אחר כך השוואת מודלים ואנסמבל הגשם
async function fetchAll(onCore) {
  const u = buildUrls(settings);
  const pfc = getJson(u.forecast, 15000), pmr = getJson(u.marine, 15000);
  const pmd = getJson(u.models, 20000), pen = getJson(u.ensemble, 20000);
  // אם הבקשות העיקריות נכשלות יוצאים מוקדם – שלא תישאר דחייה בלי טיפול
  pmd.catch(() => {}); pen.catch(() => {});
  const [fc, mr] = await Promise.allSettled([pfc, pmr]);
  if (fc.status === 'rejected' && mr.status === 'rejected') throw new Error(`לא ניתן לקבל תחזית (${fc.reason.message})`);
  const errors = [];
  if (fc.status === 'rejected') errors.push('תחזית הרוח לא נטענה – אין המלצה עד שתיטען');
  if (mr.status === 'rejected') errors.push('תחזית הגלים לא נטענה – אין המלצה עד שתיטען');
  if (onCore) try { onCore(merge(fc.value, null, mr.value, [...errors], null)); } catch (_) {}
  const [md, en] = await Promise.allSettled([pmd, pen]);
  return merge(fc.value, md.status === 'fulfilled' ? md.value : null, mr.value, errors, en.status === 'fulfilled' ? en.value : null);
}

function merge(fc, md, mr, errors, en) {
  const byTime = new Map();
  const row = t => {
    if (!byTime.has(t)) byTime.set(t, { t, date: t.slice(0, 10), hour: +t.slice(11, 13), models: {} });
    return byTime.get(t);
  };
  if (fc && fc.hourly) {
    const h = fc.hourly;
    h.time.forEach((t, i) => Object.assign(row(t), {
      temp: h.temperature_2m[i], pop: h.precipitation_probability?.[i], rain: h.precipitation[i],
      code: h.weather_code[i], cloud: h.cloud_cover[i], vis: h.visibility?.[i], pres: h.pressure_msl[i],
      wind: h.wind_speed_10m[i], dir: h.wind_direction_10m[i], gust: h.wind_gusts_10m[i], cape: h.cape?.[i]
    }));
  }
  // סיכוי לגשם מחושב מהאנסמבל (במקום precipitation_probability שסופר כל טיפה)
  let hasEnsemble = false, ensembleN = 0;
  if (en && en.hourly) {
    const h = en.hourly;
    const keys = Object.keys(h).filter(k => k.startsWith('precipitation'));
    if (keys.length >= 10) {
      hasEnsemble = true; ensembleN = keys.length;
      h.time.forEach((t, i) => {
        let n = 0, rainN = 0, drizN = 0;
        for (const k of keys) { const v = h[k][i]; if (v == null) continue; n++; if (v >= RAIN_MM) rainN++; if (v >= DRIZZLE_MM) drizN++; }
        if (!n) return;
        const r = row(t);
        r.popAny = r.pop;                       // הערך המקורי של Open-Meteo (כל טיפה)
        r.pop = Math.round(100 * rainN / n);    // סיכוי לגשם ≥0.5 מ"מ/שעה
        r.drizzle = Math.round(100 * drizN / n);
      });
    }
  }
  let hasModels = false;
  if (md && md.hourly) {
    const h = md.hourly;
    h.time.forEach((t, i) => {
      const r = row(t);
      for (const m of MODELS) {
        const w = h[`wind_speed_10m_${m.id}`], g = h[`wind_gusts_10m_${m.id}`];
        if (w && w[i] != null) { r.models[m.name] = { wind: w[i], gust: g ? g[i] : null }; hasModels = true; }
      }
    });
  }
  if (mr && mr.hourly) {
    const h = mr.hourly;
    h.time.forEach((t, i) => Object.assign(row(t), {
      wave: h.wave_height[i], waveDir: h.wave_direction[i], wavePer: h.wave_period[i],
      ww: h.wind_wave_height[i], wwPer: h.wind_wave_period[i], wwDir: h.wind_wave_direction[i],
      sw: h.swell_wave_height[i], swDir: h.swell_wave_direction[i], swPer: h.swell_wave_period[i],
      sst: h.sea_surface_temperature?.[i]
    }));
  }
  const daily = {};
  if (fc && fc.daily) fc.daily.time.forEach((d, i) => daily[d] = { sunrise: fc.daily.sunrise[i], sunset: fc.daily.sunset[i] });

  const rows = [...byTime.values()].sort((a, b) => a.t < b.t ? -1 : 1);
  const waveAllNull = rows.every(r => r.wave == null);
  if (mr && waveAllNull) errors.push('מודל הגלים לא מחזיר נתונים לנקודה הזאת – הזז את נקודת הגלים מערבה בהגדרות');

  const grid = {
    wind: fc && fc.latitude != null ? [fc.latitude, fc.longitude] : null,
    wave: mr && mr.latitude != null ? [mr.latitude, mr.longitude] : null,
    models: md && md.latitude != null ? [md.latitude, md.longitude] : null
  };
  return {
    rows, daily, hasModels, hasEnsemble, ensembleN, errors, grid,
    current: { ...(fc?.current || {}), ...(mr?.current ? { wave: mr.current.wave_height, wavePer: mr.current.wave_period, waveDir: mr.current.wave_direction, sst: mr.current.sea_surface_temperature } : {}) },
    fetchedAt: Date.now()
  };
}

