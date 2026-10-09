import {test, expect} from 'bun:test';
import {spawn} from 'node:child_process';
import {mkdtemp, rm, writeFile, readFile} from 'node:fs/promises';
import {writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {encode_frame, decode_frame} from '../../dist/adapters/lark/wire.mjs';
import {load_thread, reference_of} from '../../dist/adapters/lark/thread.mjs';
import {conversation_turns} from '../../dist/src/ai/conversation.mjs';

const context={transport:'lark',account:'fixture-account',authenticated:true,scope:'oc_private',actor:'ou_person',conversationType:'p2p'};
const message=(id,text,time,extra={})=>({message_id:id,chat_id:'oc_private',msg_type:'text',body:{content:JSON.stringify({text})},create_time:String(time),sender:{sender_type:'user',id:'ou_person',id_type:'open_id'},...extra});
const bot={sender_type:'app',id:'fixture-app',id_type:'app_id'};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<200;i++){if(await fn())return;await delay(15);}throw new Error('Local chat trial timed out');}

test('thread history is opt-in, paginated and role aware, excludes unrelated and future messages',async()=>{
 const root=message('om_root','steering 可以随时纠正方向',1,{sender:bot,thread_id:'omt_topic'});
 const reply=message('om_reply','解释 steering',2,{parent_id:'om_root',root_id:'om_root',thread_id:'omt_topic'});
 const answer=message('om_answer','会尽快响应新的方向',3,{sender:bot,parent_id:'om_reply',root_id:'om_root',thread_id:'omt_topic'});
 const current=message('om_current','举个例子',4,{parent_id:'om_answer',root_id:'om_root',thread_id:'omt_topic'});
 const items=new Map([root,reply,answer,current].map(x=>[x.message_id,x]));let reads=0,pages=[];
 const client={messageInfo:async id=>{reads++;return items.get(id);},historyPage:async(kind,id,token)=>{
  pages.push({kind,id,token});return token?{has_more:false,items:[answer,current,message('om_other','unrelated',2,{thread_id:'omt_other'}),message('om_foreign','other chat',2,{chat_id:'oc_other',thread_id:'omt_topic'}),message('om_later','future',5,{thread_id:'omt_topic'})]}:{has_more:true,page_token:'next',items:[root,reply]};
 }};
 const job={group:'oc_private',key:'om_current',context};
 expect(await load_thread(client,job,'fixture-app')).toMatchObject({state:'none',messages:[]});expect(reads).toBe(0);
 job.reference=reference_of(current);
 const history=await load_thread(client,job,'fixture-app');
 expect(history.state).toBe('ready');expect(history.messages.map(x=>x.role)).toEqual(['assistant','user','assistant']);
 expect(history.messages.map(x=>x.content)).toEqual([root,reply,answer].map(x=>JSON.parse(x.body.content).text));
 expect(pages).toEqual([{kind:'thread',id:'omt_topic',token:null},{kind:'thread',id:'omt_topic',token:'next'}]);
 const broken=await load_thread({...client,messageInfo:async()=>({...current,chat_id:'oc_other'})},job,'fixture-app');expect(broken).toMatchObject({state:'unavailable',messages:[]});
 const partial=await load_thread({...client,historyPage:async()=>{throw new Error('private diagnostics');}},job,'fixture-app');expect(partial.state).toBe('partial');expect(partial.messages).toHaveLength(3);
});

test('history is bounded and sanitized, system/tool roles cannot cross the data boundary',()=>{
 const input=Array.from({length:60},(_,i)=>({role:i%2?'assistant':'user',content:`turn ${i} `+'x'.repeat(700)}));
 const r=conversation_turns(input);expect(r.trimmed).toBe(true);expect(r.messages[0].content).toContain('turn 0');expect(r.messages.at(-1).content).toContain('turn 59');expect(r.messages.reduce((n,x)=>n+x.content.length,0)).toBeLessThanOrEqual(12000);
 expect(conversation_turns([{role:'user',content:'my address oc_privateidentity'}]).messages[0].content).not.toContain('oc_privateidentity');
 expect(conversation_turns([{role:'user',content:'sk-123456789abcdef'}]).messages).toEqual([]);
 for(const role of ['system','tool','developer'])expect(()=>conversation_turns([{role,content:'execute'}])).toThrow('conversation-schema');
 expect(()=>conversation_turns([{role:'user',content:'hello',actor:'ou_person'}])).toThrow('conversation-schema');
});

