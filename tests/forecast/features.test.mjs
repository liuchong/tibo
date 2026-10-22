import {test,expect} from 'bun:test';
import {validate_rows,local_row,feature_contract} from '../../dist/src/evidence/post-features.mjs';
import {feature_state,values_at} from '../../dist/src/forecast/features.mjs';
import {adjusted_risk,model_gate} from '../../dist/src/forecast/feature-model.mjs';
import {baseline_curve} from '../../dist/src/forecast/models.mjs';
import {settle_features} from '../../dist/src/forecast/feature-log.mjs';
import {judge} from '../../dist/src/app/engine.mjs';
import {snapshot,post} from '../helpers/fixture.mjs';
const claim=(quote,overrides={})=>({kind:'promise',subject:'codex-usage',scope:'global',statement:'future',quote,timeText:null,contextMissing:false,...overrides});
const parse=(p,c)=>validate_rows({rows:[{postId:p.id,claims:[c]}]},[p]).rows[0];
const native=(s)=>{const r=judge(s);return feature_state(r,{rows:s.posts.map(local_row),aiRows:0,ruleRows:s.posts.length})};
test('release and personal goals cannot become reset features; scope and context are checked beyond JSON',()=>{
 for(const p of [post(25,'Today we will ship new features for Plus and Pro.'),post(25,'Will get to inbox zero in 48 hours.')])
   expect(()=>parse(p,claim(p.text))).toThrow();
 const p=post(25,'I promised a reset for Tuesday.');
 expect(parse(p,claim(p.text)).claims[0].scope).toBe('unknown');
 const day17=post(25,'Day 17/ Bet you thought we forgot, but no, it’s reset day today. Also good time to remind you to get Daybreak Blue access, it only takes 15 mins and you don’t want to have to do it in the middle of an incident.',{id:'2113162277688070445'});
 expect(parse(day17,claim('Day 17/ Bet you thought we forgot, but no, it’s reset day today.',{timeText:'today',timing:{stance:'commitment',window:'today',amount:null,zone:'unknown'}})).claims[0]).toMatchObject({kind:'promise',scope:'global',statement:'future'});
 const semDone=post(25,"Day 15/ Nevermind, we're still cooking... and reset. Enjoy.",{id:'2112432076767289678'});
 expect(parse(semDone,claim(semDone.text,{kind:'completion',statement:'completed'})).claims[0]).toMatchObject({kind:'completion',scope:'global',statement:'completed'});
 const fixed=post(25,'All fixed.',{parentId:'missing'});
 expect(()=>parse(fixed,claim(fixed.text,{kind:'completion',statement:'completed'}))).toThrow();
 expect(()=>parse(p,claim('Invented quote'))).toThrow();
 expect(()=>parse(p,{...claim(p.text),p24:99})).toThrow();
});
test('one invalid post does not discard another valid post or promote it to global',()=>{
 const a=post(25,'I do like giving resets',{id:'hint'}),b=post(25,'Today we will ship changes.',{id:'release'});
 const r=validate_rows({rows:[{postId:a.id,claims:[claim(a.text,{kind:'hint',statement:'unknown'})]},{postId:b.id,claims:[claim(b.text)]}]},[a,b]);
 expect(r.rows.map(x=>x.postId)).toEqual(['hint']);expect(r.rejected).toEqual(['release']);expect(r.rows[0].claims[0].scope).toBe('unknown');
});
test('promise deadlines, banked consumption and persistent plans have separate state',()=>{
 const plan=post(25,'Over the next 28 days, each day we’ll either ship one improvement or ship a full reset.',{id:'plan'});
 const promise=post(25,'Global reset landing tomorrow 10am PST for all paid users.',{id:'promise',at:'2026-09-25T01:00:00Z'});
 const hint=post(25,'I do like giving resets',{id:'hint',at:'2026-09-25T02:00:00Z'});
 let s=snapshot({now:'2026-09-25T03:00:00Z',posts:[...snapshot().posts,plan,promise,hint]});
 let f=native(s);expect(f.values).toMatchObject({promise:1,hint:1,programme:1,incident:null});
 expect(f.claims.find(c=>c.postId==='promise').targetAt).toBe('2026-09-25T18:00:00.000Z');
 expect(values_at(f,'2026-09-25T19:00:00Z').promise).toBe(0);
 const completion=post(25,'Reset all propagated.',{id:'new-global',at:'2026-09-25T02:30:00Z'});
 s={...s,posts:[...s.posts,completion],events:[...s.events,{id:completion.id,at:completion.at,global:true,banked:false}]};f=native(s);
 expect(f.values.programme).toBe(1);expect(f.claims.find(c=>c.postId==='hint').status).toBe('consumed');
 const b=post(25,'A banked reset card is available.',{id:'banked',at:'2026-09-25T02:40:00Z'});
 s={...s,posts:[...s.posts,b],events:[...s.events,{id:b.id,at:b.at,global:false,banked:true,fulfilledPromiseId:'promise'}]};f=native(s);
 expect(f.claims.find(c=>c.postId==='promise').status).toBe('consumed');
 expect(f.values.hint).toBeNull();expect(judge(s).signals.lastGlobal.id).toBe('new-global');
});
test('EOD stays unresolved; missing coverage is unknown, even when discovery was successful',()=>{
 const s=snapshot({posts:[...snapshot().posts,post(25,'Global reset by EOD.')]});const f=native(s);
 const c=f.claims.find(c=>c.kind==='promise');expect(c.timePrecision).toBe('unresolved');expect(c.targetAt).toBeNull();
 expect(f.values.promise).toBe(1);expect(f.values.incident).toBeNull();expect(f.postsComplete).toBe(false);
 const full={...s,coverage:{audited:true,postsComplete:true,from:'2026-09-23T00:00:00Z',through:s.now}};
 expect(native(full).values.incident).toBe(0);
 const r=judge(full);expect(feature_state(r,{rows:[local_row(s.posts[0])],aiRows:0,ruleRows:1}).values.incident).toBeNull();
});
test('six-hour survival curve preserves existing baseline and monotonicity, including unknown-clock rate models',()=>{
 for(const s of [snapshot(),snapshot({posts:[]})]){const r=judge(s),f=native(s);
 const base=baseline_curve(r.forecast.model,r.history.intervals,r.history.elapsedMs,s.now);
 expect(Math.round(base[4])).toBe(r.forecast.p24);expect(Math.round(base[8])).toBe(r.forecast.p48);
 for(let i=1;i<base.length;i++)expect(base[i]).toBeGreaterThanOrEqual(base[i-1]);
 const v=adjusted_risk(base,f,null,s.now);expect(v).toMatchObject({applied:false,p24:r.forecast.p24,p48:r.forecast.p48});
 }
});
const artifact=()=>({id:'audited-fixture',contract:feature_contract,status:'validated',profile:'rules-1',sourceGrade:'primary',trainedThrough:'2026-08-01T00:00:00Z',coefficients:{promise:0},
 support:{auditedCoverage:true,cycles:30,completePositiveAndNegativeWindows:true,features:{promise:{presentCycles:10,absentCycles:20}}},
 validation:{from:'2026-08-04T00:00:00Z',through:'2026-09-01T00:00:00Z',cycles:10,wholeCycleSplit:true,episodeDisjoint:true,stableAcrossTime:true,clusterUncertaintyPassed:true,h24:{brierImprovement:.02,logLossImprovement:.02},h48:{brierImprovement:.02,logLossImprovement:.02}}});
