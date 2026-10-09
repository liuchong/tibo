import {test,expect} from 'bun:test';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {spawnSync} from 'node:child_process';
import {evaluate_reply} from '../../dist/src/im/reply-policy.mjs';
import {digest} from '../../dist/src/im/context.mjs';
const root=resolve('dist'),ctx={transport:'future-im',account:'private-account',scope:'private-room',actor:'private-person',authenticated:true,conversationType:'group'};
const now=Date.parse('2026-10-06T00:00:00Z');
const row=(ago,kind='ambient',actor='another-person',topics=['claude'])=>({at:now-ago,kind,actor:digest(actor),content:digest('other text'),topics,state:'sent'});
async function trial(body,setup='',features=''){
 const dir=await mkdtemp(join(tmpdir(),'tibo-reply-policy-'));try{
  const code=`${setup};let now=${now};Date.now=()=>now;const ctx=${JSON.stringify(ctx)};const {reply_permit,settle_reply}=await import(${JSON.stringify(root+'/src/im/reply-policy.mjs')});const {remember_message,conversation_context,room_key}=await import(${JSON.stringify(root+'/src/im/context.mjs')});const {read_state,write_state}=await import(${JSON.stringify(root+'/src/platform/state.mjs')});${body}`;
  const r=spawnSync(process.execPath,['--eval',code],{env:{...process.env,TIBO_CONFIG_FILE:'/dev/null',TIBO_STATE_DIR:dir,TIBO_AI_FEATURES:features,DEEPSEEK_API_KEY:'private-provider-key'},encoding:'utf8',timeout:8000});expect(r.status,r.stderr).toBe(0);return JSON.parse(r.stdout);
 }finally{await rm(dir,{recursive:true,force:true});}
}
test('pacing separates global, person, topic and busy-room budgets from relevance and explicit requests',()=>{
 const check=(rows,kind='ambient',text='Claude编程怎么样？',activity=0)=>evaluate_reply(rows,ctx,kind,text,now,activity);
 expect(check([row(10000)]).reason).toBe('ambient-spacing');
 expect(check([row(180000)]).reason).toBe('topic-spacing');
 expect(check([row(180000,'ambient',ctx.actor)],'ambient','GPT模型怎么样？').reason).toBe('ambient-person');
 expect(check([row(180000)],'ambient','GPT模型怎么样？').accepted).toBe(true);
 expect(check([row(180000)],'ambient','GPT模型怎么样？',12).reason).toBe('busy-room');
 expect(check([row(10000)],'direct','tibo Claude怎么样？').accepted).toBe(true);
 expect(check([row(10000,'direct')]).reason).toBe('direct-conversation');
 expect(check([row(550000),row(310000)]).reason).toBe('ambient-budget');
 expect(check(Array.from({length:6},(_,i)=>row((i+1)*540000))).reason).toBe('ambient-budget');
 expect(check(Array.from({length:6},()=>row(1000,'direct')),'direct').reason).toBe('room-budget');
 expect(check(Array.from({length:3},()=>row(1000,'direct',ctx.actor)),'direct').reason).toBe('person-budget');
});
test('concurrent persisted reservations and exact no-send releases cannot exceed a shared room budget',async()=>{
 const r=await trial(`const accepted=await Promise.all(Array.from({length:12},(_,i)=>reply_permit({...ctx,actor:'person'+i},'event'+i,'direct','help '+i,0,true)));const before=await read_state(room_key('im-replies-',ctx));const replay=await reply_permit({...ctx,actor:'person0'},'event0','direct','help 0',0,true);await settle_reply(ctx,'event0','uncertain');const unknown=await reply_permit(ctx,'unknown','direct','help unknown',0,true);await settle_reply(ctx,'event0','rejected');const released=await reply_permit(ctx,'released','direct','help released',0,true);const other=await reply_permit({...ctx,scope:'other-room'},'other','direct','help',0,true);console.log(JSON.stringify({accepted,before,replay,unknown,released,other,after:await read_state(room_key('im-replies-',ctx))}));`);
 expect(r.accepted.filter(x=>x.accepted)).toHaveLength(6);expect(r.before.replies).toHaveLength(6);expect(r.replay.accepted).toBe(true);expect(r.unknown.accepted).toBe(false);expect(r.released.accepted).toBe(true);expect(r.other.accepted).toBe(true);expect(r.after.replies).toHaveLength(7);
 expect(JSON.stringify(r.after)).not.toMatch(/private-account|private-room|private-person|help released/);
});
test('per-person limits and rolling windows recover without a flush or delayed catch-up',async()=>{
 const r=await trial(`const out=[];for(let i=0;i<4;i++)out.push(await reply_permit(ctx,'person'+i,'direct','help '+i,0,true));now+=60001;const afterMinute=await reply_permit(ctx,'after-minute','direct','help later',0,true);for(let i=0;i<3;i++)await reply_permit({...ctx,actor:'other'+i},'other'+i,'ambient','Claude编程问题'+i,0,true);now+=600001;const afterWindow=await reply_permit(ctx,'after-window','ambient','Claude新问题',0,true);const saved=await read_state(room_key('im-replies-',ctx));console.log(JSON.stringify({out,afterMinute,afterWindow,saved}));`);
 expect(r.out.map(x=>x.accepted)).toEqual([true,true,true,false]);expect(r.out[3].reason).toBe('person-budget');expect(r.afterMinute.accepted).toBe(true);expect(r.afterWindow.accepted).toBe(true);
});
test('group prayer spam is counted once per event, suppressed replies have no AI and replay cannot count twice',async()=>{
 const r=await trial(`const {process_interaction}=await import(${JSON.stringify(root+'/adapters/lark/interaction.mjs')});const {delivery_key}=await import(${JSON.stringify(root+'/adapters/lark/service.mjs')});const {pray}=await import(${JSON.stringify(root+'/src/prayer/pray.mjs')});let sends=0;const context={...ctx,transport:'lark',scope:'oc_prayer'};const client={send:async()=>({code:0,data:{message_id:'om_prayer'+(++sends)}})};for(let i=0;i<12;i++)await process_interaction(client,{group:context.scope,key:'prayer'+i,command:i===11?'pray | translate en':'pray',context});const records=await Promise.all(Array.from({length:12},(_,i)=>read_state(delivery_key(context.scope,'prayer'+i))));const profile=await pray({action:'me'},context,{noAi:true});const {create_inbox}=await import(${JSON.stringify(root+'/adapters/lark/inbox.mjs')});const inbox=await create_inbox(client,[context.scope]);await inbox.accept({group:context.scope,key:'prayer11',command:'pray',triggerKind:'prayer',context});await new Promise(r=>setTimeout(r,10));await inbox.stop();const replay=await pray({action:'me'},context,{noAi:true});console.log(JSON.stringify({sends,records,profile,replay}));`);
 expect(r.sends).toBe(1);expect(r.records.filter(x=>x.state==='suppressed'&&x.prayerRecorded)).toHaveLength(11);expect(r.profile.text).toContain('累计🙏：12');expect(r.replay.text).toBe(r.profile.text);
});
test('conversation capture handles parallel bursts, masks identities, excludes current/future/private messages and bounds history',async()=>{
 const r=await trial(`await Promise.all(Array.from({length:30},(_,i)=>remember_message({...ctx,actor:'person'+i},'history'+i,'Claude编程讨论'+i,new Date(now-10000+i).toISOString())));await remember_message(ctx,'private','API key sk-abcdefghijk',new Date(now-3000).toISOString());await remember_message(ctx,'identity','Claude me@example.com 13812345678 ou_privateIdentifier',new Date(now-2000).toISOString());await remember_message(ctx,'current','Claude当前问题',new Date(now).toISOString());await remember_message(ctx,'same-time-future','Claude排在当前消息后面的',new Date(now).toISOString());await remember_message(ctx,'future','Claude以后才说的',new Date(now+1000).toISOString());await remember_message(ctx,'current','Claude重复重投',new Date(now).toISOString());const history=await conversation_context(ctx,'Claude当前问题','current',new Date(now).toISOString());const other=await conversation_context({...ctx,scope:'different-room'},'Claude','now',new Date(now).toISOString());const store=await read_state(room_key('im-context-',ctx));now+=301001;const expired=await conversation_context(ctx,'Claude','now',new Date(now).toISOString());console.log(JSON.stringify({history,other,expired,count:store.messages.length,traffic:store.traffic.length}));`);
 expect(r.count).toBe(34);expect(r.traffic).toBe(35);expect(r.history.messages).toHaveLength(6);expect(r.history.activity).toBe(35);expect(r.other.messages).toHaveLength(0);expect(r.expired.messages).toHaveLength(0);
 const sent=JSON.stringify(r.history.messages);expect(sent).not.toMatch(/当前问题|当前消息后面|以后才说|重投|API key|sk-abcdefgh|me@example|138123|ou_private|person[0-9]/);expect(r.history.messages.reduce((n,r)=>n+r.text.length,0)).toBeLessThanOrEqual(1000);
});
test('unquoted AI receives only the current question; group activity still controls pacing without conversational memory',async()=>{
 const setup=`let calls=0,prompts=[];globalThis.fetch=async(url,o)=>{calls++;const body=JSON.parse(o.body);prompts.push(JSON.parse(body.messages[1].content));return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({text:'我站ChatGPT，Claude先交代码作业再抢镜。',citation:{id:'news',quote:'A model guide for coding'}})}}]}));};`;
 const r=await trial(`await write_state('oracle-news',{until:now+60000,at:new Date(now).toISOString(),searchEnabled:false,documents:[{id:'news',text:'A model guide for coding',at:new Date(now-1000).toISOString(),url:'https://openai.com/index/guide'}]});await remember_message(ctx,'previous','Claude工具调用的问题还没聊完',new Date(now-1000).toISOString());const {process_interaction}=await import(${JSON.stringify(root+'/adapters/lark/interaction.mjs')});let sends=0;const client={send:async()=>({code:0,data:{message_id:'om_ai'+(++sends)}})};for(let i=0;i<10;i++)await process_interaction(client,{group:ctx.scope,key:'discuss'+i,command:'Claude编程模型好用吗？'+i,triggerLevel:2,context:ctx,createdAt:new Date(now).toISOString()});console.log(JSON.stringify({calls,sends,prompts}));`,setup,'oracle,trigger');
 expect(r.calls).toBe(1);expect(r.sends).toBe(1);expect(r.prompts[0].question).toBe('Claude编程模型好用吗？0');expect(r.prompts[0].conversation).toEqual([]);expect(JSON.stringify(r.prompts)).not.toMatch(/private-account|private-room|private-person|private-provider-key/);
});
