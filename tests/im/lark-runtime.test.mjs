import {test,expect} from 'bun:test';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,readFile,writeFile,readdir} from 'node:fs/promises';
import {writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {encode_frame,decode_frame,header_value} from '../../dist/adapters/lark/wire.mjs';
import {create_inbox} from '../../dist/adapters/lark/inbox.mjs';
import {read_state,write_state} from '../../dist/src/platform/state.mjs';
import {delivery_key,message_key} from '../../dist/adapters/lark/service.mjs';
import {paths,plist} from '../../dist/src/platform/service.mjs';
import {snapshot} from '../helpers/fixture.mjs';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(predicate,timeout=5000){const deadline=Date.now()+timeout;while(Date.now()<deadline){if(await predicate())return;await delay(10);}throw new Error('Local trial timed out');}

test('native HTTP/WebSocket bot receives, persists before ACK, replies, enforces confirmation, reconnects and stops',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'tibo-lark-runtime-'));
 const sockets=[],acks=[],posts=[],requests=[];let child,closed,stderr='',socketCount=0;
 // Fixed port is released in finally, never changed to evade an occupied listener.
 const server=Bun.serve({hostname:'127.0.0.1',port:18761,
  async fetch(req,server){
   const path=new URL(req.url).pathname;
   if(path==='/ws'){if(server.upgrade(req))return;return new Response('upgrade required',{status:400});}
   const body=req.method==='POST'?await req.json():null;requests.push({path,recipientType:new URL(req.url).searchParams.get('receive_id_type'),auth:req.headers.get('authorization'),body});
   if(path.includes('tenant_access_token'))return Response.json({code:0,tenant_access_token:'local-tenant',expire:7200});
   if(path==='/open-apis/bot/v3/info')return Response.json({code:0,bot:{open_id:'ou_bot'}});
   if(path==='/callback/ws/endpoint')return Response.json({code:0,data:{URL:'wss://msg-frontier.feishu.cn/ws?service_id=809',ClientConfig:{PingInterval:5,ReconnectInterval:1}}});
   if(path==='/open-apis/im/v1/messages'){posts.push(body);return Response.json({code:0,data:{message_id:'om_reply'+posts.length}});}
   if(path==='/ai')return new Response('fixture-secret /Users/private deepseek-flash',{status:401});
   return new Response('unexpected',{status:404});
  },websocket:{open(ws){sockets.push(ws);socketCount++;},async message(ws,bytes){
   const f=decode_frame(new Uint8Array(bytes));
   if(f.kind===0){ws.send(encode_frame({...f,headers:[{key:'type',value:'pong'}],payload:new TextEncoder().encode('{"PingInterval":5,"ReconnectInterval":1}')}));return;}
   const inbox=JSON.parse(await readFile(join(dir,'lark-inbox.json'),'utf8').catch(()=>'{}'));
   acks.push({seq:String(f.sequence),value:JSON.parse(new TextDecoder().decode(f.payload)),inbox,biz:header_value(f,'biz_rt')});
  }}});
 const text=i=>JSON.parse(posts[i].content).zh_cn.content[0][0].text;
 let sequence=0;
 let trialNow=new Date('2026-10-04T00:00:00Z').getTime();const clockFile=join(dir,'clock');writeFileSync(clockFile,String(trialNow));
 const send=(command,id,overrides={},actor='ou_admin',advance=70000)=>{
  trialNow+=advance;writeFileSync(clockFile,String(trialNow));
  const event={header:{event_type:'im.message.receive_v1'},event:{sender:{sender_type:'user',sender_id:{open_id:actor}},message:{chat_id:'oc_fixture',chat_type:'group',message_id:id,create_time:String(trialNow),message_type:'text',content:JSON.stringify({text:'@_user_1 '+command}),mentions:[{key:'@_user_1',id:{open_id:'ou_bot'}}],...overrides}}};
  const frame={sequence:BigInt(++sequence),log:9007199254740993n,service:809,kind:1,headers:[{key:'type',value:'event'}],payload:new TextEncoder().encode(JSON.stringify(event))};
  sockets.at(-1).send(encode_frame(frame));return sequence;
 };
 const react=(message='om_reply8',actor='ou_admin',emoji='THANKS',type='user')=>{
  trialNow+=70000;writeFileSync(clockFile,String(trialNow));
  sockets.at(-1).send(encode_frame({sequence:BigInt(++sequence),log:1n,service:809,kind:1,
   headers:[{key:'type',value:'event'}],payload:new TextEncoder().encode(JSON.stringify({header:{event_type:'im.message.reaction.created_v1'},
    event:{message_id:message,operator_type:type,user_id:{open_id:actor},reaction_type:{emoji_type:emoji},action_time:String(trialNow)}}))}));
 };
 try{
  await writeFile(join(dir,'experience.json'),JSON.stringify({sentinel:'preserved'}));
  const env={...process.env,TIBO_TEST_NOW:'2026-10-04T00:00:00Z',TIBO_TEST_CLOCK_FILE:clockFile,TIBO_CONFIG_FILE:join(dir,'absent.env'),TIBO_STATE_DIR:dir,TIBO_SNAPSHOT:'',TIBO_LARK_APP_ID:'fixture-app',TIBO_LARK_APP_SECRET:'fixture-secret',TIBO_LARK_CHAT_IDS:'oc_fixture',TIBO_LARK_BOT_OPEN_ID:'',TIBO_LARK_ADMIN_OPEN_IDS:'ou_admin',TIBO_LARK_DOMAIN:'feishu',TIBO_AI_FEATURES:'router',DEEPSEEK_API_KEY:'fixture-router-key',TIBO_TEST_SERVER:server.url.origin};
  child=spawn(process.execPath,[resolve('tests/helpers/lark-client.mjs')],{env,stdio:['ignore','pipe','pipe']});
  child.stderr.on('data',x=>stderr+=x);closed=new Promise(r=>child.once('close',r));
  await until(()=>stderr.includes('已启动'));
  const first=send('help','om_help');await until(()=>posts.length===1&&acks.some(a=>a.seq===String(first)));
  expect(text(0)).toContain('Tibo 查询命令');expect(text(0)).toContain('clear-experience');
  expect(acks.find(a=>a.seq===String(first))).toMatchObject({value:{code:200},biz:expect.any(String)});
  send('help','om_help');send('help','om_wrong',{chat_id:'oc_other'});send('help','om_stale',{create_time:String(trialNow-600000)});send('help','om_nomention',{mentions:[]});
  await until(()=>acks.length===5);await delay(60);expect(posts).toHaveLength(1);
  send('清空经验','om_propose');await until(()=>posts.length===2);
  const id=text(1).match(/确认ID：([0-9a-f-]+)/)[1];expect(JSON.parse(await readFile(join(dir,'experience.json'),'utf8')).sentinel).toBe('preserved');
  send('确认 '+id,'om_denied',{},'ou_other');await until(()=>posts.length===3);expect(text(2)).toContain('仅管理员');
  expect(JSON.parse(await readFile(join(dir,'experience.json'),'utf8')).sentinel).toBe('preserved');
  send('确认 '+id,'om_confirm');await until(()=>posts.length===4);expect(text(3)).toContain('已完成');
  expect(JSON.parse(await readFile(join(dir,'experience.json'),'utf8')).predictions).toEqual([]);expect((await readdir(dir)).some(x=>x.startsWith('backup-'))).toBe(true);
  send('确认 '+id,'om_replay');await until(()=>posts.length===5);expect(text(4)).toContain('已使用');
  send('请列出目前可用的业务指令','om_semantic');await until(()=>posts.length===6);expect(text(5)).toContain('语义查询暂时出了问题');
  for(const post of posts){expect(post.content).not.toMatch(/fixture-secret|fixture-router-key|local-tenant|\/Users\/|deepseek|TIBO_|\.env/i);expect(post.uuid.length).toBe(40);expect(post.receive_id).toBe('oc_fixture');}
  sockets.at(-1).close();await until(()=>socketCount===2,4000);send('help','om_reconnected',{},'ou_other');await until(()=>posts.length===7);expect(text(6)).not.toContain('clear-experience');
  expect(requests.filter(x=>x.path.includes('tenant_access_token'))).toHaveLength(1);expect(requests.find(x=>x.path==='/open-apis/bot/v3/info').auth).toBe('Bearer local-tenant');
  send('🙏🏽🙏','om_pray',{mentions:[],content:JSON.stringify({text:'🙏🏽🙏'})});await until(()=>posts.length===8);
  expect(text(7)).toContain('累计🙏 1');expect(text(7)).toContain('第一炷');
  await until(async()=>{try{return !!JSON.parse(await readFile(join(dir,message_key('om_reply8')+'.json'),'utf8'));}catch{return false;}});
  react();await until(()=>posts.length===9);expect(text(8)).toContain('累计🙏 2');
  const ackStart=acks.length;
  react();react('om_someone_else');react('om_reply8','ou_admin','SMILE');react('om_reply8','ou_admin','THANKS','app');
  await until(()=>acks.length>=ackStart+4);await delay(80);expect(posts).toHaveLength(9);
  react('om_reply8','ou_other');await until(()=>posts.length===10);expect(text(9)).toContain('香客002');
  send('pray board','om_board');await until(()=>posts.length===11);expect(text(10)).toContain('香客001');expect(text(10)).toContain('香客002');
  send('订阅','om_subscribe');await until(()=>posts.length===12);expect(text(11)).toContain('已订阅');expect(text(11)).toContain('09:00、21:00');
  send('订阅','om_dm_subscribe',{chat_id:'oc_private',chat_type:'p2p',mentions:[],content:JSON.stringify({text:'订阅'})});await until(()=>posts.length===13);expect(text(12)).toContain('已经订阅');
  send('订阅','om_subscribe_other',{},'ou_other');await until(()=>posts.length===14);
  send('退订','om_unsubscribe_other',{},'ou_other');await until(()=>posts.length===15);expect(text(14)).toContain('已退订');
  send('订阅','om_resubscribe_other',{},'ou_other');await until(()=>posts.length===16);
  react('om_reply13','ou_admin');await until(()=>posts.length===17);expect(text(16)).toContain('累计🙏 3');expect(posts[16].receive_id).toBe('oc_private');
  const eventStats=JSON.parse(await readFile(join(dir,'lark-events.json'),'utf8'));expect(eventStats.lastReaction.accepted).toBe(true);
  for(const post of posts)expect(post.content).not.toMatch(/fixture-secret|fixture-router-key|local-tenant|\/Users\/|deepseek|oc_fixture|ou_admin|ou_other/i);
  // A real socket burst from twenty people is one optional interruption,
  // not twenty model calls or twenty delayed replies after the discussion.
  trialNow+=600001;writeFileSync(clockFile,String(trialNow));
  const ackBefore=acks.length;
  for(let i=0;i<20;i++)send('',`om_discussion${i}`,{mentions:[],content:JSON.stringify({text:`Claude编程模型怎么样？讨论${i}`})},`ou_member${i}`,1000);
  await until(()=>acks.length>=ackBefore+20);
  await until(async()=>{const s=JSON.parse(await readFile(join(dir,'lark-inbox.json'),'utf8'));return s.jobs.length===0;});
  expect(posts).toHaveLength(18);
  const receipts=await Promise.all(Array.from({length:20},(_,i)=>readFile(join(dir,delivery_key('oc_fixture',`om_discussion${i}`)+'.json'),'utf8').then(JSON.parse)));
  expect(receipts.filter(r=>r.state==='sent')).toHaveLength(1);expect(receipts.filter(r=>r.state==='suppressed')).toHaveLength(19);
  console.log('Local discussion trial: 20 people mentioning Claude via WebSocket, 1 reply + 19 suppressed receipts; all events drained and acknowledged.');
  child.kill('SIGTERM');expect(await closed).toBe(0);expect(JSON.parse(await readFile(join(dir,'lark-runtime.json'),'utf8')).state).toBe('stopped');
  expect((await readdir(dir)).some(x=>x.endsWith('.lock'))).toBe(false);
  console.log('Local Lark trial: 17 HTTP replies; group + DM self-subscription, unsubscribe/resubscribe, pray text/reaction, admin confirmation and reconnect.');
  posts.pop(); // The independent storm trial is not a scheduled bulletin.
  // One generation fans out to a group and two private recipients at each slot.
  await writeFile(join(dir,'ledger.json'),JSON.stringify(snapshot()));
  let morningBulletin;
  for(const [time,count,title] of [['2026-10-04T01:00:02Z',20,'09:00'],['2026-10-04T01:00:02Z',20,null],['2026-10-04T01:02:00Z',20,null],['2026-10-04T13:00:02Z',23,'21:00']]){
   stderr='';child=spawn(process.execPath,[resolve('tests/helpers/lark-client.mjs')],{env:{...env,TIBO_TEST_CLOCK_FILE:'',TIBO_TEST_NOW:time,TIBO_AI_FEATURES:''},stdio:['ignore','pipe','pipe']});
   child.stderr.on('data',x=>stderr+=x);closed=new Promise(r=>child.once('close',r));await until(()=>stderr.includes('已启动'));
   if(title){await until(()=>posts.length===count);expect(text(count-1)).toContain('北京时间 10-04 '+title);expect(text(count-1)).toContain('24h');expect(text(count-1)).toContain('48h');
    const batch=posts.slice(count-3,count);expect(new Set(batch.map(x=>x.content)).size).toBe(1);expect(batch.map(x=>x.receive_id)).toEqual(['oc_fixture','ou_admin','ou_other']);
    const routes=requests.filter(x=>x.path==='/open-apis/im/v1/messages').slice(-3);expect(routes.map(x=>x.recipientType)).toEqual(['chat_id','open_id','open_id']);
   }
   const bulletins=(await readdir(dir)).filter(x=>x.startsWith('bulletin-')&&x.endsWith('.json'));
   expect(bulletins).toHaveLength(title==='21:00'?2:1);
   if(!morningBulletin)morningBulletin=await readFile(join(dir,bulletins[0]),'utf8');
   if(title!=='21:00')expect(await readFile(join(dir,bulletins[0]),'utf8')).toBe(morningBulletin);
   await delay(80);expect(posts).toHaveLength(count);child.kill('SIGTERM');expect(await closed).toBe(0);
  }
  console.log('Local schedule trial: 09:00/21:00, one stored report per slot, identical Markdown to group + two open_id private recipients, no duplicate/re-generation on restart and no 09:02 catch-up.');
 }finally{if(child&&child.exitCode===null){child.kill('SIGTERM');await Promise.race([closed,delay(3000)]);if(child.exitCode===null){child.kill('SIGKILL');await closed;}}server.stop(true);await rm(dir,{recursive:true,force:true});}
},15000);

