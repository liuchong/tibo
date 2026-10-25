import {test,expect} from 'bun:test';
import {spawnSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {judge} from '../../dist/src/app/engine.mjs';
import {dimension_input,native_assessment,dimension_names} from '../../dist/src/evidence/dimensions.mjs';
import {apply_dimensions} from '../../dist/src/forecast/dimensions.mjs';
import {calendar_vector} from '../../dist/src/forecast/calendar.mjs';
import {parse_primary,merge_documents} from '../../dist/src/evidence/sources.mjs';
import {validate_assessment} from '../../dist/src/ai/dimensions.mjs';
import {snapshot} from '../helpers/fixture.mjs';
const make=(id,at,text,extra={})=>({id,at,text,author:'thsottiaux',provenance:'primary',truncated:false,...extra});
const plan=make('2106845241357824205','2026-10-04T20:33:00Z','Over the next 28 days, each day we will either ship a clear improvement or ship a full reset.');
const title=make('2111492673890824348','2026-10-17T16:20:57.749Z','Day 13/ Le limit reset');
const landing=make('2111492738025959922','2026-10-17T16:21:13.040Z','Landing sometime today by EOD PST',{parentId:title.id,parentRelationProvenance:'official-page-data'});
function input(extra=[]){return snapshot({now:'2026-10-17T17:53:00Z',posts:[...snapshot().posts,plan,title,...extra]});}
function scoreResponse(data){return {dimensions:data.windows.map(w=>{
 const p=data.posts.find(p=>w.ids.includes(p.id)&&p.id===data.promise?.postId);
 return {name:w.name,support:p?1:0,opposition:0,commitment:p?1:0,imminence:p?1:0,citations:p?[{postId:p.id,quote:p.text.slice(0,150)}]:[]};
}),rows:[]};}
test('all required windows have independent anchors, strict reset boundaries, sorted deduplicated bodies and numeric records',()=>{
 const s=input();s.now='2026-10-18T17:53:00Z';
 const boundary=make('boundary','2026-09-24T00:00:00Z','Reset all propagated.');
 s.posts.push(boundary,make('before','2026-09-23T23:59:59Z','Historical reset soon'),
  make('after','2026-09-24T00:00:01Z','Update'),title,
  make('future','2026-10-19T00:00:00Z','Global reset landing today 10am PST.'));
 s.posts.reverse();s.events.reverse();
 const r=judge(s),d=dimension_input(r),by=Object.fromEntries(d.windows.map(w=>[w.name,w]));
 expect(d.windows.map(w=>w.name)).toEqual(dimension_names);
 expect(d.posts.filter(p=>p.id===title.id)).toHaveLength(1);
 expect(d.posts.some(p=>p.id==='future')).toBe(false);
 expect(by.before_last_reset.ids).toContain('before');expect(by.before_last_reset.ids).not.toContain('boundary');
 expect(by.after_last_reset.ids).toContain('after');expect(by.after_last_reset.ids).not.toContain('boundary');
 expect(by.last_24h.ids).not.toContain(title.id);expect(by.latest_anchored_24h.ids).toContain(title.id);
 expect(by.latest_three.ids).toHaveLength(3);
 expect(r.forecast.temporal.events.map(e=>e.at)).toEqual([...r.forecast.temporal.events.map(e=>e.at)].sort());
 expect(r.forecast.temporal.events.at(-1)).toMatchObject({intervalHours:144,utc:{weekday:4,dayOfMonth:24,monthPhase:2}});
 expect(r.forecast.temporal.segments).toHaveLength(8);
 expect(r.forecast.dimensions.dimensions).toHaveLength(7);
 const audited=dimension_input(judge({...s,coverage:{audited:true,postsComplete:true,
  from:new Date(Date.parse(s.now)-49*3600000).toISOString(),through:s.now}}));
 expect(audited.windows.find(w=>w.name==='last_48h').coverage).toBe('audited');
 expect(audited.windows.find(w=>w.name==='before_last_reset').coverage).toBe('unknown');
 expect(audited.temporal).not.toHaveProperty('baselineCurve');
});
test('a programme day selects delivery without inventing completion or a precise author deadline; linked timing takes priority',()=>{
 const day=judge(input()),timed=judge(input([landing]));
 expect(day.signals.promise).toMatchObject({postId:title.id,timePrecision:'programme-day',programmeDay:13,fulfilled:false});
 expect(day.signals.lastGlobal.id).not.toBe(title.id);expect(day.forecast.p24).toBeGreaterThan(90);
 expect(timed.signals.promise).toMatchObject({postId:landing.id,targetAt:'2026-10-18T08:00:00.000Z',timePrecision:'deadline'});
 expect(timed.forecast.p24).toBeGreaterThan(90);
 const historical=timed.forecast.promiseHistory.rows.find(p=>p.postId===landing.id);
 expect(historical).toMatchObject({revisionCount:1,programmeDecisionPostId:title.id,
  programmeDecisionAt:title.at,timePrecision:'deadline',targetAt:'2026-10-18T08:00:00.000Z'});
 const dayHistory=day.forecast.promiseHistory.rows.find(p=>p.postId===title.id);
 expect(dayHistory.timePrecision).toBe('programme-day');
 const revised=judge(input([landing,make('revision','2026-10-17T16:40:00Z','Global reset landing within the next 4 hours.')]));
 expect(revised.forecast.promiseHistory.rows.find(p=>p.postId===landing.id)).toMatchObject({revisionCount:2,targetAt:historical.targetAt});
 const later=judge({...input([landing]),now:'2026-10-18T18:00:00Z'});
 expect(later.forecast.p24).toBeLessThan(timed.forecast.p24);
 const old=make('long-lead','2026-10-14T17:00:00Z','Global reset landing within the next 5 days.');
 const retained=judge({...input(),posts:[...snapshot().posts,old]});
 expect(retained.signals.promise.postId).toBe(old.id);
 expect(retained.forecast.p48).toBeGreaterThan(retained.forecast.p24);
 for(const text of ['Day 13/ Maybe a reset','Day 13/ No reset','Day 13/ Banked reset card','Day 13/ Reset for some users','Day 13/ Reset?','Day 13/ Tomorrow reset']){
  const r=judge({...input(),posts:[plan,{...title,text}]});expect(r.forecast.dimensions.applied).toBe(false);
 }
 expect(judge({...input(),posts:[title]}).signals.promise).toBeNull();
 const day17=make('2113162277688070445','2026-10-22T06:55:22.314Z','Day 17/ Bet you thought we forgot, but no, it’s reset day today. Also good time to remind you to get Daybreak Blue access, it only takes 15 mins and you don’t want to have to do it in the middle of an incident.');
 const lands=make('2113162413008884099','2026-10-22T06:55:54.577Z','Lands tomorrow before 10am PST.',{parentId:day17.id,parentRelationProvenance:'official-page-data'});
 const day17Only=judge({...input(),now:'2026-10-22T06:59:00Z',posts:[...snapshot().posts,plan,day17]});
 expect(day17Only.signals.promise).toMatchObject({postId:day17.id,timePrecision:'programme-day',programmeDay:17,fulfilled:false});
 expect(day17Only.forecast.p24).toBeGreaterThanOrEqual(90);
 const day17Timed=judge({...input(),now:'2026-10-22T06:59:00Z',posts:[...snapshot().posts,plan,day17,lands]});
 expect(day17Timed.signals.promise).toMatchObject({postId:lands.id,parentId:day17.id,targetAt:'2026-10-22T18:00:00.000Z',timePrecision:'deadline',fulfilled:false});
 expect(day17Timed.forecast.p24).toBeGreaterThan(85);
});
test('a completion consumes all earlier boosts despite shuffled posts and malicious stale AI scores; a later new promise remains possible',()=>{
 const s=input([landing]),before=judge(s);
 const done=make('done','2026-10-17T17:00:00Z','Global reset has been processed. Enjoy!');
 const after=judge({...s,posts:[landing,done,plan,title,...snapshot().posts]});
 expect(after.signals.lastGlobal.id).toBe('done');expect(after.cycle.justReset).toBe(true);
 expect(after.signals.promise.fulfilled).toBe(true);
 expect(after.forecast.p24).toBeLessThan(before.forecast.p24);
 const d=dimension_input(after),a=native_assessment(d);
 for(const score of a.dimensions){score.support=score.commitment=score.imminence=1;score.citations=[{postId:landing.id,quote:landing.text}];}
 apply_dimensions(after,d,a);expect(after.forecast.dimensions.applied).toBe(false);
 expect(after.forecast.p24).toBe(Math.round(after.forecast.base24));
 const newPromise=make('next','2026-10-17T17:20:00Z','Global reset landing within the next 2 hours.');
 const next=judge({...s,posts:[newPromise,done,...s.posts]});
 expect(next.signals.promise.postId).toBe('next');expect(next.forecast.p24).toBeGreaterThan(90);
});
test('same native baseline survives semantic scores, overlap is normalised and row/window references are checked',()=>{
 const r=judge(input([landing])),d=dimension_input(r),a=scoreResponse(d);
 const original=[r.forecast.base24,r.forecast.base48];
 const valid=validate_assessment(a,d);apply_dimensions(r,d,valid);
 expect([r.forecast.base24,r.forecast.base48]).toEqual(original);
 expect(r.forecast.dimensions.dimensions.reduce((n,d)=>n+d.normalisedWeight,0)).toBeCloseTo(1);
 const first=r.forecast.p24;apply_dimensions(r,d,valid);expect(r.forecast.p24).toBe(first);
 expect(r.forecast.dimensions.prior.learned).toBe(false);
 const bad=structuredClone(a);bad.dimensions[0].support=1;bad.dimensions[0].citations=[{postId:landing.id,quote:landing.text}];
 expect(()=>validate_assessment(bad,d)).toThrow();
 const missing=structuredClone(a);missing.dimensions.pop();expect(()=>validate_assessment(missing,d)).toThrow();
 const nan=structuredClone(a);nan.dimensions[1].support=NaN;expect(()=>validate_assessment(nan,d)).toThrow();
 const extraPosts=Array.from({length:13},(_,i)=>make('extra-'+i,'2026-10-16T00:00:00Z','Public update'));
 const large=dimension_input(judge({...input([landing]),posts:[...input([landing]).posts,...extraPosts]}));
 const extraRows=scoreResponse(large);extraRows.rows=extraPosts.map(p=>({postId:p.id,claims:[]}));
 expect(validate_assessment(extraRows,large).rows).toHaveLength(13);
 expect(calendar_vector('2026-10-01T01:00:00Z','America/Los_Angeles')).toMatchObject({dayOfMonth:30,monthPhase:2,weekday:3});
});
test('official Result.Ok JSON preserves reply metadata; code and unrelated authors are never used',()=>{
 const article=p=>'<article><a href="/thsottiaux">Tibo</a><a href="/thsottiaux/status/'+p.id+'">time</a><div data-testid="tweetText">'+p.text+'</div></article>';
 const row={__typename:'Tweet',rest_id:landing.id,core:{user_results:{result:{core:{screen_name:'thsottiaux'}}}},
  details:{full_text:landing.text},reply_to_results:{rest_id:title.id},reply_to_user_results:{result:{core:{screen_name:'thsottiaux'}}},flag:true};
 const page=()=>article(title)+article(landing)+'<script>($R=>$R[1]={kind:"Result.Ok",value:'+JSON.stringify(JSON.stringify({data:{items:[{result:row}]}}))+'})($R["tsr"]);throw Error("must not execute");</script>';
 expect(parse_primary(page(),input().now).find(p=>p.id===landing.id).parentId).toBe(title.id);
 row.reply_to_user_results.result.core.screen_name='other';
 expect(parse_primary(page(),input().now).find(p=>p.id===landing.id).parentId).toBeUndefined();
});
test('public document versions persist through repeated collection without losing original dates or old versions',()=>{
 const doc={id:'incident-1',url:'https://status.openai.com/incidents/fixture',at:'2026-10-17T00:00:00Z',status:'identified',text:'Codex errors'};
 const a=merge_documents([],[doc],'2026-10-17T01:00:00Z');
 const b=merge_documents(a,[doc,{...doc,at:'2026-10-17T02:00:00Z',status:'resolved'}],'2026-10-17T03:00:00Z');
 expect(b).toHaveLength(2);expect(b[0]).toMatchObject({firstSeenAt:'2026-10-17T01:00:00Z',lastSeenAt:'2026-10-17T03:00:00Z',at:doc.at});
 expect(merge_documents(b,[],'2026-10-18T00:00:00Z')).toEqual(b);
});
test('one main request plus a shared semantic verification returns all dimensions even above old 24k input; failed/disabled AI retains the exact same temporal model',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'tibo-dimensions-'));
 try{
 const s=input([landing]);for(let i=0;i<60;i++)s.posts.push(make('context-'+i,'2026-10-16T10:00:00Z','Public context '.repeat(45)));
 const code='let calls=0;globalThis.fetch=async(u,o)=>{calls++;const b=JSON.parse(o.body),d=JSON.parse(b.messages.at(-1).content);const dimensions=d.windows.map(w=>{const p=d.posts.find(p=>w.ids.includes(p.id)&&p.id===d.promise?.postId);return {name:w.name,support:p?1:0,opposition:0,commitment:p?1:0,imminence:p?1:0,citations:p?[{postId:p.id,quote:p.text.slice(0,150)}]:[]}});return new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{content:JSON.stringify({dimensions,rows:[]})}}]}))};'
  +'const {judge}=await import('+JSON.stringify(resolve('dist/src/app/engine.mjs'))+');const {enhance}=await import('+JSON.stringify(resolve('dist/src/ai/enhance.mjs'))+');const s='+JSON.stringify(s)+';'
  +'const a=await enhance(judge(s));const cached=await enhance(judge(s));process.env.DEEPSEEK_API_KEY="";const no=await enhance(judge(s));'
  +'console.log(JSON.stringify({calls,state:a.ai.features.signals.state,cached:cached.ai.features.signals.state,a:a.forecast.temporal,no:no.forecast.temporal,score:a.forecast.dimensions,posts:a.ai.postIds.length,noScore:no.forecast.dimensions,p:a.forecast.p24,np:no.forecast.p24}));';
 const run=spawnSync(process.execPath,['--eval',code],{encoding:'utf8',timeout:10000,env:{...process.env,TIBO_STATE_DIR:dir,DEEPSEEK_API_KEY:'fixture',TIBO_AI_FEATURES:'signals'}});
 expect(run.stderr).toBe('');expect(run.status).toBe(0);const r=JSON.parse(run.stdout);
 expect(r.calls).toBe(2);expect(r.state).toBe('ok');expect(r.cached).toBe('cached');expect(r.posts).toBe(s.posts.length);
 expect(r.a).toEqual(r.no);expect(r.score.dimensions).toHaveLength(7);expect(r.noScore.dimensions).toHaveLength(7);
 expect(r.p).toBeGreaterThan(90);expect(r.np).toBeGreaterThan(90);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('provider failure has bounded recovery and retains the temporal model',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'tibo-dimensions-failed-'));
 try{
  const code='let calls=0;globalThis.fetch=async()=>{calls++;return new Response("private upstream error",{status:503})};'
   +'const {judge}=await import('+JSON.stringify(resolve('dist/src/app/engine.mjs'))+');'
   +'const {enhance}=await import('+JSON.stringify(resolve('dist/src/ai/enhance.mjs'))+');'
   +'const s='+JSON.stringify(input([landing]))+';const n=judge(s),r=await enhance(judge(s));'
   +'console.log(JSON.stringify({calls,state:r.ai.features.signals.state,n:n.forecast,r:r.forecast}));';
  const run=spawnSync(process.execPath,['--eval',code],{encoding:'utf8',timeout:6000,
   env:{...process.env,TIBO_STATE_DIR:dir,DEEPSEEK_API_KEY:'fixture',TIBO_AI_FEATURES:'signals'}});
  expect(run.stderr).toBe('');expect(run.status).toBe(0);const v=JSON.parse(run.stdout);
  expect(v.calls).toBe(3);expect(v.state).toBe('fallback');expect(v.r.temporal).toEqual(v.n.temporal);
  expect(v.r.p24).toBe(v.n.p24);expect(v.r.p48).toBe(v.n.p48);expect(v.r.dimensions.dimensions).toHaveLength(7);
  expect(run.stdout).not.toContain('private upstream error');
 }finally{await rm(dir,{recursive:true,force:true});}
});
