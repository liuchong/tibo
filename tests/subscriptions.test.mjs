import {test,expect} from 'bun:test';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {subscription_command,active_subscribers,still_subscribed_QMARK_} from '../dist/src/subscriptions.mjs';
import {slot_at,next_slot} from '../dist/src/schedule.mjs';import {ensure_bulletin,bulletin_key} from '../dist/src/bulletin.mjs';
import {read_state,write_state} from '../dist/src/state.mjs';import {create_broadcaster} from '../dist/adapters/lark/broadcast.mjs';
import {account_key,delivery_key} from '../dist/adapters/lark/service.mjs';import {validate_query} from '../dist/src/commands.mjs';
async function isolated(fn){const dir=await mkdtemp(join(tmpdir(),'tibo-subscription-')),old=process.env.TIBO_STATE_DIR,nativeNow=Date.now;process.env.TIBO_STATE_DIR=dir;
try{await fn(dir);}finally{Date.now=nativeNow;if(old===undefined)delete process.env.TIBO_STATE_DIR;else process.env.TIBO_STATE_DIR=old;await rm(dir,{recursive:true,force:true});}}
test('only two Beijing slots exist; subscriptions are self-only, transport/account-wide, idempotent and reject time/recipient arguments',()=>isolated(async()=>{
 Date.now=()=>Date.parse('2026-10-04T00:00:00Z');const c={transport:'future-im',account:'application-one',actor:'private-member',scope:'first-room',authenticated:true};
 expect((await subscription_command('subscribe',c)).text).toContain('下次定点：北京时间 10-04 09:00');
 expect((await subscription_command('subscribe',{...c,scope:'second-room'})).text).toContain('已经订阅');
 const rows=await active_subscribers(c.transport,c.account);expect(rows).toHaveLength(1);expect(rows[0].actor).toBe(c.actor);
 expect((await subscription_command('subscription',c)).text).not.toContain('private-member');
 expect(await active_subscribers(c.transport,'another-app')).toHaveLength(0);expect(await active_subscribers('another-im',c.account)).toHaveLength(0);
 await subscription_command('unsubscribe',c);expect(await active_subscribers(c.transport,c.account)).toHaveLength(0);
 expect((await subscription_command('unsubscribe',c)).text).toContain('未订阅');await subscription_command('subscribe',c);
 expect(await still_subscribed_QMARK_(c.transport,c.account,c.actor,rows[0].revision)).toBe(false);
 expect((await subscription_command('subscribe',null)).ok).toBe(false);expect((await subscription_command('subscribe',{...c,authenticated:false})).ok).toBe(false);
 for(const args of [{time:'10:00'},{actor:'someone'},{cron:'* * * * *'},{timezone:'UTC'}])expect(()=>validate_query({command:'subscribe',args})).toThrow();
 expect(slot_at('2026-10-04T01:00:05Z').at).toBe('2026-10-04T01:00:00.000Z');expect(slot_at('2026-10-04T13:00:05Z').at).toBe('2026-10-04T13:00:00.000Z');
 for(const t of ['2026-10-04T00:59:59Z','2026-10-04T01:01:00Z','2026-10-04T02:00:00Z','2026-10-04T13:02:00Z'])expect(slot_at(t)).toBeNull();
 expect(next_slot('2026-10-04T01:00:00Z')).toBe('2026-10-04T13:00:00.000Z');expect(next_slot('2026-10-04T13:00:00Z')).toBe('2026-10-05T01:00:00.000Z');
}));
test('one durable generation per slot across re-use, concurrent requests, failure and interrupted generation',()=>isolated(async()=>{
 const morning=slot_at('2026-10-04T01:00:02Z'),evening=slot_at('2026-10-04T13:00:02Z');let calls=0;
 const generate=async()=>{calls++;await new Promise(r=>setTimeout(r,20));return '**共享报告**\n• 24h：17%';};
 const attempts=await Promise.allSettled([ensure_bulletin(morning,generate),ensure_bulletin(morning,generate)]);expect(attempts.some(x=>x.status==='fulfilled')).toBe(true);expect(calls).toBe(1);
 const a=await ensure_bulletin(morning,generate),b=await ensure_bulletin(morning,generate);expect(a).toEqual(b);expect(calls).toBe(1);
 const failed=await ensure_bulletin(evening,async()=>{calls++;throw new Error('private diagnostic');});expect(failed.state).toBe('failed');
 expect((await ensure_bulletin(evening,generate)).state).toBe('failed');expect(calls).toBe(2);expect(JSON.stringify(failed)).not.toContain('private diagnostic');
 const interrupted=slot_at('2026-10-05T01:00:00Z');await write_state(bulletin_key(interrupted),{schemaVersion:1,slotAt:interrupted.at,state:'generating'});
 expect((await ensure_bulletin(interrupted,generate)).state).toBe('generating');expect(calls).toBe(2);
 await expect(ensure_bulletin({key:'anything',at:'2026-10-05T02:00:00.000Z'},generate)).rejects.toThrow();
}));
test('37 targets use one report outside the 32-job inbox; late subscriptions, unsubscribe, rejected recipients and restarts do not regenerate',()=>isolated(async()=>{
 let now=Date.parse('2026-10-04T00:00:00Z');Date.now=()=>now;const account=account_key();const owner=i=>({transport:'lark',account,actor:'ou_member'+i,authenticated:true});
 for(let i=0;i<35;i++)await subscription_command('subscribe',owner(i));now=Date.parse('2026-10-04T01:00:02Z');
 const sent=[];let generated=0,worker;
 const client={send:async(body,type)=>{sent.push({body,type});if(sent.length===1){await subscription_command('unsubscribe',owner(0));await subscription_command('subscribe',owner(35));}
  return body.receive_id==='ou_member1'?{code:230013}:{code:0,data:{message_id:'om_broadcast'+sent.length}};}};
 const slot=slot_at(new Date(now).toISOString()),generate=async()=>{generated++;return '**同一份定点报告**\n• 24h：17%\n• 48h：32%';};
 try{worker=create_broadcaster(client,['oc_first','oc_second'],generate);await worker.tick(slot);await worker.stop();
  expect(generated).toBe(1);expect(sent).toHaveLength(36);expect(new Set(sent.map(x=>x.body.content)).size).toBe(1);
  expect(sent.filter(x=>x.type==='open_id')).toHaveLength(34);expect(sent.some(x=>['ou_member0','ou_member35'].includes(x.body.receive_id))).toBe(false);
  expect((await read_state(delivery_key('ou_member1',slot.key))).state).toBe('rejected');expect(await read_state('lark-inbox')).toBeNull();
  expect(worker.status()).toMatchObject({state:'complete',processed:37,recipients:37});
  worker=create_broadcaster(client,['oc_first','oc_second'],generate);await worker.tick(slot);expect(sent).toHaveLength(36);expect(generated).toBe(1);
  console.log('Subscription trial: 35 subscribers + 2 groups, one generation, identical Markdown, unsubscribe before send, isolated recipient failure and no restart replay.');
 }finally{await worker?.stop();}
}),15000);
