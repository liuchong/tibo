import {test,expect} from 'bun:test';
import {spawn} from 'node:child_process';import {mkdtemp,rm,readFile,readdir} from 'node:fs/promises';
import {writeFileSync} from 'node:fs';import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';
import {encode_frame,decode_frame} from '../../dist/adapters/lark/wire.mjs';
import {message_key} from '../../dist/adapters/lark/service.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){const end=performance.now()+5000;while(!await fn()){if(performance.now()>end)throw Error('topic runtime timeout');await sleep(10);}}
test('native WebSocket topic prayers, THANKS and business replies use HTTP reply endpoints while ordinary messages retain group sends',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'tibo-topic-runtime-')),clock=join(dir,'clock');
 let now=Date.parse('2026-10-14T00:00:00Z'),seq=0,child,closed,socket,stderr='';writeFileSync(clock,String(now));
 const sent=[],reads=[],acks=[];
 const server=Bun.serve({hostname:'127.0.0.1',port:18768,async fetch(req,server){
  const path=new URL(req.url).pathname;
  if(path==='/ws'){if(server.upgrade(req))return;return new Response('',{status:400});}
  if(path.includes('tenant_access_token'))return Response.json({code:0,tenant_access_token:'fixture-tenant',expire:7200});
  if(path==='/open-apis/bot/v3/info')return Response.json({code:0,bot:{open_id:'ou_bot'}});
  if(path==='/callback/ws/endpoint')return Response.json({code:0,data:{URL:'wss://msg-frontier.feishu.cn/ws?service_id=809',ClientConfig:{PingInterval:5,ReconnectInterval:1}}});
  if(path==='/open-apis/im/v1/chats/oc_room')return Response.json({code:0,data:{chat_mode:'group',group_message_type:'thread'}});
  if(req.method==='GET'){
   reads.push(path);const id=path.split('/').at(-1);
   return Response.json({code:0,data:{items:[{message_id:id,chat_id:'oc_room',thread_id:'omt_topic',msg_type:'text',body:{content:JSON.stringify({text:'希望token充裕'})},sender:{sender_type:'user',id:'ou_other'}}]}});
  }
  const reply=path.match(/^\/open-apis\/im\/v1\/messages\/(om_\w+)\/reply$/);
  if(req.method==='POST'&&(reply||path==='/open-apis/im/v1/messages')){
   const body=await req.json();sent.push({id:reply?.[1],body});return Response.json({code:0,data:{message_id:'om_response'+sent.length,chat_id:'oc_room',...(body.reply_in_thread?{thread_id:'omt_topic'}:{})}});
  }
  return new Response('',{status:404});
 },websocket:{open(ws){socket=ws;},message(ws,data){const f=decode_frame(new Uint8Array(data));if(f.kind===1)acks.push(String(f.sequence));}}});
 const dispatch=(key,event)=>{now+=70000;writeFileSync(clock,String(now));socket.send(encode_frame({sequence:BigInt(++seq),log:1n,service:809,kind:1,headers:[{key:'type',value:'event'}],payload:new TextEncoder().encode(JSON.stringify({header:{event_type:key,event_id:'fixture-event'+seq},event}))}));};
 const message=(id,text,extra={})=>dispatch('im.message.receive_v1',{sender:{sender_type:'user',sender_id:{open_id:'ou_person'}},message:{message_id:id,chat_id:'oc_room',chat_type:'group',create_time:String(now+70000),message_type:'text',content:JSON.stringify({text}),mentions:[{key:'@_user_1',id:{open_id:'ou_bot'}}],...extra}});
 const react=id=>dispatch('im.message.reaction.created_v1',{message_id:id,operator_type:'user',user_id:{open_id:'ou_person'},reaction_type:{emoji_type:'THANKS'},action_time:String(now+70000)});
 try{
  child=spawn(process.execPath,[resolve('tests/helpers/lark-client.mjs')],{env:{...process.env,TIBO_CONFIG_FILE:join(dir,'absent.env'),TIBO_STATE_DIR:dir,TIBO_TEST_NOW:new Date(now).toISOString(),TIBO_TEST_CLOCK_FILE:clock,TIBO_TEST_SERVER:server.url.origin,TIBO_LARK_APP_ID:'fixture-app',TIBO_LARK_APP_SECRET:'fixture-secret',TIBO_LARK_DOMAIN:'feishu',TIBO_LARK_CHAT_IDS:'all',TIBO_LARK_ADMIN_CHAT_IDS:'',TIBO_LARK_NOTIFY_CHAT_IDS:'',TIBO_LARK_ADMIN_OPEN_IDS:'',TIBO_LARK_BOT_OPEN_ID:'',TIBO_AI_FEATURES:'',DEEPSEEK_API_KEY:''},stdio:['ignore','pipe','pipe']});
  child.stderr.on('data',b=>stderr+=b);closed=new Promise(r=>child.once('close',r));await until(()=>socket&&stderr.includes('已启动'));
  message('om_pray','🙏',{thread_id:'omt_topic',mentions:[]});await until(()=>sent.length===1);
  await until(async()=>{try{return !!JSON.parse(await readFile(join(dir,message_key('om_response1')+'.json'),'utf8')).replyTarget;}catch{return false;}});
  message('om_help','help',{thread_id:'omt_topic'});await until(()=>sent.length===2);
  react('om_response1');await until(()=>sent.length===3);expect(reads).toEqual([]);
  react('om_foreign');await until(()=>sent.length===4);expect(reads).toEqual(['/open-apis/im/v1/messages/om_foreign']);
  message('om_single','help');await until(()=>sent.length===5);
  message('om_quote','help',{parent_id:'om_help',root_id:'om_help'});await until(()=>sent.length===6);
  message('om_question','ask "可以聊聊吗"',{thread_id:'omt_topic'});await until(()=>sent.length===7&&acks.length===7);
  expect(sent.slice(0,4).map(x=>x.id)).toEqual(['om_pray','om_help','om_response1','om_foreign']);
  expect(sent.slice(0,4).every(x=>x.body.reply_in_thread===true)).toBe(true);
  expect(sent[4].id).toBeUndefined();expect(sent[4].body.receive_id).toBe('oc_room');
  expect(sent[5].id).toBe('om_quote');expect(sent[5].body.reply_in_thread).toBe(false);
  expect(sent[6].id).toBe('om_question');expect(sent[6].body.reply_in_thread).toBe(true);
  expect(sent[2].body.content).toContain('累计🙏 2');expect(sent[3].body.content).toContain('累计🙏 3');
  expect(reads).toHaveLength(1);expect((await readdir(dir,{withFileTypes:true})).some(f=>f.isFile()&&f.name.startsWith('conversation-'))).toBe(false);
  console.log('Native topic trial: 7 HTTP replies/sends from 7 WebSocket events; topic prayers, reactions and help stay in topic; no AI or history reads.');
 }finally{if(child){child.kill('SIGTERM');await closed;}server.stop(true);await rm(dir,{recursive:true,force:true});}
},15000);
