import {test,expect} from 'bun:test';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {spawnSync} from 'node:child_process';
import {trigger_candidate} from '../../dist/src/im/triggers.mjs';
import {reaction_choice} from '../../dist/src/im/reactions.mjs';
import {evaluate_reply} from '../../dist/src/im/reply-policy.mjs';
import {digest} from '../../dist/src/im/context.mjs';
const root=resolve('dist');
const ctx={transport:'lark',account:'fixture-account',scope:'oc_allowed',actor:'ou_member',conversationType:'group',authenticated:true};
async function trial(code){const dir=await mkdtemp(join(tmpdir(),'tibo-reaction-replies-'));try{const r=spawnSync(process.execPath,['--eval',code],{env:{...process.env,TIBO_CONFIG_FILE:'/dev/null',TIBO_STATE_DIR:dir,TIBO_AI_FEATURES:'trigger,answer',DEEPSEEK_API_KEY:'fixture-private-key',TIBO_LARK_APP_ID:'fixture-app',TIBO_LARK_DOMAIN:'lark'},encoding:'utf8',timeout:8000});expect(r.status,r.stderr).toBe(0);return JSON.parse(r.stdout);}finally{await rm(dir,{recursive:true,force:true});}}
test('low-priority words form a third layer; reset stays secondary; unrelated and private meanings never trigger',()=>{
 for(const q of ['Codex真好用','token和AI编程模型','agent编程卡住了','额度限流了怎么办'])expect(trigger_candidate(q,false,false).level).toBe(3);
 expect(trigger_candidate('重置了！',false,false).level).toBe(2);expect(trigger_candidate('Codex重置概率？',false,false).level).toBe(2);
 for(const q of ['密码重置了','Claude Monet画家','房地产agent','JWT token','今晚吃什么'])expect(trigger_candidate(q,false,false)).toBeNull();
 expect(trigger_candidate('agent 🙏',false,false).level).toBe(1);
});
test('reactions require meaningful relatedness, respect AI rejection and avoid private/tragic text',()=>{
 expect(reaction_choice('Anthropic编程模型',{accepted:false,method:'local',reason:'below-threshold'})).toBe('SMILE');
 expect(reaction_choice('Codex发布上线了',{accepted:true})).toBe('THUMBSUP');
 expect(reaction_choice('token AI编程',{accepted:true})).toBe('OK');
 for(const q of ['agent','重置路由器','你的API key是什么','Codex讨论里有人去世了'])expect(reaction_choice(q,{accepted:true})).toBeNull();
 expect(reaction_choice('Anthropic编程模型',{accepted:false,method:'ai',reason:'below-threshold'})).toBeNull();
});
test('reaction capacity is independent of speech; short spacing and room/person caps still bound it',()=>{
 const now=Date.now(),row={id:'a',at:now-1000,actor:'other',kind:'reaction',topics:['codex'],state:'sent'};
 expect(evaluate_reply([row],ctx,'reaction','token编程',now,0).reason).toBe('reaction-spacing');
 expect(evaluate_reply([{...row,at:now-16000}],ctx,'reaction','Codex不错',now,0).reason).toBe('reaction-topic');
 expect(evaluate_reply([{...row,at:now-21000}],ctx,'reaction','Codex不错',now,0).accepted).toBe(true);
 expect(evaluate_reply([{...row,at:now-16000}],ctx,'reaction','token编程',now,0).accepted).toBe(true);
 expect(evaluate_reply([{...row,at:now-16000,actor:digest(ctx.actor)}],ctx,'reaction','token编程',now,0).reason).toBe('reaction-person');
 expect(evaluate_reply([{...row,at:now-31000,actor:digest(ctx.actor)}],ctx,'reaction','token编程',now,0).accepted).toBe(true);
 expect(evaluate_reply(Array.from({length:4},(_,i)=>({...row,at:now-(i+1)*31000,actor:digest(ctx.actor)})),ctx,'reaction','token编程',now,0).reason).toBe('reaction-person-budget');
 expect(evaluate_reply(Array.from({length:12},(_,i)=>({...row,at:now-(i+1)*21000})),ctx,'reaction','token编程',now,0).reason).toBe('reaction-budget');
 expect(evaluate_reply(Array.from({length:6},(_,i)=>({...row,kind:'direct',id:String(i)})),ctx,'reaction','token编程',now,0).accepted).toBe(true);
 expect(evaluate_reply(Array.from({length:12},(_,i)=>({...row,id:String(i)})),ctx,'direct','help',now,0).accepted).toBe(true);
 expect(evaluate_reply([row],ctx,'ambient','Claude编程怎么样',now,0).accepted).toBe(true);
});
test('suppressed read queries and relevant discussions become reactions without executing queries or administrative writes',async()=>{
 const r=await trial(`let now=Date.now();Date.now=()=>now;let ai=0;globalThis.fetch=async()=>{ai++;throw Error('must not fetch')};const {process_interaction}=await import(${JSON.stringify(root+'/adapters/lark/interaction.mjs')});const {delivery_key}=await import(${JSON.stringify(root+'/adapters/lark/service.mjs')});const {read_state}=await import(${JSON.stringify(root+'/src/platform/state.mjs')});let sends=0,reacts=[];const client={send:async()=>({code:0,data:{message_id:'om_help'+(++sends)}}),react:async(id,emoji)=>{reacts.push({id,emoji});return 'reaction-'+id}};const context=${JSON.stringify(ctx)};const job=(key,command,i=0)=>({group:context.scope,key,command,triggerLevel:1,context:{...context,actor:'ou_person'+i},createdAt:new Date(now).toISOString()});for(let i=0;i<6;i++)await process_interaction(client,job('om_help'+i,'help',i));await process_interaction(client,job('om_forecast','forecast',6));await process_interaction(client,job('om_write','clear-history',7));await process_interaction(client,job('om_subscribe','subscribe',8));now+=16000;await process_interaction(client,job('om_related','Claude编程模型好用吗？',9));const receipts=await Promise.all(['om_forecast','om_write','om_subscribe','om_related'].map(id=>read_state(delivery_key(context.scope,id))));console.log(JSON.stringify({sends,reacts,ai,receipts,ledger:await read_state('ledger'),report:await read_state('report-cli')}));`);
 expect(r.sends).toBe(6);expect(r.reacts).toEqual([{id:'om_forecast',emoji:'OK'},{id:'om_related',emoji:'SMILE'}]);expect(r.ai).toBe(0);expect(r.receipts.map(x=>x.state)).toEqual(['reacted','suppressed','suppressed','reacted']);expect(r.ledger).toBeNull();expect(r.report).toBeNull();
});
test('ongoing ambient discussion uses several light reactions while one text and no AI suffice',async()=>{
 const r=await trial(`let now=Date.now();Date.now=()=>now;let ai=0;globalThis.fetch=async()=>{ai++;throw Error('no model needed')};const {process_interaction}=await import(${JSON.stringify(root+'/adapters/lark/interaction.mjs')});let texts=0,reacts=0;const client={send:async()=>({code:0,data:{message_id:'om_reply'+(++texts)}}),react:async()=>{reacts++;return 'reaction-'+reacts}};const context=${JSON.stringify(ctx)};for(let i=0;i<5;i++){await process_interaction(client,{group:context.scope,key:'om_discussion'+i,command:'Claude编程模型怎么样？'+i,triggerLevel:2,context:{...context,actor:'ou_person'+i},createdAt:new Date(now).toISOString()});now+=21000;}console.log(JSON.stringify({texts,reacts,ai}));`);
 expect(r.texts).toBe(1);expect(r.reacts).toBe(4);expect(r.ai).toBe(0);
});
test('durable inbox sends only one reaction across concurrent low-priority messages and replay, with zero model or text calls',async()=>{
 const r=await trial(`let ai=0;globalThis.fetch=async()=>{ai++;throw Error('no model needed')};const {create_inbox}=await import(${JSON.stringify(root+'/adapters/lark/inbox.mjs')});const {delivery_key}=await import(${JSON.stringify(root+'/adapters/lark/service.mjs')});const{read_state}=await import(${JSON.stringify(root+'/src/platform/state.mjs')});let reacts=[],sends=0;const client={react:async(id,emoji)=>{reacts.push({id,emoji});return 'reaction-'+id},send:async()=>{sends++;throw Error('no text')}};const inbox=await create_inbox(client,['oc_allowed']);const context=${JSON.stringify(ctx)};const jobs=Array.from({length:20},(_,i)=>({group:'oc_allowed',key:'om_low'+i,command:'Codex真好用',triggerLevel:3,triggerKind:'low-priority',context:{...context,actor:'ou_member'+i},createdAt:new Date().toISOString()}));await Promise.all(jobs.map(j=>inbox.accept(j)));for(let i=0;i<500&&inbox.status().pending;i++)await new Promise(r=>setTimeout(r,5));await inbox.accept(jobs[0]);for(let i=0;i<100&&inbox.status().pending;i++)await new Promise(r=>setTimeout(r,5));await inbox.stop();console.log(JSON.stringify({reacts,sends,ai,receipt:await read_state(delivery_key('oc_allowed','om_low0')),pending:inbox.status().pending}));`);
 expect(r.reacts).toHaveLength(1);expect(r.reacts[0].emoji).toBe('OK');expect(r.sends).toBe(0);expect(r.ai).toBe(0);expect(r.pending).toBe(0);expect(r.receipt.state).toBe('reacted');
});
test('fixed native API validates IDs and emoji, checks response, and failed reactions cool for ten minutes without leaked errors or repeated sends',async()=>{
 const r=await trial(`let now=Date.now();Date.now=()=>now;let attempts=0,requests=[];globalThis.fetch=async(u,o)=>{requests.push({url:String(u),body:JSON.parse(o.body)});if(String(u).includes('/auth/'))return new Response(JSON.stringify({code:0,expire:7200,tenant_access_token:'private-access-token'}));attempts++;return new Response(JSON.stringify({code:99991672,msg:'fixture-private-key /Users/private',data:{}}))};const {create_client}=await import(${JSON.stringify(root+'/adapters/lark/api.mjs')});const {process_interaction}=await import(${JSON.stringify(root+'/adapters/lark/interaction.mjs')});const {delivery_key}=await import(${JSON.stringify(root+'/adapters/lark/service.mjs')});const {read_state}=await import(${JSON.stringify(root+'/src/platform/state.mjs')});const client=create_client('fixture-app','fixture-secret','lark');let invalid=0;for(const args of [['https://bad','OK'],['om_safe','rm -rf /']])try{await client.react(...args)}catch{invalid++}const job={group:'oc_allowed',key:'om_one',command:'Codex真好用',triggerLevel:3,context:${JSON.stringify(ctx)},createdAt:new Date(now).toISOString()};await process_interaction(client,job);now+=121000;await process_interaction(client,{...job,key:'om_two',command:'token AI编程',context:{...job.context,actor:'ou_other'},createdAt:new Date(now).toISOString()});console.log(JSON.stringify({invalid,attempts,requests,receipt:await read_state(delivery_key('oc_allowed','om_one'))}));`);
 expect(r.invalid).toBe(2);expect(r.attempts).toBe(1);expect(r.requests[1]).toEqual({url:'https://open.larksuite.com/open-apis/im/v1/messages/om_one/reactions',body:{reaction_type:{emoji_type:'OK'}}});expect(r.receipt.state).toBe('reaction-unavailable-or-uncertain');expect(JSON.stringify(r.receipt)).not.toMatch(/fixture-private-key|private-access-token|\/Users\/|99991672/);
});
