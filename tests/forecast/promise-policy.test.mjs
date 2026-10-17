import {test,expect} from 'bun:test';
import {judge,available_judgment} from '../../dist/src/app/engine.mjs';
import {target_time} from '../../dist/src/forecast/signals.mjs';
import {local_row} from '../../dist/src/evidence/post-features.mjs';
import {feature_state} from '../../dist/src/forecast/features.mjs';
import {apply_promise_policy} from '../../dist/src/forecast/promise-policy.mjs';
import {render_report} from '../../dist/src/presentation/report.mjs';
import {snapshot,post} from '../helpers/fixture.mjs';
const text='Global reset landing by EOD PST time. Enjoy';
const promise=()=>post(25,text,{id:'2109812360596865224',at:'2026-10-13T01:03:59.841Z'});
const input=()=>snapshot({now:'2026-10-13T04:08:00Z',posts:[...snapshot().posts,promise()]});
test('official EOD announcement resolves deadline and produces a smoothed numeric estimate',()=>{
 const s=input(),r=judge(s);
 expect(target_time(promise())).toBe('2026-10-13T08:00:00.000Z');
 expect(r.signals.promise).toMatchObject({kind:'global',primary:true,fulfilled:false,timePrecision:'deadline'});
 const base=judge({...s,posts:s.posts.slice(0,-1)});
 expect(r.forecast).toMatchObject({available:true,mode:'dimensional-delivery',base24:base.forecast.base24,policyVersion:'10'});
 expect(r.forecast.p24).toBeGreaterThan(base.forecast.p24);expect(r.forecast.p48).toBeGreaterThanOrEqual(r.forecast.p24);
 expect(render_report(r)).toMatch(/24h：[0-9]+%/);
 expect(r.forecast.promisePolicy).toMatchObject({applied:false,n:0,reason:'insufficient-audited-cases'});
 const f=feature_state(r,{rows:s.posts.map(local_row),aiRows:0,ruleRows:s.posts.length});
 expect(f.claims.find(c=>c.postId===promise().id)).toMatchObject({kind:'promise',status:'active',targetAt:'2026-10-13T08:00:00.000Z',timePrecision:'deadline'});
 const rows=s.posts.map(local_row);rows.at(-1).claims[0].timeText='EOD PST time';
 expect(feature_state(r,{rows,aiRows:1,ruleRows:rows.length-1}).claims.at(-1).timePrecision).toBe('deadline');
 expect(render_report(r)).toContain('期限为 UTC 10-13 08:00');
 expect(render_report(r)).not.toContain('没有承诺具体时间');
});
test('PST/PDT use their stated local calendar; PT follows DST; tomorrow and end-of-day synonyms stay bounded',()=>{
 const p={...promise(),at:'2026-10-13T07:30:00Z'};
 expect(target_time(p)).toBe('2026-10-13T08:00:00.000Z');
 expect(target_time({...p,text:'Global reset landing by EOD PDT.'})).toBe('2026-10-14T07:00:00.000Z');
 expect(target_time({...p,text:'Global reset landing by EOD PT.'})).toBe('2026-10-14T07:00:00.000Z');
 expect(target_time({...promise(),text:'Global reset by tomorrow’s end of day PST.'})).toBe('2026-10-14T08:00:00.000Z');
 expect(target_time({...promise(),text:'Global reset by EOD.'})).toBeNull();
 expect(target_time({...p,at:'2026-11-01T10:00:00Z',text:'Global reset by EOD PT.'})).toBe('2026-11-02T08:00:00.000Z');
 expect(target_time({...p,at:'2026-03-08T12:00:00Z',text:'Global reset by EOD PT.'})).toBe('2026-03-09T07:00:00.000Z');
});
test('a deadline alone has no probability floor; weak, partial, archived, unresolved and conditional evidence keeps baseline',()=>{
 const s=input(),base=judge({...s,posts:s.posts.slice(0,-1)});
 const later=judge({...s,posts:[...s.posts.slice(0,-1),{...promise(),text:'Global reset landing tomorrow 10pm PST.'}]});
 expect(later.forecast.p24).toBeLessThan(judge(s).forecast.p24);
 expect(later.forecast.p48).toBeGreaterThan(later.forecast.p24);
 for(const p of [{...promise(),text:'Day 8/ Reset'},{...promise(),text:'Global reset by EOD.'},
  {...promise(),text:'Either improvements or a global reset by EOD PST.'},
  {...promise(),text:'A banked reset card landing by EOD PST for all users.'},
  {...promise(),text:'Global reset only for some users by EOD PST.'},
  {...promise(),text:'Global reset will not land by EOD PST.'},
  {...promise(),truncated:true},{...promise(),contextMissing:true},{...promise(),provenance:'archive'}]){
   const r=judge({...s,posts:[...s.posts.slice(0,-1),p]});
   expect(r.forecast.promisePolicy.applied).toBe(false);expect(r.forecast.p24).toBe(base.forecast.p24);
 }
 const completed={...promise(),text:'Global reset has been processed. Enjoy today 10am PST.'};
 const r=judge({...s,posts:[...s.posts.slice(0,-1),completed]});
 expect(r.signals.lastGlobal).toMatchObject({id:completed.id,verified:true});expect(r.forecast.promisePrior).toBeUndefined();expect(r.forecast.p24).toBeLessThan(base.forecast.p24);
});
test('consumed commitments are inactive; overdue and sparse commitments cannot invent probabilities',()=>{
 const s=input();const expired=judge({...s,now:'2026-10-13T08:01:00Z'});expect(expired.forecast.promisePolicy.applied).toBe(false);
 const done={id:'done',at:'2026-10-13T02:00:00Z',global:true,banked:false};
 expect(judge({...s,events:[...s.events,done]}).forecast.promisePolicy.applied).toBe(false);
 const r=judge(s),expected=[r.forecast.p24,r.forecast.p48];apply_promise_policy(r.forecast,r.signals,s);
 expect([r.forecast.p24,r.forecast.p48]).toEqual(expected);
 const sparse=available_judgment({...s,events:[]});expect(sparse.forecast.available).toBe(true);expect(sparse.forecast.p24).toBeGreaterThan(0);
});
test('a later official cancellation withdraws the promise and is cited; archive chatter cannot cancel it',()=>{
 const s=input(),cancel=post(25,'Global reset by EOD PST is cancelled.',{id:'2109812360596865225',at:'2026-10-13T02:00:00Z'});
 const r=judge({...s,posts:[...s.posts,cancel]});expect(r.signals.promise.withdrawn).toBe(true);
 expect(r.forecast.promisePolicy.applied).toBe(false);expect(render_report(r)).toContain('撤回或推迟');
 expect(render_report(r)).toContain(cancel.id);
 expect(judge({...s,posts:[...s.posts,{...cancel,provenance:'archive'}]}).signals.promise.withdrawn).not.toBe(true);
});
