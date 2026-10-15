import {test,expect} from 'bun:test';
import {judge,available_judgment} from '../../dist/src/app/engine.mjs';
import {apply_promise_policy} from '../../dist/src/forecast/promise-policy.mjs';
import {snapshot,post} from '../helpers/fixture.mjs';
const now='2026-09-25T01:00:00Z';
const s=(text='Global reset landing within the next 2 hours.',extra={})=>snapshot({now,posts:[...snapshot().posts,post(25,text,{id:'timed',at:'2026-09-25T00:30:00Z'})],...extra});
test('numeric promise estimates vary with deadline distance and elapsed waiting, rather than one fixed floor',()=>{
 const short=judge(s()),long=judge(s('Global reset landing within the next 48 hours.'));
 expect(short.forecast.p24).toBeGreaterThan(long.forecast.p24);expect(long.forecast.p48).toBeGreaterThan(long.forecast.p24);
 const late=judge(s(undefined,{now:'2026-09-25T04:00:00Z'})),stale=judge(s(undefined,{now:'2026-09-26T12:00:00Z'}));
 expect(late.forecast.p24).toBeLessThan(short.forecast.p24);expect(stale.forecast.p24).toBeLessThan(late.forecast.p24);
 for(const r of [short,long,late,stale]){expect(Number.isInteger(r.forecast.p24)).toBe(true);expect(r.forecast.p48).toBeGreaterThanOrEqual(r.forecast.p24);}
});
test('conditional, archived, banked, withdrawn and consumed messages do not receive the explicit promise prior',()=>{
 for(const text of ['Either an improvement or a global reset within the next 2 hours.','A banked reset card landing within the next 2 hours.','Global reset will not land within the next 2 hours.'])expect(judge(s(text)).forecast.promisePrior).toBeUndefined();
 const a=s();a.posts.at(-1).provenance='archive';expect(judge(a).forecast.promisePrior).toBeUndefined();
 a.posts.at(-1).provenance='primary';a.posts.push(post(25,'Global reset has been processed.',{id:'done',at:'2026-09-25T00:45:00Z'}));a.events.push({id:'done',at:'2026-09-25T00:45:00Z',global:true,banked:false});expect(judge(a).forecast.promisePrior).toBeUndefined();
});
test('reapplying a promise policy does not compound the probability uplift',()=>{
 const r=judge(s()),before=[r.forecast.p24,r.forecast.p48];apply_promise_policy(r.forecast,r.signals,r.snapshot);apply_promise_policy(r.forecast,r.signals,r.snapshot);
 expect([r.forecast.p24,r.forecast.p48]).toEqual(before);
});
test('zero-history and single-event forecasts stay numeric, including a verified promise',()=>{
 for(const input of [snapshot({events:[],posts:[]}),s(undefined,{events:[]})]){
  const r=available_judgment(input);expect(r.forecast.available).toBe(true);expect(r.forecast.p24).toBeGreaterThan(0);expect(r.forecast.p48).toBeGreaterThanOrEqual(r.forecast.p24);
  expect(r.forecast.ratePrior.priorBetaDays).toBe(10);
 }
});
