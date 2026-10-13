import {test,expect} from 'bun:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {spawnSync} from 'node:child_process';
const root=resolve('dist');
async function trial(body){
 const dir=await mkdtemp(join(tmpdir(),'tibo-topic-replies-'));
 try{
  const setup=`globalThis.fetch=async()=>{throw Error('no AI or history network')};
  const {deliver,reaction_job,message_key,delivery_key,account_key}=await import(${JSON.stringify(root+'/adapters/lark/service.mjs')});
  const {read_state,write_state}=await import(${JSON.stringify(root+'/src/platform/state.mjs')});
  const {record_pray,identity_key}=await import(${JSON.stringify(root+'/src/prayer/pray.mjs')});
  const {finish_celebration}=await import(${JSON.stringify(root+'/adapters/lark/celebration-delivery.mjs')});
  const context={transport:'lark',account:account_key(),actor:'ou_person',scope:'oc_room',conversationType:'group',authenticated:true};
  let replies=[],sends=[],reads=0,history=0;
  const client={reply:async(id,body)=>{replies.push({id,body});return {code:0,data:{message_id:'om_reply'+replies.length,chat_id:'oc_room',thread_id:'omt_topic'}}},
   send:async body=>{sends.push(body);return {code:0,data:{message_id:'om_send'+sends.length,chat_id:'oc_room'}}},
   historyPage:async()=>{history++;throw Error('business reply must not read dialogue')},
   messageInfo:async id=>{reads++;return {message_id:id,chat_id:'oc_room',thread_id:'omt_topic',sender:{sender_type:'user',id:'ou_other'},body:{content:JSON.stringify({text:'希望token管够'})},msg_type:'text'}}};
  const event=id=>({message_id:id,operator_type:'user',user_id:{open_id:context.actor},reaction_type:{emoji_type:'THANKS'},action_time:String(Date.now())});`;
  const r=spawnSync(process.execPath,['--eval',setup+body],{env:{...process.env,TIBO_CONFIG_FILE:'/dev/null',TIBO_STATE_DIR:dir,TIBO_AI_FEATURES:'',TIBO_LARK_APP_ID:'fixture-app',TIBO_LARK_DOMAIN:'lark'},encoding:'utf8',timeout:10000});
  expect(r.status,r.stderr).toBe(0);return JSON.parse(r.stdout);
 }finally{await rm(dir,{recursive:true,force:true});}
}
test('THANKS on another user topic message replies to that message in its topic without dialogue history',async()=>{
 const r=await trial(`const job=await reaction_job(event('om_topic'),['oc_room'],client);await deliver(client,job.group,job.key,job.command,null,job.context,null,job);console.log(JSON.stringify({replies,sends,reads,history,ledger:await read_state(delivery_key(job.group,job.key))}));`);
 expect(r.sends).toEqual([]);expect(r.replies).toHaveLength(1);expect(r.replies[0].id).toBe('om_topic');expect(r.replies[0].body.reply_in_thread).toBe(true);
 expect(r.replies[0].body.content).toContain('累计🙏 1');expect(r.reads).toBe(1);expect(r.history).toBe(0);expect(r.ledger.chatReceipt??null).toBeNull();
});
test('cached own topic reply keeps placement when reacted to, without another metadata request',async()=>{
 const r=await trial(`await deliver(client,'oc_room','om_question','help',null,context,null,{messageId:'om_question',reference:{threadId:'omt_topic'}});const stored=await read_state(message_key('om_reply1'));const job=await reaction_job(event('om_reply1'),['oc_room'],client);await deliver(client,job.group,job.key,job.command,null,job.context,null,job);console.log(JSON.stringify({stored,replies,sends,reads,history}));`);
 expect(r.sends).toEqual([]);expect(r.replies.map(x=>x.id)).toEqual(['om_question','om_reply1']);expect(r.replies.every(x=>x.body.reply_in_thread)).toBe(true);
 expect(r.stored.replyTarget).toMatchObject({messageId:'om_reply1',threadId:'omt_topic'});expect(r.reads).toBe(0);expect(r.history).toBe(0);
});
test('a thread created by a group send is remembered without enabling dialogue history',async()=>{
 const r=await trial(`client.send=async body=>{sends.push(body);return {code:0,data:{message_id:'om_created',chat_id:'oc_room',thread_id:'omt_topic'}}};await deliver(client,'oc_room','om_single','help',null,context);const job=await reaction_job(event('om_created'),['oc_room'],client);await deliver(client,job.group,job.key,job.command,null,job.context,null,job);console.log(JSON.stringify({replies,sends,reads,history,stored:await read_state(message_key('om_created'))}));`);
 expect(r.sends).toHaveLength(1);expect(r.replies).toHaveLength(1);expect(r.replies[0].id).toBe('om_created');expect(r.replies[0].body.reply_in_thread).toBe(true);expect(r.reads).toBe(0);expect(r.history).toBe(0);
 expect(r.stored.replyTarget).toMatchObject({messageId:'om_created',threadId:'omt_topic'});
});
test('legacy own receipts backfill topic placement once and reuse it for subsequent prayers',async()=>{
 const r=await trial(`await write_state(message_key('om_legacy'),{messageId:'om_legacy',group:'oc_room',appId:'fixture-app',conversationType:'group',text:'已有的香客回复'});const one=await reaction_job(event('om_legacy'),['oc_room'],client);const two=await reaction_job(event('om_legacy'),['oc_room'],client);await deliver(client,one.group,one.key,one.command,null,one.context,null,one);console.log(JSON.stringify({one,two,replies,sends,reads,stored:await read_state(message_key('om_legacy'))}));`);
 expect(r.reads).toBe(1);expect(r.one.replyTarget).toEqual(r.two.replyTarget);expect(r.stored.replyTarget).toMatchObject({messageId:'om_legacy',threadId:'omt_topic'});
 expect(r.sends).toEqual([]);expect(r.replies[0].id).toBe('om_legacy');expect(r.replies[0].body.reply_in_thread).toBe(true);
});
test('celebration parts keep durable topic placement across rejection and resume without replaying the prayer',async()=>{
 const r=await trial(`for(let i=0;i<99;i++)await record_pray({action:'offer'},{...context,requestId:'seed'+i},{silent:true});let clock=Date.now();Date.now=()=>clock;const native=client.reply;let rejected=false;client.reply=async(id,body)=>{if(replies.length===2&&!rejected){rejected=true;return {code:999}}return native(id,body)};const key=delivery_key('oc_room','om_prayer');await deliver(client,'oc_room','om_prayer','pray',null,context,null,{messageId:'om_prayer',reference:{threadId:'omt_topic'}}).catch(()=>{});clock+=2001;await finish_celebration(client,key,context);await finish_celebration(client,key,context);console.log(JSON.stringify({replies,sends,history,ledger:await read_state(key),offers:(await read_state(identity_key)).offers}));`);
 expect(r.sends).toEqual([]);expect(r.replies).toHaveLength(3);expect(r.replies.every(x=>x.id==='om_prayer'&&x.body.reply_in_thread)).toBe(true);
 expect(r.replies[1].body.content).toContain('🎆');expect(r.ledger.replyTarget).toMatchObject({messageId:'om_prayer',threadId:'omt_topic'});expect(r.ledger.festivalFinal).toBe('sent');expect(r.offers).toBe(100);expect(r.history).toBe(0);
});
