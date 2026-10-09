import {test,expect} from 'bun:test';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {spawnSync} from 'node:child_process';
const root=resolve('dist');
async function trial(body,features=''){
 const dir=await mkdtemp(join(tmpdir(),'tibo-compound-'));try{
  const setup=`let now=Date.parse('2026-10-09T00:00:00Z');Date.now=()=>now;
  let provider;const nativeFetch=globalThis.fetch;globalThis.fetch=(...args)=>provider?provider(...args):nativeFetch(...args);
  const {message_candidate,account_key,delivery_key}=await import(${JSON.stringify(root+'/adapters/lark/service.mjs')});
  const {process_interaction}=await import(${JSON.stringify(root+'/adapters/lark/interaction.mjs')});
  const {create_inbox}=await import(${JSON.stringify(root+'/adapters/lark/inbox.mjs')});
  const {read_state,write_state}=await import(${JSON.stringify(root+'/src/platform/state.mjs')});
  const {record_pray,identity_key}=await import(${JSON.stringify(root+'/src/prayer/pray.mjs')});
  const ctx={transport:'lark',account:account_key(),scope:'oc_room',actor:'ou_owner',authenticated:true,conversationType:'group'};
  let posts=[],reactions=[];const client={send:async b=>{posts.push(JSON.parse(b.content).zh_cn.content[0][0].text);return {code:0,data:{message_id:'om_reply'+posts.length}}},react:async(id,emoji)=>{reactions.push({id,emoji});return 'reaction'+reactions.length}};
  const job=(text,id='om_source',context=ctx)=>{const candidate=message_candidate({sender:{sender_type:'user',sender_id:{open_id:context.actor}},message:{chat_id:context.scope,chat_type:context.conversationType,message_type:'text',content:JSON.stringify({text})}},['all'],'ou_bot');return {group:context.scope,key:id,command:candidate.command,triggerKind:candidate.kind,triggerLevel:candidate.level,prayerMaterial:candidate.material,companion:candidate.companion,context,createdAt:new Date(now).toISOString()}};
  const drain=async inbox=>{for(let i=0;i<400&&inbox.status().pending;i++)await new Promise(r=>setTimeout(r,5));await inbox.stop();if(inbox.status().pending)throw Error('inbox did not drain')};`;
  const r=spawnSync(process.execPath,['--eval',setup+body],{env:{...process.env,TIBO_CONFIG_FILE:'/dev/null',TIBO_STATE_DIR:dir,TIBO_AI_FEATURES:features,DEEPSEEK_API_KEY:'fixture-key',TIBO_LARK_DOMAIN:'lark',TIBO_LARK_APP_ID:'fixture',TIBO_LARK_ADMIN_OPEN_IDS:'ou_owner',TIBO_LARK_ADMIN_CHAT_IDS:'oc_room'},encoding:'utf8',timeout:10000});expect(r.status,r.stderr).toBe(0);return JSON.parse(r.stdout);
 }finally{await rm(dir,{recursive:true,force:true});}
}
test('actual inbox delivers help and prayer, stores independent receipts and never repeats after replay',async()=>{
 const r=await trial(`const j=job('help 🙏');const inbox=await create_inbox(client,['all']);await inbox.accept(j);await drain(inbox);const before=await read_state(identity_key);const restart=await create_inbox(client,['all']);await restart.accept(j);await drain(restart);console.log(JSON.stringify({posts,before,after:await read_state(identity_key),root:await read_state(delivery_key(ctx.scope,j.key)),content:await read_state(delivery_key(ctx.scope,j.key+':content')),prayer:await read_state(delivery_key(ctx.scope,j.key+':prayer'))}));`);
 expect(r.posts).toHaveLength(2);expect(r.posts.some(x=>x.includes('**Tibo 查询命令**'))).toBe(true);expect(r.posts.some(x=>x.includes('**🙏 香客'))).toBe(true);expect(r.before.offers).toBe(1);expect(r.after).toEqual(r.before);expect(r.root.state).toBe('handled');expect(r.content.state).toBe('sent');expect(r.prayer.state).toBe('sent');
});
test('keywords still run classification and replies while unrelated text only prays; original ID receives reactions',async()=>{
 const r=await trial(`await write_state('oracle-news',{until:now+60000,at:new Date(now).toISOString(),searchEnabled:false,documents:[]});let questions=[];provider=async(url,o)=>{const b=JSON.parse(o.body);questions.push(JSON.parse(b.messages[1].content).question);return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({text:'ChatGPT先把作业交了，Claude还在排队找橡皮。',citation:null})}}]}))};await process_interaction(client,job('Claude编程模型难用 🙏'));now+=16000;await process_interaction(client,job('Claude编程模型还是难用 🙏','om_next',{...ctx,actor:'ou_other'}));now+=16000;await process_interaction(client,job('重置路由器 🙏','om_unrelated',{...ctx,actor:'ou_third'}));console.log(JSON.stringify({posts,reactions,questions,state:await read_state(identity_key),blocked:await read_state(delivery_key(ctx.scope,'om_next:content'))}));`,'oracle');
 expect(r.questions).toEqual(['Claude编程模型难用']);expect(r.posts).toHaveLength(4);expect(r.posts.filter(x=>x.includes('Claude'))).toHaveLength(1);expect(r.posts.filter(x=>x.includes('**🙏 香客'))).toHaveLength(3);expect(r.state.offers).toBe(3);expect(r.reactions).toEqual([{id:'om_next',emoji:'SMILE'}]);expect(r.blocked.state).toBe('reacted');
});
test('explicit command in a quick second prayer still executes, while prayer acknowledgement keeps its cooldown',async()=>{
 const r=await trial(`await process_interaction(client,job('🙏','om_first'));await process_interaction(client,job('subscribe 🙏','om_second'));const {active_subscribers}=await import(${JSON.stringify(root+'/src/subscriptions/registry.mjs')});console.log(JSON.stringify({posts,state:await read_state(identity_key),subscribers:await active_subscribers('lark',ctx.account),prayer:await read_state(delivery_key(ctx.scope,'om_second:prayer'))}));`);
 expect(r.posts).toHaveLength(2);expect(r.posts[1]).toContain('已订阅');expect(r.state.offers).toBe(2);expect(r.subscribers).toHaveLength(1);expect(r.subscribers[0].id).toBe('ou_owner');expect(r.prayer.state).toBe('suppressed');expect(r.prayer.prayerRecorded).toBe(true);
});
test('admin request and confirmation retain permissions and two steps when accompanied by prayer',async()=>{
 const r=await trial(`await write_state('ledger',{events:[{id:'keep'}]});await process_interaction(client,job('clear-history 🙏','om_denied',{...ctx,actor:'ou_stranger',scope:'oc_elsewhere'}));const preserved=await read_state('ledger');await process_interaction(client,job('clear-history 🙏','om_request'));const requested=await read_state('ledger');const id=posts.find(x=>x.includes('确认ID：')).match(/确认ID：([0-9a-f-]+)/)[1];await process_interaction(client,job('confirm '+id+' 🙏','om_confirm'));console.log(JSON.stringify({posts,preserved,requested,after:await read_state('ledger'),state:await read_state(identity_key)}));`);
 expect(r.posts.some(x=>x.includes('仅管理员'))).toBe(true);expect(r.preserved.events).toHaveLength(1);expect(r.requested.events).toHaveLength(1);expect(r.posts.some(x=>x.includes('已完成：清空本地历史'))).toBe(true);expect(r.after.events).toHaveLength(0);expect(r.state.offers).toBe(3);
});
for(const slow of ['answer','wish'])for(const quoted of [false,true])test(`compound sends the completed ${slow==='answer'?'prayer':'answer'} while ${slow} is still blocked (${quoted?'native thread':'single turn'})`,async()=>{
 const r=await trial(`
  let release;const gate=new Promise(r=>release=r);let started=[];
  provider=async(url,o)=>{const b=JSON.parse(o.body),kind=b.max_tokens===160?'wish':'answer';started.push(kind);if(kind===${JSON.stringify(slow)})await gate;return Response.json({usage:{prompt_tokens:10,completion_tokens:5},choices:[{finish_reason:'stop',message:{content:JSON.stringify(kind==='wish'?{wish:'善信，本神愿汝token绵长，CI天灯长明，Bug心魔退散。'}:{text:'闭包保存定义处可见的变量。'})}}]});};
  const j=job('ask "请解释闭包" 🙏');
  const replies=[];client.reply=async(id,b)=>{replies.push({id,thread:b.reply_in_thread});return client.send(b)};
  if(${quoted}){j.reference={rootId:'om_root',threadId:'omt_topic'};client.messageInfo=async id=>({message_id:id,chat_id:ctx.scope,root_id:'om_root',thread_id:'omt_topic',create_time:id===j.key?String(now):String(now-1000),message_position:id===j.key?'2':'1',msg_type:'text',body:{content:JSON.stringify({text:id===j.key?'请解释闭包':'我们正在讨论闭包。'})},sender:{sender_type:'user',id_type:'open_id',id:ctx.actor}});client.historyPage=async()=>({items:[await client.messageInfo('om_root'),await client.messageInfo(j.key)],has_more:false});}
  const inbox=await create_inbox(client,['all']);await inbox.accept(j);
  for(let i=0;i<100&&(!posts.length||started.length<2);i++)await new Promise(r=>setTimeout(r,5));
  const before={posts:posts.slice(),started:started.slice(),root:await read_state(delivery_key(ctx.scope,j.key)),offers:(await read_state(identity_key)).offers,pending:inbox.status().pending};
  release();await drain(inbox);const {ai_status}=await import(${JSON.stringify(root+'/src/ai/runtime.mjs')});
  console.log(JSON.stringify({before,posts,replies,status:await ai_status(),root:await read_state(delivery_key(ctx.scope,j.key))}));`,'answer,wish');
 expect(r.before.started.toSorted()).toEqual(['answer','wish']);expect(r.before.posts).toHaveLength(1);expect(r.before.posts[0]).toContain(slow==='answer'?'**🙏 香客':'闭包保存');expect(r.before.root).toBeNull();expect(r.before.offers).toBe(1);expect(r.before.pending).toBe(1);
 expect(r.posts).toHaveLength(2);expect(r.posts.some(x=>x.includes('CI天灯长明，Bug心魔退散'))).toBe(true);expect(r.posts.some(x=>x.includes('闭包保存'))).toBe(true);expect(r.root.state).toBe('handled');expect(r.status.usage.answer.calls).toBe(1);expect(r.status.usage.wish.calls).toBe(1);
 expect(r.replies).toEqual(quoted?[{id:'om_source',thread:true},{id:'om_source',thread:true}]:[]);
});
test('failed prayer accounting cannot block content, and replay only resumes the failed branch',async()=>{
 const r=await trial(`const fs=await import('node:fs/promises');const j=job('help 🙏');await fs.writeFile(process.env.TIBO_STATE_DIR+'/'+identity_key+'.json','corrupt');let failed=false;try{await process_interaction(client,j)}catch{failed=true}const before=posts.slice();await fs.unlink(process.env.TIBO_STATE_DIR+'/'+identity_key+'.json');await process_interaction(client,j);console.log(JSON.stringify({failed,before,posts,state:await read_state(identity_key),root:await read_state(delivery_key(ctx.scope,j.key))}));`);
 expect(r.failed).toBe(true);expect(r.before).toHaveLength(1);expect(r.before[0]).toContain('**Tibo 查询命令**');expect(r.posts).toHaveLength(2);expect(r.posts[1]).toContain('**🙏 香客');expect(r.state.offers).toBe(1);expect(r.root.state).toBe('handled');
});
test('restart resumes missing prayer branch without repeating already completed content or accounting',async()=>{
 const r=await trial(`const j=job('help 🙏');const contentKey=delivery_key(ctx.scope,j.key+':content'),prayerKey=delivery_key(ctx.scope,j.key+':prayer');await record_pray({action:'offer'},{...ctx,requestId:prayerKey},{silent:true});await write_state(contentKey,{state:'sent',at:new Date(now).toISOString()});const inbox=await create_inbox(client,['all']);await inbox.accept(j);await drain(inbox);console.log(JSON.stringify({posts,state:await read_state(identity_key),root:await read_state(delivery_key(ctx.scope,j.key))}));`);
 expect(r.posts).toHaveLength(1);expect(r.posts[0]).toContain('**🙏 香客');expect(r.state.offers).toBe(1);expect(r.root.state).toBe('handled');
});