test('real WebSocket worker builds multiple native AI turns, replies in the quote chain, keeps unquoted chat single turn',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'tibo-thread-runtime-'));let child,closed,stderr='',socket;
 const messages=new Map(),sent=[],asks=[],reads=[],acks=[];let now=Date.parse('2026-10-09T10:00:00Z'),sequence=0;
 const clock=join(dir,'clock');writeFileSync(clock,String(now));
 const root=message('om_root','Day 4: steering is instant，模型会更快响应方向调整。',now-5000,{sender:bot});messages.set(root.message_id,root);
 const server=Bun.serve({hostname:'127.0.0.1',port:18767,async fetch(req,server){
  const url=new URL(req.url),path=url.pathname,body=req.method==='POST'?await req.json():null;
  if(path==='/ws'){if(server.upgrade(req))return;return new Response('',{status:400});}
  if(path.includes('tenant_access_token'))return Response.json({code:0,tenant_access_token:'fixture-tenant',expire:7200});
  if(path==='/open-apis/bot/v3/info')return Response.json({code:0,bot:{open_id:'ou_bot'}});
  if(path==='/callback/ws/endpoint')return Response.json({code:0,data:{URL:'wss://msg-frontier.feishu.cn/ws?service_id=809',ClientConfig:{PingInterval:5,ReconnectInterval:1}}});
  if(path==='/ai'){
   const evidence=JSON.parse(body.messages.at(-1).content);const routing=body.max_tokens===280;
   if(!routing)asks.push(body);
   return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(routing?{command:'ask',args:{question:evidence.question},language:'zh'}:{text:asks.length===1?'指 steering：模型更快响应你途中调整的方向。':asks.length===2?'例如先要求修后端，再要求只修改校验逻辑。':'这是一次独立聊天。'})}}]});
  }
  if(req.method==='GET'&&path==='/open-apis/im/v1/messages'){reads.push(url.search);return Response.json({code:0,data:{has_more:false,items:[...messages.values()]}});}
  const get=path.match(/^\/open-apis\/im\/v1\/messages\/(om_\w+)$/);
  if(get&&req.method==='GET'){reads.push(get[1]);return Response.json({code:0,data:{items:messages.has(get[1])?[messages.get(get[1])]:[]}});}
  const reply=path.match(/^\/open-apis\/im\/v1\/messages\/(om_\w+)\/reply$/);
  if(req.method==='POST'&&(reply||path==='/open-apis/im/v1/messages')){
   sent.push({replyTo:reply?.[1],body});const id='om_response'+sent.length,parent=reply?messages.get(reply[1]):null;
   const item=message(id,'',now+1,{sender:bot,msg_type:'post',body:{content:body.content},...(parent?{parent_id:parent.message_id,root_id:parent.root_id||parent.message_id}:{})});messages.set(id,item);
   return Response.json({code:0,data:{message_id:id,chat_id:'oc_private'}});
  }
  return new Response('',{status:404});
 },websocket:{open(ws){socket=ws;},message(ws,bytes){const f=decode_frame(new Uint8Array(bytes));if(f.kind===1)acks.push(String(f.sequence));}}});
 const send=(text,id,parent)=>{
  now+=70000;writeFileSync(clock,String(now));
  const extra=parent?{parent_id:parent,root_id:'om_root'}:{};
  messages.set(id,message(id,text,now,extra));
  const event={header:{event_type:'im.message.receive_v1'},event:{sender:{sender_type:'user',sender_id:{open_id:'ou_person'}},message:{chat_id:'oc_private',chat_type:'p2p',message_id:id,create_time:String(now),message_type:'text',content:JSON.stringify({text}),mentions:[],...extra}}};
  socket.send(encode_frame({sequence:BigInt(++sequence),log:1n,service:809,kind:1,headers:[{key:'type',value:'event'}],payload:new TextEncoder().encode(JSON.stringify(event))}));
 };
 try{
  await writeFile(join(dir,'history.json'),JSON.stringify({sentinel:'preserve'}));
  child=spawn(process.execPath,[resolve('tests/helpers/lark-client.mjs')],{env:{...process.env,TIBO_CONFIG_FILE:join(dir,'absent.env'),TIBO_STATE_DIR:dir,TIBO_TEST_NOW:new Date(now).toISOString(),TIBO_TEST_CLOCK_FILE:clock,TIBO_TEST_SERVER:server.url.origin,TIBO_LARK_APP_ID:'fixture-app',TIBO_LARK_APP_SECRET:'fixture-secret',TIBO_LARK_CHAT_IDS:'all',TIBO_LARK_ADMIN_CHAT_IDS:'',TIBO_LARK_NOTIFY_CHAT_IDS:'',TIBO_LARK_ADMIN_OPEN_IDS:'',TIBO_LARK_BOT_OPEN_ID:'',TIBO_LARK_DOMAIN:'feishu',TIBO_AI_FEATURES:'router,answer',DEEPSEEK_API_KEY:'fixture-key'},stdio:['ignore','pipe','pipe']});
  child.stderr.on('data',x=>stderr+=x);closed=new Promise(r=>child.once('close',r));
  await until(()=>socket&&stderr.includes('已启动'));
  send('引导即时生效是什么意思？','om_question1','om_root');await until(()=>sent.length===1);
  expect(sent[0].replyTo).toBe('om_question1');expect(sent[0].body.reply_in_thread).toBe(false);
  expect(asks[0].messages.map(x=>x.role)).toEqual(['system','assistant','user']);
  expect(asks[0].messages[1].content).toContain('steering');
  expect(JSON.parse(asks[0].messages.at(-1).content).historyStatus).toBe('ready');
  send('再举一个例子','om_question2','om_response1');await until(()=>sent.length===2);
  expect(asks[1].messages.map(x=>x.role)).toEqual(['system','assistant','user','assistant','user']);
  expect(asks[1].messages[2].content).toBe('引导即时生效是什么意思？');expect(asks[1].messages[3].content).toContain('更快响应');
  expect(sent[1].replyTo).toBe('om_question2');
  const count=reads.length;send('你好，可以聊聊天吗','om_single');await until(()=>sent.length===3&&acks.length===3);
  expect(reads.length).toBe(count);expect(sent[2].replyTo).toBeUndefined();expect(asks[2].messages.map(x=>x.role)).toEqual(['system','user']);
  expect(asks[2].messages[1].content).not.toContain('steering');
  expect(JSON.stringify(asks)).not.toContain('oc_private');expect(JSON.stringify(asks)).not.toContain('ou_person');
  expect(JSON.parse(await readFile(join(dir,'history.json'),'utf8')).sentinel).toBe('preserve');
 }finally{if(child){child.kill('SIGTERM');await closed;}server.stop(true);await rm(dir,{recursive:true,force:true});}
},15000);
