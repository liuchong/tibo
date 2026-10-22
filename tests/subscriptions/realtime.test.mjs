import {test,expect} from 'bun:test';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {spawnSync} from 'node:child_process';
import {watch_tick} from '../../dist/src/app/realtime-monitor.mjs';
import {pending_alerts,forecast_alert,enqueue_alert} from '../../dist/src/subscriptions/alerts.mjs';
import {judge} from '../../dist/src/app/engine.mjs';import {events_from_posts} from '../../dist/src/evidence/sources.mjs';
import {snapshot,post} from '../helpers/fixture.mjs';
import {subscription_command,sync_group_subscriptions} from '../../dist/src/subscriptions/registry.mjs';
import {create_alert_delivery} from '../../dist/adapters/lark/alerts.mjs';import {account_key,delivery_key} from '../../dist/adapters/lark/service.mjs';
import {read_state} from '../../dist/src/platform/state.mjs';
async function isolated(fn){const dir=await mkdtemp(join(tmpdir(),'tibo-realtime-')),old=process.env.TIBO_STATE_DIR,native=Date.now;process.env.TIBO_STATE_DIR=dir;
 try{return await fn(dir);}finally{Date.now=native;if(old===undefined)delete process.env.TIBO_STATE_DIR;else process.env.TIBO_STATE_DIR=old;await rm(dir,{recursive:true,force:true});}}
