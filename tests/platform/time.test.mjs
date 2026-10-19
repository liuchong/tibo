import {test,expect} from 'bun:test';
import {time_settings,local_vector,local_time} from '../../dist/src/platform/time.mjs';
import {slot_at,next_slot} from '../../dist/src/subscriptions/schedule.mjs';
function zone(values,run){const keys=['TIBO_TIMEZONE','TIBO_FORECAST_TIMEZONE','TIBO_SCHEDULE_TIMEZONE'],old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));try{for(const k of keys){delete process.env[k];if(values[k])process.env[k]=values[k];}return run();}finally{for(const k of keys)if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k];}}
test('configured zones are explicit, independent, validated and do not follow process TZ',()=>zone({},()=>{
 expect(time_settings()).toEqual({displayZone:'UTC',forecastZone:'UTC',scheduleZone:'UTC'});
 expect(local_vector('2026-10-01T01:00:00Z','America/Los_Angeles')).toMatchObject({date:'2026-09-30',hour:18,dayOfMonth:30,monthPhase:2,weekday:3});
 expect(local_time('2026-10-01T01:00:00Z','Asia/Shanghai')).toBe('10-01 09:00');
 zone({TIBO_TIMEZONE:'Asia/Tokyo',TIBO_FORECAST_TIMEZONE:'UTC'},()=>expect(time_settings()).toEqual({displayZone:'Asia/Tokyo',forecastZone:'UTC',scheduleZone:'Asia/Tokyo'}));
 zone({TIBO_TIMEZONE:'Mars/Example'},()=>expect(()=>time_settings()).toThrow('时区'));
}));
test('only configured 09/21 slots exist and DST changes UTC offsets without changing local hours',()=>{
 zone({TIBO_TIMEZONE:'UTC'},()=>{expect(slot_at('2026-10-04T09:00:05Z').at).toBe('2026-10-04T09:00:00.000Z');expect(slot_at('2026-10-04T01:00:00Z')).toBeNull();});
 zone({TIBO_SCHEDULE_TIMEZONE:'America/New_York'},()=>{
  expect(next_slot('2026-10-31T14:00:00Z')).toBe('2026-11-01T01:00:00.000Z');
  expect(next_slot('2026-11-01T01:00:00Z')).toBe('2026-11-01T14:00:00.000Z');
  expect(slot_at('2026-11-01T14:00:01Z')).not.toBeNull();
 });
});
