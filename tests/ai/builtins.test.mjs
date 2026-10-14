import {test,expect} from 'bun:test';import {spawnSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';
import {calculate} from '../../dist/src/capabilities/calculate.mjs';
import {validate_plan} from '../../dist/src/commands/chat-plan.mjs';
import {clock_at,date_difference,convert_unit} from '../../dist/src/capabilities/general.mjs';
import {search_results,public_link_QMARK_ as publicLink} from '../../dist/src/evidence/web-search.mjs';
async function trial(code,features='answer,read'){
 const dir=await mkdtemp(join(tmpdir(),'tibo-builtins-'));
 try{const r=spawnSync(process.execPath,['--eval',code],{env:{...process.env,TIBO_CONFIG_FILE:join(dir,'absent.env'),TIBO_STATE_DIR:dir,TIBO_AI_FEATURES:features,DEEPSEEK_API_KEY:'fixture-answer-key'},encoding:'utf8',timeout:10000});expect(r.status,r.stderr).toBe(0);return JSON.parse(r.stdout);}
 finally{await rm(dir,{recursive:true,force:true});}
}
const path=name=>JSON.stringify(resolve('dist/src/'+name+'.mjs'));
const status={status:{description:'Partial System Outage'},components:[{name:'API',status:'major_outage'},{name:'Codex',status:'operational'}],incidents:[{name:'Elevated API errors',status:'investigating',shortlink:'https://status.openai.com/',updated_at:'2026-10-14T01:00:00Z'}]};
test('numeric parser handles precedence, unary signs and powers; invalid code, bounds and malformed inputs never evaluate',()=>{
 for(const [expression,value] of [['(123+456)*7',4053],['-2^2',-4],['2**3**2',512],['2^-2',0.25],['1e3/4',250],['10%3',1]])expect(calculate(expression)).toBe(value);
 for(const expression of ['1 2+3','1/0','process.exit(0)','1;2','2^1001','1+'.repeat(130)+'1','('.repeat(33)+'1'+')'.repeat(33),'2+'])expect(()=>calculate(expression)).toThrow();
});
test('read plans validate the entire batch and deterministic general methods reject invalid data',()=>{
 const evidence={question:'service request'};
 const scope={subject:'service',source:'current',quote:evidence.question};
 const plan=queries=>({topic:'service',scope,queries});
 expect(validate_plan(plan([{command:'service-history',args:{limit:2}}]),null,evidence).queries[0].args.days).toBe(14);
 for(const q of [{command:'ask',args:{question:'exec'}},{command:'pray',args:{}},{command:'clear-history',args:{}},{command:'time',args:{timezone:'Invalid/Zone'}},{command:'convert',args:{value:'1',from:'kg',to:'m'}},{command:'calculate',args:{expression:'process.exit(0)'}},{command:'search',args:{query:'https://localhost/x'}}])expect(()=>validate_plan(plan([{command:'service-status',args:{}},q]),null,evidence)).toThrow();
 expect(()=>validate_plan(plan([{command:'service-status',args:{}},{command:'service-status',args:{}}]),null,evidence)).toThrow();
 expect(()=>validate_plan(plan([{command:'history',args:{}}]),'service',evidence)).toThrow();
 const switchPlan={topic:'switch',scope:{subject:'tibo',source:'current',quote:'Codex reset'},queries:[{command:'history',args:{}}]};
 expect(validate_plan(switchPlan,'service',{question:'Check Codex reset history'}).scope.subject).toBe('tibo');
 expect(()=>validate_plan(switchPlan,'service',{question:'Expand the history'})).toThrow();
 expect(convert_unit('1','GiB','MiB').result).toBe(1024);expect(convert_unit('32','F','C').result).toBe(0);
 expect(date_difference('2026-10-14','2026-10-16').days).toBe(2);expect(()=>date_difference('2026-02-30','2026-03-01')).toThrow();
 expect(clock_at('Asia/Shanghai','2026-10-14T00:00:00Z').local).toBe('2026-10-14 08:00:00');
});
test('RSS and HTML results are bounded public citations; technical verification vocabulary is not a page gate',()=>{
 const rss='<rss><channel><item><title><![CDATA[Public CAPTCHA documentation]]></title><link>https://docs.example.com/captcha?a=1&amp;b=2</link><description><![CDATA[How verification works.]]></description></item><item><title>Private</title><link>http://127.0.0.1/x</link></item></channel></rss>';
 expect(search_results(rss,'bing')[0]).toMatchObject({title:'Public CAPTCHA documentation',url:'https://docs.example.com/captcha?a=1&b=2',provenance:'search-summary'});
 expect(search_results('<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fdocs.example.com%2Fguide">Public guide</a>', 'duckduckgo')[0].url).toBe('https://docs.example.com/guide');
 expect(search_results('<a href="/url?q=https%3A%2F%2Fdocs.example.com%2Fguide">Public documentation</a>','google')[0].url).toBe('https://docs.example.com/guide');
 expect(()=>search_results('<title>百度安全验证</title>','baidu')).toThrow();expect(publicLink('https://localhost/x')).toBe(false);
});
test('unavailable Google/Baidu fall back to RSS; concurrent/repeated searches share only fixed provider requests and never fetch result pages',async()=>{
 const d=await trial('const calls=[];globalThis.fetch=async u=>{calls.push(String(u));await new Promise(r=>setTimeout(r,10));return new Response(String(u).includes("bing.com")?'+JSON.stringify('<rss><channel><item><title>Public topic guide</title><link>https://docs.example.com/guide</link><description>Summary evidence.</description></item></channel></rss>')+':String(u).includes("google.com")?"<html>/httpservice/retry/enablejs</html>":"<title>百度安全验证</title>")};const {search_web}=await import('+path('evidence/web-search')+');const results=await Promise.all([search_web("public topic"),search_web("public topic")]);const repeat=await search_web("public topic");console.log(JSON.stringify({calls,results,repeat}));');
 expect(d.calls).toHaveLength(4);expect(d.results.every(r=>r.state==='ok')).toBe(true);expect(d.repeat.results).toHaveLength(1);
 expect(d.calls.some(u=>u.startsWith('https://docs.example.com'))).toBe(false);
});
test('quoted followup has one semantic read plan and one answer, with no tools or repeated dispatch',async()=>{
 const d=await trial('const prompts=[],calls=[];globalThis.fetch=async(u,o)=>{calls.push(String(u));if(String(u).includes("status.openai.com"))return Response.json('+JSON.stringify(status)+');const b=JSON.parse(o.body);prompts.push(b);const plan=b.max_tokens===600;return Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify(plan?{topic:"OpenAI API service status",scope:{subject:"service",source:"current",quote:JSON.parse(b.messages.at(-1).content).question},queries:[{command:"service-status",args:{}}]}:{text:"官方状态显示 API 出现故障。https://status.openai.com/"})}}]});};const {execute_query}=await import('+path('commands/index')+');const r=await execute_query({command:"ask",args:{question:"把刚才那份状态展开看看"}},{threadConversation:{state:"ready",messages:[{role:"assistant",content:"OpenAI API状态，可检查API key余额或官方状态页。"}]}});console.log(JSON.stringify({calls,prompts,r}));');
 expect(d.calls).toHaveLength(3);expect(d.prompts).toHaveLength(2);expect(d.prompts[0].max_tokens).toBe(600);
 expect(JSON.parse(d.prompts[0].messages.at(-1).content).history[0].content).toContain('API key余额');
 for(const p of d.prompts){expect(p.tools).toBeUndefined();expect(p.functions).toBeUndefined();expect(p.function_call).toBeUndefined();}
 const facts=JSON.parse(d.prompts[1].messages.at(-1).content).builtinFacts;
 expect(facts.reads[0].data.components[0].status).toBe('major_outage');expect(d.r.text).toContain('官方状态显示 API');
});
test('failed final answer preserves fixed data; bad plans cannot fetch, mutate, or start a tool loop',async()=>{
 const d=await trial('const calls=[];globalThis.fetch=async(u,o)=>{calls.push(String(u));if(String(u).includes("status.openai.com"))return Response.json('+JSON.stringify(status)+');const b=JSON.parse(o.body);return Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify(b.max_tokens===600?{topic:"OpenAI",scope:{subject:"service",source:"current",quote:JSON.parse(b.messages.at(-1).content).question},queries:[{command:"service-status",args:{}}]}:{text:""})}}]});};const {execute_query}=await import('+path('commands/index')+');const calc=await execute_query({command:"calculate",args:{expression:"(123+456)*7"}},{noAi:true});const live=await execute_query({command:"ask",args:{question:"把状态拉下来"}},{threadConversation:{messages:[{role:"user",content:"OpenAI API故障"}]}});const before=calls.length;const off=await execute_query({command:"service-status",args:{}},{offline:true,noAi:true});console.log(JSON.stringify({calc,live,off,before,calls}));');
 expect(d.calc.text).toBe('(123+456)*7 = 4053');expect(d.live.text).toContain('major_outage');expect(d.calls).toHaveLength(d.before);expect(d.off.ok).toBe(false);
});
test('service status reads are shared, cache their collection time and recover from transport failure',async()=>{
 const d=await trial('let now=Date.now();Date.now=()=>now;let calls=0,broken=false;globalThis.fetch=async()=>{calls++;if(broken)throw Error("private supplier failure");return Response.json('+JSON.stringify(status)+')};const {service_status}=await import('+path('evidence/service-status')+');const a=await Promise.all([service_status(),service_status(),service_status()]);now+=60001;broken=true;const bad=await service_status();const cached=await service_status();now+=30001;broken=false;const recovered=await service_status();console.log(JSON.stringify({a,bad,cached,recovered,calls}));');
 expect(d.calls).toBe(3);expect(new Set(d.a.map(x=>x.at)).size).toBe(1);expect(d.bad.state).toBe('unavailable');expect(d.cached.cached).toBe(true);expect(d.recovered.state).toBe('ok');expect(JSON.stringify(d.bad)).not.toContain('supplier');
});

test('status and history share the fixed incident feed, retaining resolved history and collection time',async()=>{
 const summary={status:{description:'All Systems Operational'},components:[{name:'API',status:'operational'}]};
 const d=await trial('let calls=0;globalThis.fetch=async u=>{calls++;return Response.json(String(u).endsWith("summary.json")?'+JSON.stringify(summary)+':{incidents:[{name:"Old outage",status:"resolved",created_at:new Date().toISOString(),incident_updates:[{body:"Restored",status:"resolved"}]}]});};const {service_status,service_history}=await import('+path('evidence/service-status')+');const status=await service_status();const history=await service_history(3,14);console.log(JSON.stringify({calls,status,history}));');
 expect(d.calls).toBe(2);expect(d.status.incidents).toEqual([]);expect(d.history.incidents[0].status).toBe('resolved');expect(d.history.coverage).toBe('latest-official-page');
});
test('fixed general commands work without AI; unknown natural phrasing does not use keyword guessing',async()=>{
 const d=await trial('let calls=0;globalThis.fetch=async()=>{calls++;throw Error("unexpected network")};const {resolve_query,execute_query}=await import('+path('commands/index')+');const math=await resolve_query("calculate (123+456)*7",null,{noAi:true});const r=await execute_query(math,{noAi:true});const natural=await resolve_query("帮我计算一下",null,{noAi:true});console.log(JSON.stringify({r,natural,calls}));','');
 expect(d.r.text).toBe('(123+456)*7 = 4053');expect(d.natural.command).toBe('semantic-disabled');expect(d.calls).toBe(0);
});

test('empty plans do no source I/O, read has an independent failure circuit, and a blocked read does not disable ordinary chat',async()=>{
 const d=await trial('const prompts=[];globalThis.fetch=async(u,o)=>{const b=JSON.parse(o.body);prompts.push(b);return Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify(b.max_tokens===600?{topic:"chat",queries:[{command:"clear-history",args:{}}]}:{text:"我们可以继续讨论闭包。"})}}]});};const {execute_query}=await import('+path('commands/index')+');const {ai_status}=await import('+path('ai/runtime')+');const rows=[];for(const question of ["解释概念甲","解释概念乙","解释概念丙"])rows.push(await execute_query({command:"ask",args:{question}}));console.log(JSON.stringify({rows,prompts,status:await ai_status()}));');
 expect(d.prompts.filter(p=>p.max_tokens===600)).toHaveLength(2);expect(d.prompts.filter(p=>p.max_tokens===1200)).toHaveLength(3);
 expect(d.rows.every(r=>r.text.includes('继续讨论闭包'))).toBe(true);expect(d.status.circuit.features.read.until).toBeGreaterThan(Date.now());expect(d.status.circuit.features.answer?.until||0).toBe(0);
});
test('bad entire batch and provider tool calls cannot dispatch any read or repeated plan',async()=>{
 const d=await trial('const calls=[];globalThis.fetch=async(u,o)=>{calls.push(String(u));const b=JSON.parse(o.body);return Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify(b.max_tokens===600?{topic:"bad",scope:{subject:"service",source:"current",quote:JSON.parse(b.messages.at(-1).content).question},queries:[{command:"service-status",args:{}},{command:"calculate",args:{expression:"process.exit(0)"}}]}:{text:"此次查询未准备成功。"})}}]});};const {execute_query}=await import('+path('commands/index')+');const r=await execute_query({command:"ask",args:{question:"展示刚才的数据"}});console.log(JSON.stringify({calls,r}));');
 expect(d.calls).toHaveLength(2);expect(d.calls.every(u=>u.includes('/chat/completions'))).toBe(true);expect(d.r.text).toContain('未准备成功');
});
test('semantic planning receives the direct quote and typed prior methods, while unquoted calls have no historical input',async()=>{
 const d=await trial('const prompts=[];globalThis.fetch=async(u,o)=>{const b=JSON.parse(o.body);prompts.push(b);return Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify(b.max_tokens===600?{topic:"service",queries:[]}:{text:"解释当前记录。"})}}]});};const {execute_query}=await import('+path('commands/index')+');const thread={state:"ready",quotedMessage:{role:"assistant",content:"此前API正常。"},messages:[{role:"user",content:JSON.stringify({question:"查API状态",builtinFacts:{topic:"service",reads:[{method:"service-status"}]}})},{role:"assistant",content:"API正常，也可以查看其他业务。"}]};await execute_query({command:"ask",args:{question:"解释这份记录"}},{threadConversation:thread});await execute_query({command:"ask",args:{question:"解释那份记录"}});console.log(JSON.stringify(prompts));');
 const first=JSON.parse(d[0].messages.at(-1).content),plain=JSON.parse(d[2].messages.at(-1).content);
 expect(first.quotedMessage.content).toBe('此前API正常。');expect(first.history[0].content).toContain('service-status');expect(plain.history).toEqual([]);expect(plain.quotedMessage).toBeNull();
});

test('confirmed read subject survives compaction and takes precedence over old unrelated suggestions',async()=>{
 const d=await trial('const prompts=[];globalThis.fetch=async(u,o)=>{const b=JSON.parse(o.body);prompts.push(b);return Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify(b.max_tokens===600?{topic:"service",queries:[]}:{text:"解释这份服务资料。"})}}]});};const {conversation_key,commit_turn,read_session,compact_session}=await import('+path('chat/store')+');const ctx={transport:"probe",account:"fixture",scope:"dialogue",authenticated:true},key=conversation_key(ctx,"topic");await commit_turn({key,revision:0,sourceId:"question",user:{role:"user",content:"查询"},assistant:"回答",readSubject:"service"},"response");const saved=await read_session(key);await compact_session(key,saved.revision,"Prior service data.");const compacted=await read_session(key);const {execute_query}=await import('+path('commands/index')+');const result=await execute_query({command:"ask",args:{question:"解释这份记录"}},{threadConversation:{activeSubject:compacted.readSubject,messages:[{role:"user",content:JSON.stringify({builtinFacts:{reads:[{method:"history",state:"ok"}]}})}]}});console.log(JSON.stringify({compacted,prompts,result}));');
 expect(d.compacted.readSubject).toBe('service');expect(d.prompts.length,JSON.stringify(d.result)).toBeGreaterThan(0);expect(JSON.parse(d.prompts[0].messages.at(-1).content).activeSubject).toBe('service');
});

test('a first followup has one grounded subject; assistant references cannot authorize cross-topic reads or a subject switch',()=>{
 const quote={role:'assistant',content:'The API status is unknown. If you meant Tibo instead, we could check its posts.'};
 const evidence={question:'Please check',quotedMessage:quote,history:[{role:'assistant',content:'Check the reset history'}]};
 const scope={subject:'service',source:'quoted',quote:''};
 const p={topic:'API availability',scope,queries:[{command:'service-status',args:{}}]};
 const validated=validate_plan(p,null,evidence);
 expect(validate_plan(validated,null,evidence)).toEqual(validated); // cache hits are revalidated
 expect(()=>validate_plan({...p,queries:[...p.queries,{command:'posts',args:{}}]},null,evidence)).toThrow('read-plan-subject-mismatch');
 expect(()=>validate_plan({...p,scope:{...scope,subject:'mixed'}},null,evidence)).toThrow('read-plan-mixed-authority');
 expect(()=>validate_plan({...p,scope:{...scope,subject:'tibo'},queries:[{command:'posts',args:{}}]},'service',evidence)).toThrow('read-plan-scope-change');
 expect(()=>validate_plan({...p,scope:{subject:'tibo',source:'user-history',quote:'Check the reset history'},queries:[{command:'history',args:{}}]},null,evidence)).toThrow('read-plan-scope-evidence');
 expect(()=>validate_plan(p,null,{question:'Please check'})).toThrow('read-plan-quoted');
 const explicit={...p,scope:{subject:'mixed',source:'current',quote:'API status and Tibo posts'},queries:[...p.queries,{command:'posts',args:{limit:1}}]};
 expect(validate_plan(explicit,'service',{question:'Check API status and Tibo posts'}).queries).toHaveLength(2);
 expect(()=>validate_plan(explicit,'service',evidence)).toThrow('read-plan-scope-evidence');
});

test('confirmed user scope wins over method order; mixed or failed reads cannot create a new confirmed topic',async()=>{
 const {active_subject,confirmed_subject}=await import('../../dist/src/commands/chat-plan.mjs');
 const reads=[{method:'service-status',state:'ok'},{method:'posts',state:'ok'}];
 expect(confirmed_subject({subject:'service',reads})).toBe('service');
 expect(confirmed_subject({reads})).toBeNull();
 expect(confirmed_subject({scope:{subject:'mixed'},reads})).toBeNull();
 expect(confirmed_subject({subject:'service',reads:[{method:'service-status',state:'unavailable'}]})).toBeNull();
 const turn={role:'user',content:JSON.stringify({builtinFacts:{subject:'service',reads}})};
 expect(active_subject({messages:[turn]})).toBe('service');
 expect(active_subject({activeSubject:'tibo',messages:[turn]})).toBe('tibo');
});

test('the three-turn service followup performs only official service reads; repeating a plan uses its revalidated cache',async()=>{
 const code=`const prompts=[],sources=[];let stage=0;
 globalThis.fetch=async(u,o)=>{if(String(u).includes('status.openai.com')){sources.push(String(u));return Response.json(String(u).endsWith('summary.json')?${JSON.stringify(status)}:{incidents:[{name:'Resolved API issue',status:'resolved',created_at:new Date().toISOString()}]});}
 const b=JSON.parse(o.body);prompts.push(b);const input=JSON.parse(b.messages.at(-1).content);
 const plan={topic:'OpenAI service',scope:{subject:'service',source:stage?'inherited':'quoted',quote:''},queries:stage===1?[{command:'service-status',args:{}},{command:'service-history',args:{limit:2}}]:[{command:'service-status',args:{}}]};
 return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(b.max_tokens===600?plan:{text:'The official service data is ready.'})}}]});};
 const {execute_query}=await import(${path('commands/index')});const {plan_reads}=await import(${path('commands/chat-plan')});
 const thread={state:'ready',quotedMessage:{role:'assistant',content:'OpenAI API status is unknown. Optionally we could check Tibo posts.'},messages:[]};
 const firstPlan=await plan_reads('Can you check?',thread);const cached=await plan_reads('Can you check?',thread);
 const rows=[];for(const question of ['Can you check?','Give me a tidy service history','Download that status data']){
 const r=await execute_query({command:'ask',args:{question}},{threadConversation:thread});rows.push(r);
 const answerPrompt=prompts.at(-1),wire=JSON.parse(answerPrompt.messages.at(-1).content);
 thread.messages.push({role:'user',content:JSON.stringify(wire)},{role:'assistant',content:'The service data is ready. Optionally we could check Tibo posts.'});
 thread.quotedMessage=thread.messages.at(-1);stage++;}
 console.log(JSON.stringify({prompts,sources,rows,firstPlan,cached}));`;
 const d=await trial(code);expect(d.firstPlan.state).toBe('ok');expect(d.cached.state).toBe('cached');
 expect(d.prompts.filter(p=>p.max_tokens===600)).toHaveLength(3);
 const answers=d.prompts.filter(p=>p.max_tokens===1200).map(p=>JSON.parse(p.messages.at(-1).content));
 expect(answers.map(p=>p.builtinFacts.reads.map(r=>r.method))).toEqual([['service-status'],['service-status','service-history'],['service-status']]);
 expect(answers.every(p=>p.builtinFacts.scope.subject==='service')).toBe(true);
 expect(d.sources).toHaveLength(2);expect(d.rows.every(r=>r.ok)).toBe(true);
 for(const p of d.prompts)expect(p.tools).toBeUndefined();
});

test('incomplete reference history cannot trigger a guessed read plan or source fetch',async()=>{
 const d=await trial('let calls=0;globalThis.fetch=async()=>{calls++;throw Error("unexpected I/O")};const {execute_query}=await import('+path('commands/index')+');const rows=[];for(const state of ["partial","unavailable"])rows.push(await execute_query({command:"ask",args:{question:"Show that data"}},{threadConversation:{state,messages:[]}}));console.log(JSON.stringify({rows,calls}));');
 expect(d.calls).toBe(0);expect(d.rows.every(r=>r.ok===false)).toBe(true);
});