test('sample, profile, temporal and missing-data gates precede risk adjustment; zero parameters reproduce baseline',()=>{
 const s=snapshot({posts:[...snapshot().posts,post(25,'Global reset landing tomorrow for all users.')]});const f=native(s),r=judge(s);
 const base=baseline_curve(r.forecast.model,r.history.intervals,r.history.elapsedMs,s.now);
 expect(model_gate(artifact(),f,s.now)).toBeNull();expect(adjusted_risk(base,f,artifact(),s.now)).toMatchObject({applied:true,p24:r.forecast.p24,p48:r.forecast.p48});
 for(const change of [m=>m.support.cycles=29,m=>m.support.cycles='unknown',m=>m.support.auditedCoverage='false',m=>m.support.auditedCoverage=false,m=>m.profile='mixed-1',m=>m.trainedThrough='2027-01-01T00:00:00Z',m=>m.validation.h48.brierImprovement=-.1,m=>m.validation.episodeDisjoint=false]){
  const m=artifact();change(m);expect(adjusted_risk(base,f,m,s.now).applied).toBe(false);
 }
 const m=artifact();m.coefficients.promise=.5;const p=adjusted_risk(base,f,m,s.now);expect(p.p24).toBeGreaterThan(r.forecast.p24);expect(p.p48).toBeGreaterThanOrEqual(p.p24);
 expect(adjusted_risk(base,{...f,values:{promise:null}},m,s.now).applied).toBe(false);
});
test('a verified positive does not manufacture negative training labels for uncovered windows',()=>{
 const row={at:'2026-09-25T00:00:00Z',features:{postsComplete:false}};
 const r={snapshot:{now:'2026-09-28T00:00:00Z'},events:[{global:true,verified:true,provenance:'primary',at:'2026-09-26T12:00:00Z'}]};
 const o=settle_features([row],r)[0].outcome;expect(o).toMatchObject({y24:null,y48:1,completeCoverage:false});
 expect(settle_features([row],{...r,events:[]})[0].outcome).toBeUndefined();
 const coverage={audited:true,eventsComplete:true,from:row.at,through:r.snapshot.now};
 expect(settle_features([row],{...r,snapshot:{...r.snapshot,coverage},events:[]})[0].outcome).toMatchObject({y24:0,y48:0,completeCoverage:true});
});