test('durable inbox recovers accepted jobs, skips uncertain sends and handles subsequent commands',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'tibo-inbox-'));const old=process.env.TIBO_STATE_DIR;process.env.TIBO_STATE_DIR=dir;let inbox;
 const job=key=>({group:'oc_fixture',key,command:'help'});let sent=[];
 try{
  await write_state('lark-inbox',{jobs:[job('accepted'),job('uncertain')]});
  await write_state(delivery_key('oc_fixture','uncertain'),{state:'sending'});
  inbox=await create_inbox({send:async body=>{sent.push(body);return {code:0,data:{message_id:'om_fixture'}};}},['oc_fixture']);
  inbox.resume();await until(()=>inbox.status().pending===0);expect(sent).toHaveLength(1);
  await inbox.accept(job('after-drain'));await inbox.accept(job('after-drain'));await until(()=>inbox.status().pending===0);expect(sent).toHaveLength(2);
  await inbox.stop();expect((await read_state('lark-inbox')).jobs).toEqual([]);
 }finally{await inbox?.stop();if(old===undefined)delete process.env.TIBO_STATE_DIR;else process.env.TIBO_STATE_DIR=old;await rm(dir,{recursive:true,force:true});}
});

test('inbox writes before returning acceptance and retains bounded jobs when stopping before processing',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'tibo-inbox-accept-'));const old=process.env.TIBO_STATE_DIR;process.env.TIBO_STATE_DIR=dir;let inbox,calls=0;
 try{
  inbox=await create_inbox({send:async()=>{calls++;throw new Error('must not send');}},['oc_fixture']);
  await inbox.accept({group:'oc_fixture',key:'accepted',command:'help'});await inbox.stop();
  expect((await read_state('lark-inbox')).jobs).toHaveLength(1);expect(calls).toBe(0);
  const jobs=Array.from({length:32},(_,i)=>({group:'oc_fixture',key:String(i),command:'help'}));await write_state('lark-inbox',{jobs});
  inbox=await create_inbox({},['oc_fixture']);await expect(inbox.accept({group:'oc_fixture',key:'overflow',command:'help'})).rejects.toThrow('已满');
  expect((await read_state('lark-inbox')).jobs).toHaveLength(32);await inbox.stop();
 }finally{await inbox?.stop();if(old===undefined)delete process.env.TIBO_STATE_DIR;else process.env.TIBO_STATE_DIR=old;await rm(dir,{recursive:true,force:true});}
});

