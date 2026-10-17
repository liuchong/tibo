import {test,expect} from 'bun:test';
import {parse_primary,merge_posts} from '../../dist/src/evidence/sources.mjs';
import {post_context} from '../../dist/src/evidence/post-context.mjs';
import {local_row} from '../../dist/src/evidence/post-features.mjs';
import {judge} from '../../dist/src/app/engine.mjs';
import {public_forecast} from '../../dist/src/presentation/business.mjs';
import {snapshot} from '../helpers/fixture.mjs';
const at='2026-10-15T04:00:00Z',now='2026-10-15T04:20:00Z';
const id=(time,n=0)=>String((BigInt(Date.parse(time)-1288834974657)<<22n)+BigInt(n));
const parentId=id(at),childId=id('2026-10-15T04:01:00Z'),planId=id('2026-10-04T00:00:00Z');
const article=(id,text)=>`<article><a href="/thsottiaux">Tibo</a><a href="/thsottiaux/status/${id}">time</a><div data-testid="tweetText">${text}</div></article>`;
const parent='Day 10/ Reset',child='Landing within the next 2 hours';
const record=(extra='')=>`<script>($R=>$R[1]={__typename:"Tweet",core:$R[2]={user_results:{result:{core:{screen_name:"thsottiaux"}}}},details:{full_text:${JSON.stringify(child)}},reply_to_results:{rest_id:"${parentId}"},reply_to_user_results:{result:{core:{screen_name:"thsottiaux"}}},rest_id:"${childId}"${extra}})($R["tsr"]);globalThis.mustNotExecute=true;</script>`;
const html=article(parentId,parent)+article(childId,child)+record();
const plan={id:planId,at:'2026-10-04T00:00:00Z',author:'thsottiaux',provenance:'primary',text:'Over the next 28 days, each day we will either ship a clear improvement or ship a full reset.',truncated:false};
const input=(posts=parse_primary(html,now))=>snapshot({now,posts:[...snapshot().posts,plan,...posts]});

test('official typed reply metadata survives immutable body reuse, and no page code executes',()=>{
 globalThis.mustNotExecute=false;const posts=parse_primary(html,now);const c=posts.find(p=>p.id===childId);
 expect(c).toMatchObject({parentId,parentRelationProvenance:'official-page-data'});expect(globalThis.mustNotExecute).toBe(false);
 const old={...c,cachedAt:'2026-10-15T04:02:00Z'};delete old.parentId;delete old.parentRelationProvenance;
 expect(merge_posts([old],[c])[0]).toMatchObject({parentId,cachedAt:old.cachedAt});
 for(const bad of [record().replace('screen_name:"thsottiaux"','screen_name:"other"'),record().replace(JSON.stringify(child),'"a different text"'),record(',execute:()=>{globalThis.mustNotExecute=true}')]){
  expect(parse_primary(article(childId,child)+bad,now)[0].parentId).toBeUndefined();
 }expect(globalThis.mustNotExecute).toBe(false);
});

test('verified ellipsis inherits its reset episode and numeric relative deadline, including no-AI features',()=>{
 const s=input(),r=judge(s);expect(r.signals.promise).toMatchObject({postId:childId,parentId,kind:'global',targetAt:'2026-10-15T06:01:00.000Z',timePrecision:'deadline',scopeBasis:'declared-full-reset-programme'});
 expect(r.forecast).toMatchObject({available:true,mode:'dimensional-delivery'});
 const selected=post_context(s.posts,now,r.signals.lastGlobal).posts.find(p=>p.id===childId);
 expect(local_row(selected).claims[0]).toMatchObject({kind:'promise',scope:'global',statement:'future',timing:{stance:'commitment',amount:2,window:'within-hours'}});
 const text=public_forecast(r);expect(text).toMatch(/24h：[0-9]+%/);expect(text).toContain(child);expect(text).toContain(parent);expect(r.forecast.p24).toBeGreaterThan(70);
});

test('adjacent posts, absent parents, foreign authors, conditional or banked parents never create a global commitment',()=>{
 const rows=parse_primary(html,now);
 for(const variant of [rows.map(p=>p.id===childId?{...p,parentId:undefined,parentRelationProvenance:undefined}:p),rows.filter(p=>p.id!==parentId),
  rows.map(p=>p.id===parentId?{...p,text:'If a feature is delayed, reset instead.'}:p),
  rows.map(p=>p.id===parentId?{...p,text:'A banked reset card will be added.'}:p)]){
  expect(judge(input(variant)).signals.promise?.postId).not.toBe(childId);
 }
});

test('missed deadline becomes pending confirmation, and a new completion consumes the promise',()=>{
 const s=input();const overdue=judge({...s,now:'2026-10-15T07:00:00Z'});expect(public_forecast(overdue)).toContain('预告时间已过');expect(overdue.forecast.p24).toBeLessThan(judge(s).forecast.p24);
 const doneId=id('2026-10-15T04:10:00Z');s.posts.push({id:doneId,at:'2026-10-15T04:10:00Z',author:'thsottiaux',provenance:'primary',text:'Global reset has been processed.'});s.events.push({id:doneId,at:'2026-10-15T04:10:00Z',global:true,banked:false});
 const done=judge(s);expect(done.signals.promise.fulfilled).toBe(true);expect(done.forecast.announcement).toBeUndefined();
});