test('new primary messages share one forecast, unchanged checks skip AI, promises and each completed reset have independent durable notices',()=>isolated(async()=>{
 let now=Date.parse('2026-09-25T01:00:00Z'),calls=0;Date.now=()=>now;
 const posts=[...snapshot().posts];let events=[...snapshot().events];const collect=async()=>snapshot({now:new Date(now).toISOString(),posts:[...posts],events:[...events]});
 const generate=async s=>{calls++;return {...judge(s),report:'**共有预测**\n• 24h：20%\n• 48h：35%'};};
 await watch_tick(900,collect,generate);expect(await pending_alerts()).toEqual([]);expect(calls).toBe(1);
 now+=300000;await Promise.all([watch_tick(900,collect,generate),watch_tick(900,collect,generate)]);expect(calls).toBe(1);
 posts.push(post(25,'Global reset landing by EOD PST time.',{id:'firm',at:new Date(now).toISOString()}));
 await watch_tick(900,collect,generate);expect(calls).toBe(2);expect((await pending_alerts()).map(x=>x.kind)).toEqual(['promise']);
 now+=300000;await watch_tick(900,collect,generate);expect(calls).toBe(2);
 for(const id of ['done-one','done-two']){now+=300000;const p=post(25,'Global reset has been processed.',{id,at:new Date(now).toISOString()});posts.push(p);events.push(...events_from_posts([p]));await watch_tick(900,collect,generate);}
 const alerts=await pending_alerts();expect(alerts.filter(a=>a.kind==='confirmed')).toHaveLength(2);
 for(const a of alerts.filter(a=>a.kind==='confirmed')){expect(a.text).toContain('已重置确认');expect(a.text).not.toContain('24h');expect(a.text).not.toContain('概率');}
 await watch_tick(900,collect,generate);expect((await pending_alerts()).filter(a=>a.kind==='confirmed')).toHaveLength(2);
 expect((await read_state('realtime-monitor')).nextCheckAt).toBe(new Date(now+300000).toISOString());
}));
test('archived, truncated, banked and automatic refreshes cannot generate completed-reset confirmations',()=>isolated(async()=>{
 let now=Date.parse('2026-09-25T01:00:00Z');Date.now=()=>now;let s=snapshot({now:new Date(now).toISOString()});
 const generate=async x=>({...judge(x),report:'fixture report'});await watch_tick(900,async()=>s,generate);
 for(const p of [post(25,'Global reset has been processed.',{id:'archive',provenance:'archive'}),post(25,'Global reset has been processed.',{id:'truncated',truncated:true}),post(25,'Banked reset card issued.',{id:'banked'}),post(25,'Usage limits are now reset automatically every 7 days.',{id:'weekly'})]){
  now+=300000;s={...s,now:new Date(now).toISOString(),posts:[...s.posts,p],events:[...s.events,...events_from_posts([p])]};await watch_tick(900,async()=>s,generate);
 }expect((await pending_alerts()).filter(a=>a.kind==='confirmed')).toEqual([]);
}));
test('startup seeds known historical resets so later primary verification does not replay old notices',()=>isolated(async()=>{
 let now=Date.parse('2026-09-25T01:00:00Z');Date.now=()=>now;
 let s=snapshot({now:new Date(now).toISOString(),posts:[]});const generate=async x=>({...judge(x),report:'fixture report'});
 await watch_tick(900,async()=>s,generate);
 now+=300000;s={...s,now:new Date(now).toISOString(),posts:snapshot().posts};
 await watch_tick(900,async()=>s,generate);expect(await pending_alerts()).toEqual([]);
}));
test('newly verified completion relationships regenerate predictions and enqueue one confirmation without a text change',()=>isolated(async()=>{
 let now=Date.parse('2026-09-25T01:00:00Z'),calls=0;Date.now=()=>now;
 const promise=post(25,'Global reset landing within the next 2 hours.',{id:'linked-promise',at:'2026-09-25T00:30:00Z'});
 const done=post(25,'Done and dusted',{id:'linked-done',at:'2026-09-25T00:50:00Z'});
 let s=snapshot({now:new Date(now).toISOString(),posts:[...snapshot().posts,promise,done]});
 const generate=async x=>{calls++;return{...judge(x),report:'shared forecast'};};
 await watch_tick(900,async()=>s,generate);expect(calls).toBe(1);expect(await pending_alerts()).toEqual([]);
 now+=300000;s={...s,now:new Date(now).toISOString(),posts:s.posts.map(p=>p.id===done.id?{...p,quotedPostId:promise.id,quotedRelationProvenance:'official-page-data'}:p)};
 const next=await watch_tick(900,async()=>s,generate);expect(calls).toBe(2);expect(next.result.signals.promise.fulfilled).toBe(true);expect(next.result.signals.lastGlobal.id).toBe(done.id);
 expect((await pending_alerts()).map(a=>a.kind)).toEqual(['confirmed']);
 await watch_tick(900,async()=>s,generate);expect(calls).toBe(2);expect((await pending_alerts()).map(a=>a.kind)).toEqual(['confirmed']);
}));
test('stale completions older than 24h update confirmedIds and clock without emitting a delayed confirmation alert, while current promise alerts still fire',()=>isolated(async()=>{
 let now=Date.parse('2026-10-22T06:59:00Z'),calls=0;Date.now=()=>now;
 const plan=post(25,'Over the next 28 days, each day we will either ship a clear improvement or ship a full reset.',{id:'2106845241357824205',at:'2026-10-04T20:33:00Z'});
 const day15=post(25,"Day 15/ Nevermind, we're still cooking... and reset. Enjoy.",{id:'2112432076767289678',at:'2026-10-20T06:33:48.848Z'});
 const day17=post(25,'Day 17/ Bet you thought we forgot, but no, it’s reset day today. Also good time to remind you to get Daybreak Blue access, it only takes 15 mins and you don’t want to have to do it in the middle of an incident.',{id:'2113162277688070445',at:'2026-10-22T06:55:22.314Z'});
 const reply=post(25,'Lands tomorrow before 10am PST.',{id:'2113162413008884099',at:'2026-10-22T06:55:54.577Z',parentId:day17.id,parentRelationProvenance:'official-page-data'});
 let s=snapshot({now:new Date(now).toISOString(),posts:[...snapshot().posts,plan]});
 const generate=async x=>{calls++;return{...judge(x),report:'**Codex 重置预测**\n• 24h：91%\n• 48h：94%'};};
 await watch_tick(900,async()=>s,generate);expect(await pending_alerts()).toEqual([]);
 now+=60000;s={...s,now:new Date(now).toISOString(),posts:[...s.posts,day15,day17,reply]};
 const tick=await watch_tick(900,async()=>s,generate);
 expect(tick.result.signals.lastGlobal.id).toBe(day15.id);
 expect(tick.state.confirmedIds).toContain(day15.id);
 expect(tick.state.promiseIds).toContain(reply.id);
 const alerts=await pending_alerts();
 expect(alerts.map(a=>a.kind)).toEqual(['promise']);
 expect(alerts[0].evidenceAt).toBe(reply.at);
}));
test('high probabilities notify once per cycle without modifying numbers; unavailable probabilities are not treated as high',()=>isolated(async()=>{
 const r={...judge(snapshot()),report:'24h 75% / 48h 88%'};r.forecast.p24=75;r.forecast.p48=88;
 const a=await forecast_alert(r,[],null);expect(a.highCycle).toBe('event-24');await forecast_alert(r,[],a.highCycle);expect(await pending_alerts()).toHaveLength(1);
 expect(r.forecast.p24).toBe(75);r.forecast.available=false;r.signals.lastGlobal={id:'another'};expect((await forecast_alert(r,[],a.highCycle)).highCycle).toBeNull();
}));
test('confirmed notices survive forecast failure and a multi-day outage, while consumed promises expire',()=>isolated(async()=>{
 let now=Date.parse('2026-09-25T01:00:00Z');Date.now=()=>now;
 let s=snapshot({now:new Date(now).toISOString()});const generate=async x=>({...judge(x),report:'fixture report'});
 await watch_tick(900,async()=>s,generate);
 now+=300000;const promise=post(25,'Global reset landing by EOD PST time.',{id:'pending',at:new Date(now).toISOString()});
 s={...s,now:new Date(now).toISOString(),posts:[...s.posts,promise]};await watch_tick(900,async()=>s,generate);
 expect((await pending_alerts()).map(a=>a.kind)).toEqual(['promise']);
 now+=300000;const done=post(25,'Global reset has been processed.',{id:'confirmed-before-ai',at:new Date(now).toISOString()});
 s={...s,now:new Date(now).toISOString(),posts:[...s.posts,done],events:[...s.events,...events_from_posts([done])]};
 await expect(watch_tick(900,async()=>s,async()=>{throw Error('unavailable');})).rejects.toThrow('unavailable');
 expect((await pending_alerts()).map(a=>a.kind)).toEqual(['confirmed']);
 now+=3*86400000;s={...s,now:new Date(now).toISOString()};await watch_tick(900,async()=>s,generate);
 expect((await pending_alerts()).map(a=>a.kind)).toEqual(['confirmed']);
}));
test('real delivery interface fans out identical Markdown to private and group subscribers; late joins, unsubscribes, failures and restart are isolated',()=>isolated(async()=>{
 let now=Date.parse('2026-09-25T01:00:00Z');Date.now=()=>now;const account=account_key();
 const owner=i=>({transport:'lark',account,actor:'ou_member'+i,scope:'oc_private',conversationType:'p2p',authenticated:true});
 for(let i=0;i<35;i++)await subscription_command('subscribe',owner(i));await sync_group_subscriptions('lark',account,['oc_group']);
 now+=1000;const alert=await enqueue_alert('confirmed','fixture-done','**✅ Codex 已重置确认**\n• 原文：Reset all propagated.');
 now+=1000;await subscription_command('subscribe',owner(35));await subscription_command('unsubscribe',owner(0));let sent=[];
 const client={send:async(body,type)=>{sent.push({body,type});return body.receive_id==='ou_member1'?{code:230013}:{code:0,data:{message_id:'om_notice'+sent.length}};}};
 let worker=create_alert_delivery(client,['oc_group']);await Promise.all([worker.tick(),worker.tick()]);await worker.stop();
 expect(sent).toHaveLength(35);expect(sent.some(s=>['ou_member0','ou_member35'].includes(s.body.receive_id))).toBe(false);
 expect(sent.some(s=>s.body.receive_id==='oc_group'&&s.type==='chat_id')).toBe(true);expect(sent.filter(s=>s.type==='open_id')).toHaveLength(34);
 expect(new Set(sent.map(s=>s.body.content)).size).toBe(1);expect((await read_state(delivery_key('ou_member1',alert.key))).state).toBe('rejected');
 worker=create_alert_delivery(client,['oc_group']);await worker.tick();await worker.stop();expect(sent).toHaveLength(35);
 console.log('Realtime delivery trial: 35 private subscribers + one group; same Markdown, isolated failure, no late join or restart replay.');
}),15000);
test('parallel scheduled and realtime group sync do not collide with personal subscription writes',()=>isolated(async()=>{
 const account=account_key(),owner=i=>({transport:'lark',account,actor:'ou_concurrent'+i,scope:'oc_private',conversationType:'p2p',authenticated:true});
 await Promise.all([sync_group_subscriptions('lark',account,['oc_group']),sync_group_subscriptions('lark',account,['oc_group']),
  ...Array.from({length:8},(_,i)=>subscription_command('subscribe',owner(i)))]);
 const {active_recipients}=await import('../../dist/src/subscriptions/registry.mjs');
 expect(await active_recipients('lark',account)).toHaveLength(9);
}));
async function transportTrial(body){return isolated(async dir=>{
 const setup=`let now=Date.parse('2026-10-13T01:00:00Z');Date.now=()=>now;let calls=0;let status=429;
 globalThis.fetch=async()=>{calls++;return new Response('fixture',{status,headers:{'retry-after':'1800'}})};
 const {request}=await import(${JSON.stringify(resolve('dist/src/evidence/transport.mjs'))});const {read_state}=await import(${JSON.stringify(resolve('dist/src/platform/state.mjs'))});`;
 const r=spawnSync(process.execPath,['--eval',setup+body],{env:{...process.env,TIBO_STATE_DIR:dir},encoding:'utf8',timeout:10000});expect(r.status,r.stderr).toBe(0);return JSON.parse(r.stdout);
});}
test('X 429 creates a durable shared cooldown; concurrent requests and all X entry points respect Retry-After',async()=>{
 const r=await transportTrial(`await Promise.allSettled([request('https://x.com/thsottiaux'),request('https://publish.x.com/oembed?fixture=1'),request('https://twitter.com/thsottiaux/status/1')]);const blocked=await read_state('x-request-budget');const before=calls;status=200;now+=1800001;await request('https://x.com/thsottiaux');console.log(JSON.stringify({before,calls,blocked,recovered:await read_state('x-request-budget')}));`);
 expect(r.before).toBe(1);expect(r.calls).toBe(2);expect(r.blocked.until).toBe(Date.parse('2026-10-13T01:30:00Z'));expect(r.recovered.until).toBe(0);
});
test('local X budget prevents bursts without restricting unrelated official sources',async()=>{
 const r=await transportTrial(`status=200;await request('https://x.com/thsottiaux');await Promise.allSettled([request('https://x.com/thsottiaux'),...Array.from({length:25},(_,i)=>request('https://publish.x.com/oembed?id='+i))]);const xCalls=calls;await request('https://status.openai.com/api/v2/incidents.json');console.log(JSON.stringify({xCalls,calls}));`);
 expect(r.xCalls).toBe(20);expect(r.calls).toBe(21);
});
