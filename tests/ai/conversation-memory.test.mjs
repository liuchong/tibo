import {test, expect} from 'bun:test';
import {spawnSync} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';

const store=JSON.stringify(resolve('dist/src/chat/store.mjs'));
const chat=JSON.stringify(resolve('dist/src/presentation/chat.mjs'));
const context={transport:'fixture',account:'bot',scope:'room',authenticated:true};
function trial(dir,code,budget='900000'){
 const r=spawnSync(process.execPath,['--eval',code],{env:{...process.env,TIBO_CONFIG_FILE:join(dir,'absent.env'),
  TIBO_STATE_DIR:dir,TIBO_CHAT_CONTEXT_TOKENS:budget,TIBO_AI_FEATURES:'answer',DEEPSEEK_API_KEY:'fixture-memory-key'},
  encoding:'utf8',timeout:10000,maxBuffer:2000000});
 expect(r.status,r.stderr).toBe(0);return JSON.parse(r.stdout);
}
const prelude=`const context=${JSON.stringify(context)};const store=await import(${store});const key=store.conversation_key(context,'root');`;

test('persistent dialogue keeps complete history, exact wire prefixes and both roles across a new process',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'tibo-dialogue-'));
 try{
  const mock=`const sent=[];globalThis.fetch=async(u,o)=>{const body=JSON.parse(o.body);sent.push(body);return Response.json({usage:{prompt_tokens:50000,prompt_cache_hit_tokens:49000},choices:[{finish_reason:'stop',message:{content:'{ "text": "保留完整历史并继续解释。" }'}}]});};`;
  const first=trial(dir,mock+prelude+`await store.import_turns(key,Array.from({length:60},(_,i)=>({id:'m'+i,role:i%2?'assistant':'user',content:'turn '+i+' '+ 'x'.repeat(700)})),10);const {chat_text}=await import(${chat});const r=await chat_text('接着解释','zh',{commands:[]},null,{state:'ready',sessionId:'root',currentId:'q1'},context);const before=await store.read_session(key);await store.commit_turn(r.chatReceipt,'a1');await store.commit_turn(r.chatReceipt,'a1');console.log(JSON.stringify({sent,r,before,after:await store.read_session(key)}));`);
  expect(first.sent).toHaveLength(1);expect(first.sent[0].messages).toHaveLength(62);
  expect(first.before.turns).toHaveLength(60);expect(first.after.turns).toHaveLength(62);
  expect(first.r.usage.cacheHitTokens).toBe(49000);expect(first.sent[0].tools).toBeUndefined();
  const second=trial(dir,mock+prelude+`const {chat_text}=await import(${chat});const r=await chat_text('再讲一个例子','zh',{commands:[]},null,{state:'ready',sessionId:'root',currentId:'q2'},context);await store.commit_turn(r.chatReceipt,'a2');console.log(JSON.stringify({sent,r,after:await store.read_session(key)}));`);
  expect(second.sent[0].messages.slice(0,first.sent[0].messages.length)).toEqual(first.sent[0].messages);
  expect(second.sent[0].messages.at(-2).content).toBe('{ "text": "保留完整历史并继续解释。" }');
  expect(second.after.turns).toHaveLength(64);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('capacity triggers one summary, unloads old turns, then grows from the stable summary prefix',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'tibo-summary-'));
 try{
  const data=trial(dir,`const sent=[];globalThis.fetch=async(u,o)=>{const b=JSON.parse(o.body);sent.push(b);return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(b.max_tokens===2048?{summary:'用户正在理解闭包，已经决定先讲概念，再用具体代码举例。此前明确不要省略捕获变量的说明。'}:{text:'闭包保留其定义时可见的变量。'})}}]});};`+prelude+`await store.import_turns(key,Array.from({length:20},(_,i)=>({id:'m'+i,role:i%2?'assistant':'user',content:'turn '+i+' '+'x'.repeat(700)})),10);const {chat_text}=await import(${chat});const r=await chat_text('举个例子','zh',{commands:[]},null,{state:'ready',sessionId:'root',currentId:'q1'},context);const compacted=await store.read_session(key);await store.commit_turn(r.chatReceipt,'a1');const next=await chat_text('这个变量是什么','zh',{commands:[]},null,{state:'ready',sessionId:'root',currentId:'q2'},context);await store.commit_turn(next.chatReceipt,'a2');console.log(JSON.stringify({sent,r,next,compacted,after:await store.read_session(key)}));`,'8192');
  expect(data.sent.map(b=>b.max_tokens)).toEqual([2048,1200,1200]);
  expect(data.sent[0].messages).toHaveLength(22);expect(data.compacted.turns).toHaveLength(0);
  expect(data.compacted.generation).toBe(1);expect(data.compacted.summary).toContain('捕获变量');
  expect(data.after.turns).toHaveLength(4);expect(data.after.seen).toContain('m0');
  expect(data.sent[2].messages.slice(0,data.sent[1].messages.length)).toEqual(data.sent[1].messages);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('failed summary and incomplete import preserve history and never answer from truncated input',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'tibo-summary-failure-'));
 try{
  const data=trial(dir,`let calls=0;globalThis.fetch=async()=>{calls++;return new Response('private detail',{status:402});};`+prelude+`await store.import_turns(key,Array.from({length:20},(_,i)=>({id:'m'+i,role:'user',content:'x'.repeat(700)})),10);const {chat_text}=await import(${chat});const before=await store.read_session(key);const r=await chat_text('继续','zh',{commands:[]},null,{state:'ready',sessionId:'root',currentId:'q1'},context);const partial=await chat_text('继续','zh',{commands:[]},null,{state:'partial',messages:[]},context);console.log(JSON.stringify({calls,r,partial,before,after:await store.read_session(key)}));`,'8192');
  expect(data.calls).toBe(1);expect(data.r.state).toBe('fallback');expect(data.partial.state).toBe('fallback');
  expect(data.after).toEqual(data.before);expect(JSON.stringify(data.r)).not.toContain('private detail');
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('near-capacity compaction reuses measured token counts instead of rejecting a larger UTF-8 transcript',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'tibo-measured-summary-'));
 try{
  const d=trial(dir,`const budgets=[];globalThis.fetch=async(u,o)=>{const b=JSON.parse(o.body);budgets.push(b.max_tokens);return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(b.max_tokens===2048?{summary:'保留闭包的定义与用户纠正。'}:{text:'词法绑定是核心。'})}}]});};`+prelude+`const {chat_text}=await import(${chat});const {write_state}=await import(${JSON.stringify(resolve('dist/src/platform/state.mjs'))});const seed=await chat_text('解释一下','zh',{commands:[]},null,{state:'ready',sessionId:'root',currentId:'seed'},context);await store.import_turns(key,Array.from({length:25},(_,i)=>({id:'m'+i,role:i%2?'assistant':'user',content:'x'.repeat(42000)})),10);const state=await store.read_session(key);state.checkpoint={system:seed.chatReceipt.system,count:25,tokens:899500};await write_state(key,state);const r=await chat_text('继续','zh',{commands:[]},null,{state:'ready',sessionId:'root',currentId:'q'},context);console.log(JSON.stringify({state:r.state,budgets,generation:(await store.read_session(key)).generation}));`);
  expect(d.state).toBe('ok');expect(d.budgets).toEqual([1200,2048,1200]);expect(d.generation).toBe(1);
 }finally{await rm(dir,{recursive:true,force:true});}
});
