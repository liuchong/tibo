import {test,expect} from 'bun:test';import {spawnSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';
import {calculate} from '../../dist/src/capabilities/calculate.mjs';
import {requests_for,builtin_question_QMARK_ as builtinQuestion} from '../../dist/src/capabilities/read.mjs';
import {search_results,public_link_QMARK_ as publicLink} from '../../dist/src/evidence/web-search.mjs';
async function trial(code,features='answer'){
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
test('followup resolves only its explicit quoted context and public technical vocabulary remains useful',()=>{
 const thread={messages:[{role:'assistant',content:'OpenAI API status is unknown. Check API key balance or the official status page.'}]};
 expect(requests_for('你查查',thread).status).toBe(true);expect(requests_for('你查查',null).status).toBe(false);
 expect(requests_for('opanai的api挂了吗',null).status).toBe(true);expect(requests_for('OpenAI API是什么',thread).status).toBe(false);
 expect(builtinQuestion('给我两条最新发言')).toBe(false);expect(builtinQuestion('Show me the latest post')).toBe(false);expect(builtinQuestion('Codex重置状态怎么样')).toBe(false);
 expect(requests_for('计算 2+3',thread).expression).toBe('2+3');
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
test('quoted status followup prepares official data then makes exactly one answer request, with no tool or function call interface',async()=>{
 const code='const calls=[],prompts=[];globalThis.fetch=async(u,o)=>{calls.push(String(u));if(String(u).includes("status.openai.com"))return Response.json('+JSON.stringify(status)+');const b=JSON.parse(o.body);prompts.push(b);return Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify({text:"官方状态显示 API 出现故障，Codex 正常。https://status.openai.com/"})}}]});};const {execute_query}=await import('+path('commands/index')+');const r=await execute_query({command:"ask",args:{question:"你查查"}},{threadConversation:{state:"ready",messages:[{role:"assistant",content:"OpenAI API状态还没有核实，可以检查API key余额或官方状态页。"}]}});console.log(JSON.stringify({calls,prompts,r}));';
 const d=await trial(code);expect(d.calls).toHaveLength(2);expect(d.prompts).toHaveLength(1);expect(d.prompts[0].messages.map(x=>x.role)).toEqual(['system','assistant','user']);
 expect(d.prompts[0].messages[1].content).toContain('API key余额');expect(d.prompts[0].tools).toBeUndefined();expect(d.prompts[0].functions).toBeUndefined();expect(d.prompts[0].function_call).toBeUndefined();
 expect(JSON.parse(d.prompts[0].messages.at(-1).content).builtinFacts.serviceStatus.components[0].status).toBe('major_outage');expect(d.r.text).toContain('官方状态显示 API');
});
test('AI failure/tool output preserves program status and calculation; offline never makes network requests',async()=>{
 const d=await trial('let calls=0;globalThis.fetch=async(u)=>{calls++;if(String(u).includes("status.openai.com"))return Response.json('+JSON.stringify(status)+');return Response.json({choices:[{finish_reason:"tool_calls",message:{tool_calls:[{function:{name:"exec",arguments:"danger"}}]}}]});};const {execute_query}=await import('+path('commands/index')+');const calc=await execute_query({command:"ask",args:{question:"计算 (123+456)*7"}},{noAi:true});const live=await execute_query({command:"ask",args:{question:"OpenAI API是否正常"}});const before=calls;const off=await execute_query({command:"ask",args:{question:"OpenAI API是否正常"}},{offline:true,noAi:true});console.log(JSON.stringify({calc,live,off,before,calls}));');
 expect(d.calc.text).toBe('(123+456)*7 = 4053');expect(d.live.text).toContain('major_outage');expect(d.live.text).not.toContain('danger');
 expect(d.off.text).toContain('不能确认');expect(d.before).toBe(d.calls);
});
test('service status reads are shared, cache their collection time and recover from transport failure',async()=>{
 const d=await trial('let now=Date.now();Date.now=()=>now;let calls=0,broken=false;globalThis.fetch=async()=>{calls++;if(broken)throw Error("private supplier failure");return Response.json('+JSON.stringify(status)+')};const {service_status}=await import('+path('evidence/service-status')+');const a=await Promise.all([service_status(),service_status(),service_status()]);now+=60001;broken=true;const bad=await service_status();const cached=await service_status();now+=30001;broken=false;const recovered=await service_status();console.log(JSON.stringify({a,bad,cached,recovered,calls}));');
 expect(d.calls).toBe(3);expect(new Set(d.a.map(x=>x.at)).size).toBe(1);expect(d.bad.state).toBe('unavailable');expect(d.cached.cached).toBe(true);expect(d.recovered.state).toBe('ok');expect(JSON.stringify(d.bad)).not.toContain('supplier');
});

test('official summary without incidents reads the fixed incident feed, filters resolved events and retains a stable cached answer',async()=>{
 const summary={status:{description:'All Systems Operational'},components:[{name:'API',status:'operational'}]};
 const d=await trial('const calls=[],prompts=[];globalThis.fetch=async(u,o)=>{calls.push(String(u));if(String(u).endsWith("summary.json"))return Response.json('+JSON.stringify(summary)+');if(String(u).endsWith("incidents.json"))return Response.json({incidents:[{name:"Old outage",status:"resolved"}]});prompts.push(JSON.parse(o.body));return Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify({text:"官方目前显示正常。https://status.openai.com/"})}}]});};const {execute_query}=await import('+path('commands/index')+');const q={command:"ask",args:{question:"OpenAI API是否正常"}};const a=await execute_query(q),b=await execute_query(q);console.log(JSON.stringify({calls,prompts,a,b}));');
 expect(d.calls).toHaveLength(3);expect(d.prompts).toHaveLength(1);
 const facts=JSON.parse(d.prompts[0].messages.at(-1).content).builtinFacts.serviceStatus;
 expect(facts.incidentsKnown).toBe(true);expect(facts.incidents).toEqual([]);expect(d.a.text).toBe(d.b.text);
});
test('obvious builtin requests route locally, preserve fixed business priority and work without a model',async()=>{
 const d=await trial('let calls=0;globalThis.fetch=async()=>{calls++;throw Error("unexpected network")};const {resolve_query,execute_query}=await import('+path('commands/index')+');const math=await resolve_query("计算 (123+456)*7",null,{noAi:true});const r=await execute_query(math,{noAi:true});const status=await resolve_query("OpenAI API挂了吗",null,{noAi:true});const fixed=await resolve_query("status",null,{noAi:true});console.log(JSON.stringify({math,r,status,fixed,calls}));','');
 expect(d.math.command).toBe('ask');expect(d.status.command).toBe('ask');expect(d.fixed.command).toBe('status');expect(d.r.text).toBe('(123+456)*7 = 4053');expect(d.calls).toBe(0);
});
