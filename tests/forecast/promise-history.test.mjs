import {test,expect} from 'bun:test';
import {promise_history,estimate_promise,wilson} from '../../dist/src/forecast/promise-history.mjs';
import {judge,available_judgment} from '../../dist/src/app/engine.mjs';
const hour=3600000,day=24*hour,epoch=Date.parse('2026-01-01T00:00:00Z');
const iso=t=>new Date(t).toISOString();
function cohort(outcomes){
 const posts=[],events=[];
 const global=(id,t)=>{events.push({id,at:iso(t),global:true,banked:false,observed:false});posts.push({id,at:iso(t),author:'thsottiaux',provenance:'primary',text:'Global reset has been processed. All propagated.'});};
 global('origin',epoch-day);
 for(let i=0;i<outcomes.length;i++){
  const at=epoch+i*7*day+hour,target=epoch+i*7*day+8*hour;
  posts.push({id:`promise-${i}`,at:iso(at),author:'thsottiaux',provenance:'primary',text:'Global reset landing by EOD PST time. Enjoy'});
  global(`done-${i}`,target+outcomes[i]*hour);
 }
 global('current-origin',epoch+outcomes.length*7*day-day);
 const at=epoch+outcomes.length*7*day+hour,target=epoch+outcomes.length*7*day+8*hour;
 posts.push({id:'current',at:iso(at),author:'thsottiaux',provenance:'primary',text:'Global reset landing by EOD PST time. Enjoy'});
 const now=iso(target-3*hour);
 return {schemaVersion:1,now,events,posts,sources:[],unknowns:[],coverage:{audited:true,eventsComplete:true,postsComplete:true,from:iso(epoch-day),through:now}};
}
test('audited comparable outcomes produce different estimates, not one fixed promise percentage',()=>{
 const high=judge(cohort([...Array(20).fill(0),25,25,70,70]));
 const low=judge(cohort([...Array(6).fill(0),...Array(6).fill(25),...Array(12).fill(70)]));
 expect(high.forecast.promisePolicy).toMatchObject({applied:true,n:24,h24:{successes:20},h48:{successes:22}});
 expect(low.forecast.promisePolicy).toMatchObject({applied:true,n:24,h24:{successes:6},h48:{successes:12}});
 expect(high.forecast.p24).toBe(Math.round(wilson(20,24).estimate));
 expect(low.forecast.p24).toBe(Math.round(wilson(6,24).estimate));
 expect(high.forecast.p24).toBeGreaterThan(low.forecast.p24);
 expect(high.forecast.p48).toBeGreaterThanOrEqual(high.forecast.p24);
 expect(high.forecast.promisePolicy.calibrated).toBe(false);
});
test('small or imprecise cohorts use explicit smoothing while retaining the original baseline diagnostics',()=>{
 for(const s of [cohort([0]),cohort(Array(11).fill(0)),cohort([...Array(6).fill(0),...Array(6).fill(70)])]){
  const r=available_judgment(s),base=available_judgment({...s,posts:s.posts.filter(p=>p.id!=='current')});
  expect(r.forecast.promisePolicy.applied).toBe(false);
  expect(r.forecast.base24).toBe(base.forecast.base24);
  expect(r.forecast.p24).toBeGreaterThan(0);expect(r.forecast.available).toBe(true);expect(r.forecast.dimensions.applied).toBe(true);
  expect(r.forecast.promisePrior.supersededBy).toBe('dimensional-delivery-1');
  expect(r.forecast.announcement.postId).toBe('current');
 }
 expect(judge(cohort(Array(12).fill(0))).forecast.p24).toBeLessThan(100);
 expect(judge(cohort([...Array(6).fill(0),...Array(6).fill(70)])).forecast.promisePolicy.reason).toBe('wide-confidence-interval');
});
test('missing coverage, archive evidence, ambiguous events and malformed coverage cannot create failures or a selected success-only estimate',()=>{
 for(const change of [s=>{delete s.coverage},s=>{s.coverage.postsComplete=false},s=>{s.coverage.from='invalid'},
  s=>{s.posts.find(p=>p.id==='promise-3').provenance='archive'},
  s=>{s.posts=s.posts.filter(p=>p.id!=='done-3')},
  s=>{s.coverage.from=s.posts.find(p=>p.id==='promise-1').at}]){
  const s=cohort(Array(24).fill(0));change(s);const r=judge(s);
  expect(r.forecast.promisePolicy.applied).toBe(false);
  expect(r.forecast.promisePolicy.unknown).toBeGreaterThan(0);
 }
 const s=cohort([3]);delete s.coverage;
 expect(promise_history(s).rows[0]).toMatchObject({onTime:null,state:'completion-after-deadline-observed'});
});
test('audited noncompletion is distinct from unknown; late delivery is not on-time delivery',()=>{
 const rows=promise_history(cohort([0,3,70])).rows;
 expect(rows[0]).toMatchObject({onTime:1,state:'on-time'});
 expect(rows[1]).toMatchObject({onTime:0,state:'completion-after-deadline-observed'});
 expect(rows[2]).toMatchObject({onTime:0,state:'no-completion-in-audited-window'});
 expect(rows[2].completionAt).toBeFalsy();
 expect(rows.at(-1)).toMatchObject({onTime:null,state:'pending'});
});
test('duplicates or revised promises in one cycle count once and retain the original deadline',()=>{
 const s=cohort(Array(24).fill(25)),original=s.posts.find(p=>p.id==='promise-3');
 s.posts.push({...original,id:'revision',at:iso(Date.parse(original.at)+hour),text:'Global reset landing tomorrow 10am PST for all accounts.'});
 const h=promise_history(s);expect(h.duplicates).toBe(1);expect(h.rows).toHaveLength(25);
 expect(h.rows[3]).toMatchObject({postId:original.id,revisionCount:2,targetAt:iso(epoch+3*7*day+8*hour)});
 expect(judge(s).forecast.promisePolicy.n).toBe(24);
 const current=s.posts.find(p=>p.id==='current');s.posts.push({...current,id:'current-revision',at:iso(Date.parse(current.at)+hour)});
 expect(judge(s).forecast.promisePolicy.reason).toBe('revised-or-unmatched-promise');
});
test('elapsed waiting conditions out already completed cases and never uses future or immature outcomes',()=>{
 const s=cohort([...Array(12).fill(0),...Array(12).fill(25)]);
 s.now=iso(Date.parse(s.now)+7*hour);s.coverage.through=s.now;
 const r=judge(s);expect(r.forecast.promisePolicy).toMatchObject({alreadyCompleted:12,n:12,h24:{successes:12},h48:{successes:12}});
 const current=s.posts.find(p=>p.id==='current');
 s.posts.push({...current,id:'future-promise',at:iso(Date.parse(s.now)+hour)});
 s.events.push({id:'future-done',at:iso(Date.parse(s.now)+hour),global:true,banked:false,observed:false});
 expect(promise_history(s).rows.some(p=>p.postId==='future-promise')).toBe(false);
 expect(judge(s).forecast.promisePolicy.n).toBe(12);
 const pending=cohort([0]),r2=available_judgment(pending),h=promise_history(pending),old=h.rows[0];
 // A recent comparison window has not matured yet, so it is not a failure.
 old.at=iso(Date.parse(pending.now)-24*hour);old.targetAt=iso(Date.parse(pending.now)-17*hour);old.followingGlobals=[];
 const estimate=estimate_promise(pending,r2.signals,h);
 expect(estimate).toMatchObject({n:0,pending:1,comparable:1});
});
test('instant deadlines, different lead horizons, banked and routine refresh evidence are not pooled into a deadline cohort',()=>{
 const s=cohort(Array(24).fill(0));
 s.posts.find(p=>p.id==='promise-0').text='Global reset landing today 10am PST for all accounts.';
 const r=judge(s);expect(r.forecast.promisePolicy.n).toBe(23);
 const current=s.posts.find(p=>p.id==='current');
 for(const text of ['A banked reset card landing by EOD PST for all accounts.','Weekly automatic refresh by EOD PST.','Either improvements or a global reset by EOD PST.']){
  expect(judge({...s,posts:s.posts.map(p=>p.id===current.id?{...p,text}:p)}).forecast.promisePolicy.applied).toBe(false);
 }
});
