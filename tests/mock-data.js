
function times(){ const out=[]; const d0=new Date(Date.UTC(2026,9,25)); for(let h=0;h<24*7;h++){ const d=new Date(d0.getTime()+h*3600e3); out.push(d.toISOString().slice(0,13)+':00'); } return out; }
const T=times();
const wv=i=>Math.max(2,10+7*Math.sin(i/6)+(i%24>12&&i%24<16?5:0));
const fc={hourly:{time:T,temperature_2m:T.map((_,i)=>22+4*Math.sin(i/4)),precipitation_probability:T.map((_,i)=>i%30<3?60:0),precipitation:T.map((_,i)=>i%30<3?1.2:0),weather_code:T.map((_,i)=>i===40?95:(i%7)),cloud_cover:T.map(()=>20),visibility:T.map((_,i)=>i%50===0?1500:24000),pressure_msl:T.map((_,i)=>1013-(i>60&&i<70?(i-60)*1.2:0)),wind_speed_10m:T.map((_,i)=>Math.max(0,wv(i))),wind_direction_10m:T.map((_,i)=>(i*15)%360),wind_gusts_10m:T.map((_,i)=>Math.max(0,wv(i)*1.4)),cape:T.map(()=>100)},
 daily:{time:[...new Set(T.map(t=>t.slice(0,10)))],sunrise:[...Array(7)].map((_,i)=>`2026-10-${25+i}T06:05`),sunset:[...Array(7)].map((_,i)=>`2026-10-${25+i}T16:55`)},
 current:{wind_speed_10m:9,wind_direction_10m:290,wind_gusts_10m:14,temperature_2m:25}};
const md={hourly:{time:T}}; for(const m of ['ecmwf_ifs025','icon_seamless','gfs_seamless']){ md.hourly['wind_speed_10m_'+m]=T.map((_,i)=>wv(i)+(m[0]==='g'?2:0)); md.hourly['wind_gusts_10m_'+m]=T.map((_,i)=>wv(i)*1.5);}
const mr={hourly:{time:T,wave_height:T.map((_,i)=>0.5+0.8*Math.abs(Math.sin(i/10))),wave_direction:T.map(()=>290),wave_period:T.map((_,i)=>4+3*Math.abs(Math.cos(i/9))),wind_wave_height:T.map(()=>0.4),wind_wave_period:T.map(()=>3.5),wind_wave_direction:T.map(()=>280),swell_wave_height:T.map(()=>0.6),swell_wave_direction:T.map(()=>300),swell_wave_period:T.map(()=>7.5),sea_surface_temperature:T.map(()=>25.4)},current:{wave_height:0.9,wave_period:5.2}};

module.exports={T,fc,md,mr};