test('Lark installation uses its own label, binary, command and logs while preserving core daemon',()=>{
 const p=paths('lark'),core=paths();expect(p.binary).toEndWith('/tibo-lark');expect(p.plist).toEndWith('/com.liuchong.tibo.lark.plist');expect(core.label).toBe('com.liuchong.tibo');
 const xml=plist(p);expect(xml).toContain('<string>run</string>');expect(xml).toContain('lark.stderr.log');expect(xml).not.toContain('APP_SECRET');expect(xml).not.toContain('daemon.stderr.log');
});
test('unreadable delivery state pauses the worker and preserves accepted queries',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'tibo-inbox-fault-'));const old=process.env.TIBO_STATE_DIR;process.env.TIBO_STATE_DIR=dir;let inbox;
 try{
  await write_state('lark-inbox',{jobs:[{group:'oc_fixture',key:'broken',command:'help'}]});
  await writeFile(join(dir,delivery_key('oc_fixture','broken')+'.json'),'invalid');
  inbox=await create_inbox({},['oc_fixture']);inbox.resume();await until(()=>inbox.status().paused);
  expect((await read_state('lark-inbox')).jobs).toHaveLength(1);await inbox.stop();
 }finally{await inbox?.stop();if(old===undefined)delete process.env.TIBO_STATE_DIR;else process.env.TIBO_STATE_DIR=old;await rm(dir,{recursive:true,force:true});}
});

