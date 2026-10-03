import {test,expect} from 'bun:test';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {command_of,slot_at,markdown_post,send_report,deliver,delivery_key} from '../dist/adapters/lark/service.mjs';
import {read_state} from '../dist/src/state.mjs';
const event=(overrides={})=>({sender:{sender_type:'user'},message:{chat_id:'oc_test',chat_type:'group',message_type:'text',content:JSON.stringify({text:'@_user_1 预测'}),mentions:[{key:'@_user_1',id:{open_id:'ou_bot'}}],...overrides}});
test('group allowlist and exact bot mention admit only bounded user query text',()=>{
 expect(command_of(event(),['oc_test'],'ou_bot')).toBe('预测');
 expect(command_of(event(),['oc_other'],'ou_bot')).toBeNull();
 expect(command_of(event(),['oc_test'],'ou_other')).toBeNull();
 expect(command_of(event({mentions:[]}),['oc_test'],'ou_bot')).toBeNull();
 expect(command_of(event({content:JSON.stringify({text:'@_user_1 最近发言是什么'})}),['oc_test'],'ou_bot')).toBe('最近发言是什么');
 expect(command_of(event({content:JSON.stringify({text:'@_user_1 '+'x'.repeat(801)})}),['oc_test'],'ou_bot')).toBeNull();
});
test('morning/evening schedule is Beijing time, bounded, exact header slot',()=>{
 expect(slot_at('2026-10-03T01:00:33Z').at).toBe('2026-10-03T01:00:00.000Z');
 expect(slot_at('2026-10-03T13:00:59Z').at).toBe('2026-10-03T13:00:00.000Z');
 expect(slot_at('2026-10-03T01:02:33Z')).toBeNull();expect(slot_at('2026-10-03T13:14:59Z')).toBeNull();
 expect(slot_at('2026-10-03T13:15:00Z')).toBeNull();expect(slot_at('2026-10-03T09:00:00Z')).toBeNull();
});
test('markdown is sent as a post with idempotency UUID, requires success plus message id',async()=>{
 let args;const client={send:async x=>{args=x;return {code:0,data:{message_id:'om_test'}};}};
 expect(await send_report(client,'oc_test','fixed-key','**报告**')).toBe('om_test');
 expect(args.msg_type).toBe('post');expect(JSON.parse(args.content).zh_cn.content[0][0].tag).toBe('md');expect(args.uuid).toBe('fixed-key');
 await expect(send_report({send:async()=>({code:0,data:{}})},'oc_test','key','text')).rejects.toThrow();
});
test('uncertain send outcome is retained across restarts and never auto-replayed',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'tibo-lark-'));const old=process.env.TIBO_STATE_DIR;process.env.TIBO_STATE_DIR=dir;
 try{
  let calls=0;const client={send:async()=>{calls++;throw new Error('network disconnected');}};
  await expect(deliver(client,'oc_test','one','help')).rejects.toThrow();expect((await read_state(delivery_key('oc_test','one'))).state).toBe('uncertain');
  await expect(deliver(client,'oc_test','one','help')).rejects.toThrow('重复');expect(calls).toBe(1);
 }finally{if(old===undefined)delete process.env.TIBO_STATE_DIR;else process.env.TIBO_STATE_DIR=old;await rm(dir,{recursive:true,force:true});}
});
test('explicit API rejection records only its numeric code locally and is not retried',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'tibo-lark-rejected-'));const old=process.env.TIBO_STATE_DIR;process.env.TIBO_STATE_DIR=dir;
 try{
  await expect(deliver({send:async()=>({code:230002,msg:'private diagnostic /Users/private'})},'oc_test','rejected','help')).rejects.toThrow();
  const ledger=await read_state(delivery_key('oc_test','rejected'));expect(ledger.state).toBe('rejected');expect(ledger.larkCode).toBe(230002);expect(JSON.stringify(ledger)).not.toContain('private');
 }finally{if(old===undefined)delete process.env.TIBO_STATE_DIR;else process.env.TIBO_STATE_DIR=old;await rm(dir,{recursive:true,force:true});}
});
