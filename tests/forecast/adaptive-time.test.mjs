import {test,expect} from 'bun:test';
import {regime_rate} from '../../dist/src/forecast/regime.mjs';
import {ensemble} from '../../dist/src/forecast/models.mjs';
import {temporal_history,rate_tables,calendar_factor,apply_calendar} from '../../dist/src/forecast/calendar.mjs';
import {judge} from '../../dist/src/app/engine.mjs';
import {snapshot} from '../helpers/fixture.mjs';
const day=86400000;
function intervals(gaps){let at=Date.parse('2026-01-01T00:00:00Z');return gaps.map(g=>{const start=new Date(at).toISOString();at+=g*day;return {start,end:new Date(at).toISOString(),duration:g*day,observed:false};});}
function events(n){return Array.from({length:n},(_,i)=>({id:'e'+i,at:new Date(Date.parse('2026-01-01T04:00:00Z')+i*3*day).toISOString(),global:true,verified:true,observed:false}));}
test('recent pace follows both acceleration and slowdown, shrinks sparse data and includes ongoing exposure',()=>{
 const fast=intervals([...Array(20).fill(8),...Array(8).fill(2)]),slow=intervals([...Array(20).fill(2),...Array(8).fill(8)]);
 const f=regime_rate(fast,0,fast.at(-1).end),s=regime_rate(slow,0,slow.at(-1).end);
 expect(f.rate).toBeGreaterThan(f.longRate);expect(s.rate).toBeLessThan(s.longRate);
 const held=regime_rate(fast,20*day,new Date(Date.parse(fast.at(-1).end)+20*day).toISOString());expect(held.rate).toBeLessThan(f.rate);
 const lone=regime_rate(intervals([2]),0,intervals([2]).at(-1).end);expect(lone.profiles.every(p=>p.effectiveN<=1.001)).toBe(true);expect(lone.shrink).toBeLessThan(.12);
 const future={...fast.at(-1),end:'2029-01-01T00:00:00Z',duration:day};expect(regime_rate([...fast,future],0,fast.at(-1).end)).toEqual(f);
 expect(ensemble(fast,day,fast.at(-1).end).candidates.map(x=>x.name)).toEqual(['recent-rate','decayed-rate','conditional','decayed-conditional','adaptive-rate']);
 const result=ensemble(fast,day,fast.at(-1).end);expect(result.evaluation.cycles).toBeLessThan(result.evaluation.n);expect(result.candidates.reduce((s,p)=>s+p.weight,0)).toBeCloseTo(1);
});
test('hour and calendar distributions retain exposure, shrink empty buckets and respond to newly added events',()=>{
 const xs=events(35),now=new Date(Date.parse(xs.at(-1).at)+day).toISOString();const history=temporal_history(xs,now),rates=rate_tables(history,now);
 expect(rates.tables.hourBucket).toHaveLength(8);expect(rates.tables.weekday).toHaveLength(7);expect(rates.tables.dayOfMonth).toHaveLength(31);expect(rates.tables.monthPhase).toHaveLength(3);
 for(const profile of rates.profiles){expect(profile.tables.hourBucket.reduce((s,b)=>s+b.exposureDays,0)).toBeCloseTo(profile.exposureDays,6);expect(profile.effectiveN).toBeGreaterThan(0);}
 const preferred=calendar_factor(rates,'2026-04-14T04:00:00Z'),other=calendar_factor(rates,'2026-04-14T19:00:00Z');
 expect(preferred.factor).toBeGreaterThan(other.factor);for(const f of [preferred,other]){expect(f.factor).toBeGreaterThanOrEqual(2/3);expect(f.factor).toBeLessThanOrEqual(1.5);expect(f.parts.map(p=>p.name)).toContain('hourBucket');}
 const empty=rate_tables(temporal_history([],now),now);expect(calendar_factor(empty,now).factor).toBe(1);
 const shifted=xs.map(e=>({...e,at:new Date(Date.parse(e.at)+15*3600000).toISOString()}));const updated=rate_tables(temporal_history(shifted,new Date(Date.parse(now)+day).toISOString()),new Date(Date.parse(now)+day).toISOString());expect(calendar_factor(updated,'2026-04-14T19:00:00Z').factor).toBeGreaterThan(calendar_factor(updated,'2026-04-14T04:00:00Z').factor);
});
test('UTC integration handles DST and retains 8 legacy segments plus 48 hourly pieces; display settings cannot alter probability',()=>{
 const old={...process.env};try{
 process.env.TIBO_TIMEZONE='UTC';process.env.TIBO_FORECAST_TIMEZONE='America/New_York';
 const xs=[{id:'a',at:'2026-10-31T04:00:00Z',global:true,verified:true},{id:'b',at:'2026-11-01T04:00:00Z',global:true,verified:true}];
 const rates=rate_tables(temporal_history(xs,'2026-11-02T05:00:00Z'),'2026-11-02T05:00:00Z');expect(rates.rawExposureDays).toBeCloseTo(49/24);
 const a=judge(snapshot());process.env.TIBO_TIMEZONE='Asia/Tokyo';const b=judge(snapshot());expect(a.forecast.base24).toBe(b.forecast.base24);expect(a.forecast.base48).toBe(b.forecast.base48);
 expect(a.forecast.temporal.segments).toHaveLength(8);expect(a.forecast.temporal.hourSegments).toHaveLength(48);expect(a.forecast.p48).toBeGreaterThanOrEqual(a.forecast.p24);
 const h=apply_calendar({base24:20,base48:36},null,[],'2026-10-19T00:00:00Z');expect(h.p24).toBe(20);expect(h.p48).toBe(36);
 }finally{for(const k of ['TIBO_TIMEZONE','TIBO_FORECAST_TIMEZONE','TIBO_SCHEDULE_TIMEZONE'])if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k];}
});
