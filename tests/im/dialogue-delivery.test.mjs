import {test,expect} from 'bun:test';
import {spawnSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';

test('same thread deliveries serialize generation and send; failed sends do not commit and confirmed receipts recover idempotently',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'tibo-dialogue-delivery-'));
 try{
  const code=`
const prompts=[];globalThis.fetch=async(u,o)=>{const b=JSON.parse(o.body);prompts.push(b);return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({text:'回答'+prompts.length})}}]});};
const {deliver,delivery_key,finish_chat}=await import(${JSON.stringify(resolve('dist/adapters/lark/service.mjs'))});
const {reference_of}=await import(${JSON.stringify(resolve('dist/adapters/lark/thread.mjs'))});
const store=await import(${JSON.stringify(resolve('dist/src/chat/store.mjs'))});
const {read_state,write_state}=await import(${JSON.stringify(resolve('dist/src/platform/state.mjs'))});
const context={transport:'lark',account:'fixture-account',scope:'oc_room',actor:'ou_person',authenticated:true,conversationType:'p2p'};
const make=(id,text,time,extra={})=>({message_id:id,chat_id:context.scope,msg_type:'text',create_time:String(time),body:{content:JSON.stringify({text})},sender:{sender_type:'user',id:context.actor},...extra});
const root=make('om_root','解释闭包',1),q1=make('om_q1','ask "闭包是什么意思"',2,{parent_id:'om_root',root_id:'om_root'}),q2=make('om_q2','ask "再举个例子"',10,{parent_id:'om_root',root_id:'om_root'});
const rows=new Map([root,q1,q2].map(x=>[x.message_id,x])),sends=[];let fail=false;
const client={messageInfo:async id=>rows.get(id),historyPage:async()=>({has_more:false,items:[...rows.values()]}),reply:async(id,b)=>{
 sends.push(id);await new Promise(r=>setTimeout(r,30));if(fail)throw new Error('private failure');
 const mid='om_reply'+sends.length;rows.set(mid,make(mid,'',Number(rows.get(id).create_time)+1,{msg_type:'post',body:{content:b.content},sender:{sender_type:'app',id:'fixture-app',id_type:'app_id'},parent_id:id,root_id:'om_root'}));
 return {code:0,data:{message_id:mid,chat_id:context.scope}};
}};
const job=q=>({group:context.scope,key:q.message_id,messageId:q.message_id,context,reference:q===q1?{parentId:'om_root'}:reference_of(q)});
await Promise.all([q1,q2].map(q=>deliver(client,context.scope,q.message_id,JSON.parse(q.body.content).text,null,context,null,job(q))));
const key=store.conversation_key(context,'om_root'),saved=await store.read_session(key);
const prefix=JSON.stringify(prompts[1].messages.slice(0,prompts[0].messages.length))===JSON.stringify(prompts[0].messages);
const receipt={key,revision:saved.revision,sourceId:'om_recover',user:{role:'user',content:'恢复问题'},assistant:'{"text":"恢复回答"}'};
const recovery=delivery_key(context.scope,'recovery');await write_state(recovery,{state:'sent',messageId:'om_recovered',chatReceipt:receipt});
await finish_chat(recovery);await finish_chat(recovery);
const afterRecovery=await store.read_session(key),ledger=await read_state(recovery);
const q3=make('om_q3','ask "这个变量怎么保存"',20,{parent_id:'om_root',root_id:'om_root'});rows.set(q3.message_id,q3);fail=true;let rejected=false;
try{await deliver(client,context.scope,q3.message_id,JSON.parse(q3.body.content).text,null,context,null,job(q3));}catch{rejected=true;}
const failedLedger=await read_state(delivery_key(context.scope,q3.message_id)),after=await store.read_session(key);
console.log(JSON.stringify({prefix,sends,saved,afterRecovery,ledger,rejected,failedLedger,after,promptCount:prompts.length}));
`;
  const r=spawnSync(process.execPath,['--eval',code],{env:{...process.env,TIBO_CONFIG_FILE:join(dir,'absent.env'),TIBO_STATE_DIR:dir,
   TIBO_CHAT_CONTEXT_TOKENS:'900000',TIBO_AI_FEATURES:'answer',DEEPSEEK_API_KEY:'fixture-key',TIBO_LARK_APP_ID:'fixture-app'},
   encoding:'utf8',timeout:10000,maxBuffer:2000000});
  expect(r.status,r.stderr).toBe(0);const d=JSON.parse(r.stdout);
  expect(d.sends).toEqual(['om_q1','om_q2','om_q3']);expect(d.prefix).toBe(true);expect(d.saved.turns).toHaveLength(5);
  expect(d.afterRecovery.turns).toHaveLength(7);expect(d.ledger.chatCommitted).toBe(true);expect(d.ledger.chatReceipt).toBeNull();
  expect(d.rejected).toBe(true);expect(d.failedLedger.state).toBe('uncertain');expect(d.after.turns).toHaveLength(7);
  expect(d.after.seen).not.toContain('om_q3');expect(d.promptCount).toBe(3);
 }finally{await rm(dir,{recursive:true,force:true});}
});