test('fixed business commands bypass a blocked ordinary query without losing, duplicating or replaying either job',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'tibo-inbox-lanes-')),oldDir=process.env.TIBO_STATE_DIR,oldFeatures=process.env.TIBO_AI_FEATURES;
 process.env.TIBO_STATE_DIR=dir;process.env.TIBO_AI_FEATURES='';let inbox,release;const sent=[];
 const blocked=new Promise(resolve=>{release=resolve;});
 try{
  const {fast_job_QMARK_}=await import('../../dist/adapters/lark/inbox.mjs');
  // Unknown semantic queries must enter the normal lane rather than remain unprocessable.
  expect(fast_job_QMARK_({command:'什么时候重置'})).toBe(false);
  inbox=await create_inbox({send:async body=>{sent.push(body);if(sent.length===1)await blocked;return {code:0,data:{message_id:'om_lanes'+sent.length}};}},['oc_fixture']);
  await inbox.accept({group:'oc_fixture',key:'slow',command:'ask slow question'});await until(()=>sent.length===1);
  await inbox.accept({group:'oc_fixture',key:'fast',command:'help'});await until(()=>sent.length===2);
  await until(async()=> (await read_state('lark-inbox')).jobs.length===1);
  expect((await read_state('lark-inbox')).jobs[0].key).toBe('slow');
  expect(JSON.parse(sent[1].content).zh_cn.content[0][0].text).toContain('命令');
  release();await until(()=>inbox.status().pending===0);await inbox.accept({group:'oc_fixture',key:'fast',command:'help'});
  await delay(30);expect(sent).toHaveLength(2);
 }finally{release?.();await inbox?.stop();if(oldDir===undefined)delete process.env.TIBO_STATE_DIR;else process.env.TIBO_STATE_DIR=oldDir;if(oldFeatures===undefined)delete process.env.TIBO_AI_FEATURES;else process.env.TIBO_AI_FEATURES=oldFeatures;await rm(dir,{recursive:true,force:true});}
});
