import {test,expect} from 'bun:test';
import {active_programme,post_context} from '../../dist/src/evidence/post-context.mjs';
import {judge} from '../../dist/src/app/engine.mjs';
import {evidence,task_input,validate_forecast,validate_signals} from '../../dist/src/ai/enhance.mjs';
import {public_forecast} from '../../dist/src/presentation/business.mjs';
import {validate_research} from '../../dist/src/evidence/research.mjs';
import {snapshot,post} from '../helpers/fixture.mjs';

const plan=post(25,'Over the next 28 days, each day we’ll either ship one thing that is a clear improvement or ship a full reset.',{id:'programme',at:'2026-09-25T01:00:00Z'});
const day1=post(26,'Day 1/ We optimized the default speed.',{id:'day1'});
const day2=post(27,'Roundup of Day 2/ Four product updates.',{id:'roundup'});
const intent=post(27,'I do like giving resets',{id:'intent',at:'2026-09-27T01:00:00Z'});
const both=post(27,'Four updates or a reset. Or both. How was day 2.',{id:'both',at:'2026-09-27T02:00:00Z'});
const casual=Array.from({length:15},(_,i)=>post(27,`Ordinary conversation ${i}`,{id:`casual-${i}`,at:new Date(Date.UTC(2026,8,27,3,i)).toISOString()}));
const now='2026-09-28T00:00:00Z';
const posts=[plan,day1,day2,intent,both,...casual];
const input=()=>snapshot({now,posts:[...snapshot().posts,...posts]});

test('declared multi-day programme survives 48h, groups release fragments by day, and expires exactly at its declared end',()=>{
 const fragments=[post(27,'Day 2.1/ Auto-review.',{id:'part1'}),post(27,'Day 2.4/ API live.',{id:'part4',at:'2026-09-27T01:30:00Z'})];
 const p=active_programme([...posts,...fragments],now);
 expect(p).toMatchObject({postId:'programme',days:28,expiresAt:'2026-10-23T01:00:00.000Z',observedDays:[1,2],progressPostIds:['day1','roundup'],consumedByGlobal:false});
 expect(active_programme(posts,p.expiresAt)).toBeNull();
 expect(active_programme([plan], '2026-09-25T00:59:59Z')).toBeNull();
 expect(active_programme([post(25,'No plan here.',{quoteText:plan.text})],now)).toBeNull();
 expect(active_programme([{...plan,text:plan.text.replace('28','99')}],now)).toBeNull();
});

test('bounded selection retains the programme, reset intent, day roundups and latest post despite many casual posts; order of input cannot change it',()=>{
 const one=post_context(posts,now),two=post_context([...posts].reverse(),now);
 expect(one.posts).toHaveLength(8);expect(two.selection).toEqual(one.selection);
 for(const id of ['programme','intent','both','day1','roundup','casual-14'])expect(one.posts.some(p=>p.id===id)).toBe(true);
 expect(one.selection.find(p=>p.postId==='programme').reason).toBe('active-programme');
 expect(one.posts.filter(p=>p.id.startsWith('casual')).map(p=>p.id)).toEqual(['casual-12','casual-13','casual-14']);
 expect(one.recentCount).toBe(19);
 const future={...intent,id:'future',at:'2026-09-29T00:00:00Z'};
 expect(post_context([...posts,future],now).posts.some(p=>p.id==='future')).toBe(false);
});

test('programme and Or both are weak conditional signals, not timed promises; offline algorithm stays historical without inventing fixed boosts',()=>{
 const r=judge(input()),baseline=judge(snapshot({now}));
 expect(r.signals.promise).toBeNull();expect(r.signals.hints.find(h=>h.postId==='both').conditional).toBe(true);
 expect(r.signals.hints.some(h=>h.postId==='programme')).toBe(true);
 expect(r.forecast.signal).toBe('条件性重置计划');
 expect([r.forecast.p24,r.forecast.p48]).toEqual([baseline.forecast.p24,baseline.forecast.p48]);
 const i=evidence(r),task=task_input('forecast',{...i,signals:{items:[{postId:'intent',kind:'reset-hint',summary:'作者意向，不是承诺'}]}});
 expect(task.programme.observedDays).toEqual([1,2]);expect(task.signals[0].summary).toBe('作者意向，不是承诺');
 expect(i.posts.find(p=>p.id==='programme').text).toBe(plan.text);
 expect(validate_signals({items:[{postId:'intent',quote:intent.text,kind:'reset-hint',summary:'意向'}]},i).items[0].kind).toBe('reset-hint');
 expect(validate_forecast({p24:25,p48:40,reason:'期限内弱证据，未校准',citations:[{postId:'programme',quote:'or ship a full reset'}]},i).p24).toBe(25);
});

test('a later global consumes old programme evidence without erasing its calendar context or shifting the clock with a banked card',()=>{
 const completion=post(27,'Reset all propagated.',{id:'new-global',at:'2026-09-27T23:00:00Z'});
 const s=input();s.posts.push(completion);s.events.push({id:completion.id,at:completion.at,global:true,banked:false,observed:false});
 const r=judge(s);expect(r.signals.programme.consumedByGlobal).toBe(true);
 expect(r.signals.hints).toEqual([]);expect(r.signals.lastGlobal.at).toBe(completion.at);
 expect(()=>validate_forecast({p24:90,p48:95,reason:'不可重复',citations:[{postId:'programme',quote:'or ship a full reset'}]},evidence(r))).toThrow();
 const banked=input();banked.posts.push(post(27,'A banked reset card is available.',{id:'banked'}));banked.events.push({id:'banked',at:'2026-09-27T00:00:00Z',global:false,banked:true,observed:false});
 expect(judge(banked).signals.programme.consumedByGlobal).toBe(false);
});

test('AI relation cannot declare a whole multi-day programme fulfilled by one daily update',()=>{
 const i=evidence(judge(input()));
 const r=validate_research({facts:[],links:[{fromId:'roundup',fromQuote:day2.text,toId:'programme',toQuote:plan.text,relation:'fulfills'}]},i);
 expect(r.links[0].relation).toBe('clarifies');
 expect(validate_research(r,i)).toEqual(r);
});

test('public report keeps related programme and intent but omits casual posts and model diagnostics',()=>{
 const s=input();s.posts=s.posts.map((p,i)=>({...p,id:String(2106845241357824205n+BigInt(i)),url:undefined}));
 const r=judge(s);r.ai={baseline:{p24:r.forecast.p24,p48:r.forecast.p48},weight:.16,features:{brief:{state:'disabled'},forecast:{state:'ok',value:{p24:r.forecast.p24,p48:r.forecast.p48}}}};
 const text=public_forecast(r,'both');expect(text).toContain('每日');expect(text).toContain(intent.text);
 expect(text).not.toMatch(/实际融合权重|最终整数概率|Ordinary conversation|普通发布即完成/);
});
