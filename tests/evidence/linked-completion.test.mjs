import {test,expect} from 'bun:test';
import {parse_primary,merge_posts,events_from_posts} from '../../dist/src/evidence/sources.mjs';
import {post_context} from '../../dist/src/evidence/post-context.mjs';
import {local_row} from '../../dist/src/evidence/post-features.mjs';
import {feature_state,apply_structured_promise} from '../../dist/src/forecast/features.mjs';
import {public_post} from '../../dist/src/ai/post-features.mjs';
import {judge,reset_status} from '../../dist/src/app/engine.mjs';
import {public_forecast} from '../../dist/src/presentation/business.mjs';
import {confirmed_global_QMARK_} from '../../dist/src/subscriptions/alerts.mjs';
import {snapshot} from '../helpers/fixture.mjs';
const id=(at,n=0)=>String((BigInt(Date.parse(at)-1288834974657)<<22n)+BigInt(n));
const post=(at,text,extra={})=>({id:id(at),at,text,author:'thsottiaux',provenance:'primary',truncated:false,...extra});
const plan=post('2026-10-04T00:00:00Z','Over the next 28 days, each day we will either ship an improvement or ship a full reset.');
const root=post('2026-10-15T04:55:00Z','Day 10/ Reset');
const promise=post('2026-10-15T04:56:00Z','Landing within the next 2 hours',{parentId:root.id,parentRelationProvenance:'official-page-data'});
const done=post('2026-10-15T06:28:00Z','Done and dusted',{quotedPostId:promise.id,quotedRelationProvenance:'official-page-data'});
const input=(extra=[])=>snapshot({now:'2026-10-15T06:30:00Z',posts:[...snapshot().posts,plan,root,promise,...extra]});
const article=p=>`<article><a href="/thsottiaux">Tibo</a><a href="/thsottiaux/status/${p.id}">time</a><div data-testid="tweetText">${p.text}</div></article>`;
const data=(who='thsottiaux',body=done.text)=>`<script>$R[1]={__typename:"Tweet",core:{user_results:{result:{core:{screen_name:"thsottiaux"}}}},details:{full_text:${JSON.stringify(body)}},quoted_tweet_results:{rest_id:"${promise.id}",result:{rest_id:"${promise.id}",core:{user_results:{result:{core:{screen_name:"${who}"}}}}}},rest_id:"${done.id}"};globalThis.executed=true;</script>`;

test('typed quote relationships survive permanent original reuse without merging the quoted body or executing scripts',()=>{
 globalThis.executed=false;const rows=parse_primary(article(done)+data(),input().now),p=rows[0];
 expect(p).toMatchObject({text:done.text,quotedPostId:promise.id,quotedRelationProvenance:'official-page-data'});
 const old={...done,cachedAt:'2026-10-15T06:29:00Z'};delete old.quotedPostId;delete old.quotedRelationProvenance;
 expect(merge_posts([old],rows)[0]).toMatchObject({text:done.text,cachedAt:old.cachedAt,quotedPostId:promise.id});
 for(const bad of [data('someone_else'),data('thsottiaux','not the visible body')])expect(parse_primary(article(done)+bad,input().now)[0].quotedPostId).toBeUndefined();
 expect(globalThis.executed).toBe(false);
});

test('a completion quote of a verified timed self-reply resets the clock before prediction and consumes all earlier one-shot features',()=>{
 const before=judge(input()),s=input([done]),r=judge(s);
 expect(before.forecast.promisePrior.applied).toBe(true);expect(r.signals.lastGlobal).toMatchObject({id:done.id,verified:true,completionPostIds:[promise.id,root.id]});
 expect(r.cycle).toMatchObject({lastGlobalAt:done.at,justReset:true});expect(r.signals.promise.fulfilled).toBe(true);
 expect(r.forecast.promisePrior).toBeUndefined();expect(r.forecast.announcement).toBeUndefined();
 expect(r.forecast.p24).toBeLessThan(before.forecast.p24);expect(r.forecast.p48).toBeLessThan(before.forecast.p48);expect(r.forecast.p24).toBeGreaterThan(0);
 expect(reset_status(r).state).toBe('confirmed-announcement');expect(confirmed_global_QMARK_(r.signals.lastGlobal)).toBe(true);
 const rows=post_context(s.posts,s.now,r.signals.lastGlobal).posts.map(local_row),f=feature_state(r,{rows,aiRows:0,ruleRows:rows.length});
 expect(f.claims.filter(c=>c.postId===promise.id).every(c=>c.status==='consumed')).toBe(true);
 expect(f.claims.find(c=>c.postId===done.id)).toMatchObject({kind:'completion',scope:'global',statement:'completed',status:'completed'});
 const selected=post_context(s.posts,s.now,r.signals.lastGlobal).posts.find(p=>p.id===done.id);
 expect(local_row(public_post(selected)).claims[0]).toMatchObject({kind:'completion',scope:'global',statement:'completed'});
 const numbers=[r.forecast.p24,r.forecast.p48];apply_structured_promise(r,f);expect([r.forecast.p24,r.forecast.p48]).toEqual(numbers);expect(r.signals.promise.fulfilled).toBe(true);
 const report=public_forecast(r);expect(report).not.toContain('仍待完成公告');expect(report).not.toContain('限时承诺是本次');expect(report).toContain('之前的线索已兑现');
});

test('unrelated, unverified, negated, conditional, banked, partial and weekly references cannot manufacture a global completion',()=>{
 const badRoots=['Either a global reset or an improvement tomorrow.','A banked reset card is coming.','Global reset only for some users.','Automatic weekly reset tomorrow.','Global reset will not land tomorrow.'];
 const cases=[input([{...done,quotedPostId:undefined}]),input([{...done,quotedRelationProvenance:undefined}]),input([{...done,provenance:'archive'}]),input([{...done,truncated:true}]),input([{...done,text:'The maths proof is done.'}]),input([{...done,text:'Done and dusted. The reset is not complete.'}]),...badRoots.map(text=>input([done]).posts.map(p=>p.id===root.id?{...p,text}:p)).map(posts=>({...input(),posts}))];
 cases.push({...input([done]),posts:input([done]).posts.filter(p=>p.id!==promise.id)});
 for(const s of cases)expect(judge(s).signals.lastGlobal.id).not.toBe(done.id);
 const foreign=input([done]).posts.map(p=>p.id===promise.id?{...p,author:'other'}:p);
 expect(events_from_posts(foreign).some(e=>e.id===done.id)).toBe(false);expect(()=>judge({...input(),posts:foreign})).toThrow('帖子作者');
});

test('later reminders of the same fulfilled promise do not move the clock; a new post-reset promise remains eligible',()=>{
 const reminder=post('2026-10-15T06:29:00Z','All done',{quotedPostId:promise.id,quotedRelationProvenance:'official-page-data'});
 const r=judge(input([done,reminder]));expect(r.signals.lastGlobal.id).toBe(done.id);expect(events_from_posts(input([done,reminder]).posts).filter(e=>e.global&&[done.id,reminder.id].includes(e.id))).toHaveLength(1);
 const newer=post('2026-10-15T06:29:30Z','Global reset landing within the next 2 hours.'),n=judge(input([done,newer]));
 expect(n.signals.promise).toMatchObject({postId:newer.id,fulfilled:false});expect(n.forecast.promisePrior.applied).toBe(true);expect(n.forecast.p24).toBeGreaterThan(r.forecast.p24);
 const late=judge({...input([done]),now:'2026-11-10T00:00:00Z'});expect(late.signals.lastGlobal.id).toBe(done.id);
});
