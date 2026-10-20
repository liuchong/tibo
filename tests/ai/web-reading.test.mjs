import {test,expect} from 'bun:test';
import {spawnSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {fixed_query} from '../../dist/src/commands/parser.mjs';
import {validate_plan} from '../../dist/src/commands/chat-plan.mjs';
const path=n=>JSON.stringify(resolve('dist/src/'+n+'.mjs'));
async function trial(code){const dir=await mkdtemp(join(tmpdir(),'tibo-read-integration-'));try{const r=spawnSync(process.execPath,['--eval',code],{env:{...process.env,TIBO_CONFIG_FILE:join(dir,'absent.env'),TIBO_STATE_DIR:dir,TIBO_AI_FEATURES:'read,answer',TIBO_WEB_RENDER:'0',DEEPSEEK_API_KEY:'fixture-key'},encoding:'utf8',timeout:20000});expect(r.status,r.stderr).toBe(0);return JSON.parse(r.stdout);}finally{await rm(dir,{recursive:true,force:true});}}
test('URL plans are grounded in current or explicit quoted context, not invented by the model',()=>{
 expect(fixed_query('search --query quota --read false').args.read).toBe(false);
 const url='https://docs.example.com/guide';const plan={topic:'guide',scope:{subject:'general',source:'current',quote:'读原文'},queries:[{command:'read-page',args:{url}}]};
 expect(validate_plan(plan,null,{question:'读原文 '+url}).queries[0].command).toBe('read-page');
 expect(validate_plan(plan,null,{question:'读原文',quotedMessage:{role:'assistant',content:'Guide '+url}}).queries[0].args.url).toBe(url);
 expect(()=>validate_plan(plan,null,{question:'读原文'})).toThrow();
 expect(validate_plan(plan,null,{question:'读原文',history:[{role:'assistant',content:Array.from({length:12},(_,i)=>'https://docs.example.com/old-'+i).join(' ')}],quotedMessage:{role:'assistant',content:url}}).queries[0].args.url).toBe(url);
 expect(()=>validate_plan({...plan,queries:[{command:'read-page',args:{url,script:'process.exit()'}}]},null,{question:'读原文 '+url})).toThrow();
});
test('quoted followup reads an original page with one plan and one answer; page instructions do not become executable tools',async()=>{
 const text='Weekly quota refresh is controlled by the service. Check the account page for the exact date. '.repeat(6);
 const d=await trial(`const prompts=[],calls=[];globalThis.fetch=async(u,o)=>{calls.push(String(u));if(String(u).startsWith('https://docs.example.com'))return new Response('<article><h1>Quota guide</h1><p>${text}</p></article>',{headers:{'content-type':'text/html'}});const body=JSON.parse(o.body);prompts.push(body);return Response.json({choices:[{finish_reason:'stop',message:{content:body.max_tokens===600?JSON.stringify({topic:'quota guide',scope:{subject:'general',source:'quoted',quote:''},queries:[{command:'read-page',args:{url:'https://docs.example.com/guide'}}]}):'已读取原文：按服务自身的额度周期刷新。https://docs.example.com/guide'}}]});};const {execute_query}=await import(${path('commands/index')});const r=await execute_query({command:'ask',args:{question:'读取这篇原文看看'}},{threadConversation:{state:'ready',quotedMessage:{role:'assistant',content:'Quota guide https://docs.example.com/guide'},messages:[{role:'user',content:'Antigravity有没有重置？'},{role:'assistant',content:'搜索结果 https://docs.example.com/guide'}]}});console.log(JSON.stringify({r,prompts,calls}));`);
 expect(d.prompts).toHaveLength(2);expect(d.prompts[0].response_format.type).toBe('json_object');expect(d.prompts[1].response_format).toBeUndefined();expect(d.calls).toHaveLength(3);expect(d.r.ok).toBe(true);const facts=JSON.parse(d.prompts[1].messages.at(-1).content).builtinFacts;expect(facts.reads[0].data.mode).toBe('http');expect(facts.reads[0].data.text).toContain('Weekly quota refresh');
 for(const p of d.prompts){expect(p.tools).toBeUndefined();expect(p.function_call).toBeUndefined();}
});
test('search enriches actual pages while preserving blocked and title-only results',async()=>{
 const d=await trial(`const calls=[];globalThis.fetch=async(u,o)=>{calls.push(String(u));if(String(u).includes('google.com'))return new Response('<a href="https://docs.example.com/guide">Quota guide documentation</a><a href="https://docs.example.com/blocked">Other quota article</a>');if(String(u).includes('baidu.com'))return new Response('<title>百度安全验证</title>');if(String(u).endsWith('/blocked'))return new Response('denied',{status:403});return new Response('<article><p>${'Precise weekly quota reset details are stated in the official account documentation. '.repeat(8)}</p></article>',{headers:{'content-type':'text/html'}});};const {execute_query}=await import(${path('commands/index')});const r=await execute_query({command:'search',args:{query:'quota refresh guide'}},{noAi:true});const before=calls.length;const only=await execute_query({command:'search',args:{query:'quota refresh guide',read:false}},{noAi:true});console.log(JSON.stringify({r,only,calls,before}));`);
 expect(d.r.data.pages).toHaveLength(2);expect(d.r.data.pages[0].state).toBe('ok');expect(d.r.data.pages[1].state).toBe('blocked');expect(d.r.text).toContain('Precise weekly');expect(d.only.data.pages).toEqual([]);expect(d.calls).toHaveLength(d.before);
});
