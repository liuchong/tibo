import {test,expect} from 'bun:test';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {spawnSync} from 'node:child_process';
const root=resolve('dist');
async function trial(body,features=''){
 const dir=await mkdtemp(join(tmpdir(),'tibo-reset-chain-'));
 try{
  const code=`let now=Date.parse('2026-10-09T11:30:00Z');Date.now=()=>now;let network=0,model=0;let ai;
  globalThis.fetch=async(url,o)=>{if(String(url).includes('/chat/completions')){model++;return ai?ai(url,o):new Response('',{status:503})}network++;return new Response('',{status:503})};
  const {snapshot}=await import(${JSON.stringify(resolve('tests/helpers/fixture.mjs'))});
  const {message_candidate,account_key,delivery_key}=await import(${JSON.stringify(root+'/adapters/lark/service.mjs')});
  const {process_interaction}=await import(${JSON.stringify(root+'/adapters/lark/interaction.mjs')});
  const {read_state,write_state}=await import(${JSON.stringify(root+'/src/platform/state.mjs')});
  const {identity_key}=await import(${JSON.stringify(root+'/src/prayer/pray.mjs')});
  await write_state('ledger',snapshot({now:new Date(now-1000).toISOString()}));
  const ctx={transport:'lark',account:account_key(),scope:'oc_room',actor:'ou_owner',authenticated:true,conversationType:'p2p'};
  let posts=[],replies=[];const client={send:async b=>{posts.push(JSON.parse(b.content).zh_cn.content[0][0].text);return {code:0,data:{message_id:'om_reply'+posts.length}}},reply:async(id,b)=>{replies.push({id,thread:b.reply_in_thread});return client.send(b)}};
  const job=(text,id='om_source',context=ctx)=>{const candidate=message_candidate({sender:{sender_type:'user',sender_id:{open_id:context.actor}},message:{chat_id:context.scope,chat_type:context.conversationType,message_type:'text',content:JSON.stringify({text})}},['all'],'ou_bot');return {group:context.scope,key:id,command:candidate.command,triggerKind:candidate.kind,triggerLevel:candidate.level,prayerMaterial:candidate.material,companion:candidate.companion,context,createdAt:new Date(now).toISOString()}};
  const receipt=async id=>read_state(delivery_key(ctx.scope,id));`+body;
  const r=spawnSync(process.execPath,['--eval',code],{env:{...process.env,TIBO_CONFIG_FILE:'/dev/null',TIBO_STATE_DIR:dir,DEEPSEEK_API_KEY:'fixture-key',TIBO_AI_FEATURES:features,TIBO_LARK_APP_ID:'fixture',TIBO_LARK_DOMAIN:'lark'},encoding:'utf8',timeout:10000,maxBuffer:2000000});
  expect(r.status,r.stderr).toBe(0);return JSON.parse(r.stdout);
 }finally{await rm(dir,{recursive:true,force:true});}
}
test('the prayer runs while projection delivery is blocked; the forecast starts only after confirmation, and replay repeats nothing',async()=>{
 const r=await trial(`let release;const gate=new Promise(r=>release=r);const send=client.send;client.send=async b=>{if(b.content.includes('重置神谕'))await gate;return send(b)};
 const j=job('请给我一次重置吧！🙏',undefined,{...ctx,conversationType:'group'});const work=process_interaction(client,j);
 for(let i=0;i<100&&!posts.length;i++)await new Promise(r=>setTimeout(r,2));const before={posts:posts.slice(),network,offers:(await read_state(identity_key)).offers};release();await work;
 const first=posts.slice();await process_interaction(client,j);console.log(JSON.stringify({before,first,posts,root:await receipt(j.key),projection:await receipt(j.key+':content'),forecast:await receipt(j.key+':forecast'),offers:(await read_state(identity_key)).offers}));`);
 expect(r.before.posts).toHaveLength(1);expect(r.before.posts[0]).toContain('**🙏 香客');expect(r.before.network).toBe(0);expect(r.before.offers).toBe(1);
 expect(r.first).toHaveLength(3);expect(r.first[1]).toContain('重置神谕');expect(r.first[1]).toContain('预测');expect(r.first[2]).toContain('Codex 重置预测');expect(r.posts).toEqual(r.first);expect(r.offers).toBe(1);expect(r.root.state).toBe('handled');expect(r.projection.state).toBe('sent');expect(r.forecast.state).toBe('sent');
});
test('reset invocations use the shared cache without another collector or router call',async()=>{
 const r=await trial(`await process_interaction(client,job('请给我重置token额度','om_first'));const before=network;await process_interaction(client,job('重置之神，请赐予我重置吧','om_second'));console.log(JSON.stringify({posts,before,network,model,diagnostics:await read_state('diagnostics-'+ctx.scope),forecast:await receipt('om_second:forecast')}));`);
 expect(r.posts).toHaveLength(4);expect(r.posts.filter(x=>x.includes('Codex 重置预测'))).toHaveLength(2);expect(r.before).toBeGreaterThan(0);expect(r.network).toBe(r.before);expect(r.model).toBe(0);expect(r.forecast.latency.core.collectionMs).toBe(0);
});
test('a confirmed projection survives restart and only its missing forecast resumes',async()=>{
 const r=await trial(`await write_state(delivery_key(ctx.scope,'om_source:content'),{state:'sent',businessOk:true});await process_interaction(client,job('请帮我重置一下'));console.log(JSON.stringify({posts,root:await receipt('om_source'),projection:await receipt('om_source:content'),forecast:await receipt('om_source:forecast')}));`);
 expect(r.posts).toHaveLength(1);expect(r.posts[0]).toContain('Codex 重置预测');expect(r.projection.businessOk).toBe(true);expect(r.forecast.state).toBe('sent');expect(r.root.state).toBe('handled');
});
for(const state of ['suppressed','uncertain','failed-before-send','sent'])test(`a ${state==='sent'?'business failure':state} projection cannot launch a forecast, but prayer still completes`,async()=>{
 const r=await trial(`await write_state(delivery_key(ctx.scope,'om_source:content'),{state:${JSON.stringify(state)},businessOk:false});await process_interaction(client,job('请给我重置token额度🙏'));console.log(JSON.stringify({posts,network,forecast:await receipt('om_source:forecast'),offers:(await read_state(identity_key)).offers}));`);
 expect(r.posts).toHaveLength(1);expect(r.posts[0]).toContain('**🙏 香客');expect(r.network).toBe(0);expect(r.forecast).toBeNull();expect(r.offers).toBe(1);
});
test('model projection remains linked to the forecast and native replies stay in the same topic',async()=>{
 const r=await trial(`ai=async()=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({text:'I am a projection of the Reset God. Only the true deity holds the quota switch.',citation:null})}}]});
 const j=job('Please reset my quota 🙏');j.reference={rootId:'om_root',threadId:'omt_topic'};
 client.messageInfo=async id=>({message_id:id,chat_id:ctx.scope,root_id:'om_root',thread_id:'omt_topic',create_time:String(now-1000),message_position:id===j.key?'2':'1',msg_type:'text',body:{content:JSON.stringify({text:id===j.key?'Please reset my quota':'We are waiting for a reset.'})},sender:{sender_type:'user',id_type:'open_id',id:ctx.actor}});client.historyPage=async()=>({items:[await client.messageInfo('om_root'),await client.messageInfo(j.key)],has_more:false});
 await process_interaction(client,j);const {conversation_key}=await import(${JSON.stringify(root+'/src/chat/store.mjs')});console.log(JSON.stringify({posts,replies,model,forecast:await receipt('om_source:forecast'),conversation:await read_state(conversation_key(ctx,'omt_topic'))}));`,'oracle');
 expect(r.posts).toHaveLength(3);expect(r.posts.some(x=>x.includes('projection of the Reset God'))).toBe(true);expect(r.posts.some(x=>x.includes('forecast')&&x.includes('Reset oracle'))).toBe(true);expect(r.replies).toEqual(Array(3).fill({id:'om_source',thread:true}));expect(r.model).toBe(1);expect(r.forecast.state).toBe('sent');
 const oracle=r.posts.find(x=>x.includes('Reset oracle'));expect(r.conversation.turns.some(x=>x.role==='assistant'&&x.content.includes(JSON.stringify(oracle).slice(1,-1)))).toBe(true);
});
