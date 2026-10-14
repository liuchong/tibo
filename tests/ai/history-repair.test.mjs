import {test,expect} from 'bun:test';import {mkdtemp,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {conversation_key,read_session,import_turns,compact_session} from '../../dist/src/chat/store.mjs';
import {write_state} from '../../dist/src/platform/state.mjs';import {load_thread} from '../../dist/adapters/lark/thread.mjs';
test('legacy blanket placeholder is repaired by verified root text, preserving other turns and idempotence; compaction stays unloaded',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'tibo-history-repair-')),old=process.env.TIBO_STATE_DIR;process.env.TIBO_STATE_DIR=dir;
 try{
  const ctx={transport:'lark',account:'fixture',scope:'oc_room',actor:'ou_person',authenticated:true},key=conversation_key(ctx,'om_root');
  await write_state(key,{version:1,revision:3,generation:0,summary:null,through:3,seen:['om_root','om_old_q','om_old_a'],turns:[{role:'assistant',content:'[敏感内容已隐藏]'},{role:'user',content:'Earlier followup'},{role:'assistant',content:'A prior answer'}],checkpoint:{tokens:100,count:3}});
  const root={message_id:'om_root',chat_id:ctx.scope,create_time:'1',msg_type:'text',body:{content:JSON.stringify({text:'OpenAI API状态可查看官方页面，API key余额是通用排查项。'})},sender:{sender_type:'app',id_type:'app_id',id:'fixture-app'}};
  const current={message_id:'om_current',chat_id:ctx.scope,create_time:'4',root_id:'om_root',parent_id:'om_root',msg_type:'text',body:{content:'{"text":"继续查一下"}'},sender:{sender_type:'user',id:ctx.actor}};
  const client={messageInfo:async id=>id==='om_root'?root:current,historyPage:async()=>({has_more:false,items:[current]})};
  const history=await load_thread(client,{group:ctx.scope,key:current.message_id,context:ctx,reference:{rootId:'om_root'}},'fixture-app');
  expect(history.state).toBe('ready');expect(history.messages[0].content).toContain('API key余额');expect(history.messages.slice(1).map(x=>x.content)).toEqual(['Earlier followup','A prior answer']);
  const saved=await read_session(key);expect(saved.checkpoint).toBeNull();expect(saved.revision).toBe(4);
  await import_turns(key,[{id:'om_root',role:'assistant',content:JSON.parse(root.body.content).text}],5);expect((await read_session(key)).revision).toBe(4);
  await compact_session(key,4,'The verified service context and previous questions.');await import_turns(key,[{id:'om_root',role:'assistant',content:'different edited root'}],6);
  expect((await read_session(key)).turns).toEqual([]);expect((await read_session(key)).generation).toBe(1);
 }finally{if(old===undefined)delete process.env.TIBO_STATE_DIR;else process.env.TIBO_STATE_DIR=old;await rm(dir,{recursive:true,force:true});}
});
