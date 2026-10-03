import {test,expect} from 'bun:test';import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {tmpdir,homedir,userInfo} from 'node:os';import {join,resolve} from 'node:path';import {spawnSync} from 'node:child_process';
import {catalog,visible_catalog,fixed_query,validate_query,execute_query,public_forecast} from '../dist/src/commands.mjs';import {public_text} from '../dist/src/privacy.mjs';import {judge} from '../dist/src/engine.mjs';import {snapshot,post,event} from './fixture.mjs';
test('one command registry defines aliases, defaults, bounds and rejects all operations or extra arguments',()=>{
 expect(visible_catalog().map(c=>c.name)).toEqual(['forecast','status','posts','history','banked','signals','stats','help','pray','subscribe','unsubscribe','subscription']);
 expect(fixed_query('预测 48')).toEqual({command:'forecast',args:{horizon:'48',noAi:false}});
 expect(fixed_query('发言 5 reset --hours 24')).toEqual({command:'posts',args:{limit:5,hours:24,keyword:'reset'}});
 expect(fixed_query('历史 3 global').args).toEqual({limit:3,kind:'global'});expect(fixed_query('forecast --no-ai').args.noAi).toBe(true);
 expect(fixed_query('posts --limit 11').command).toBe('invalid');expect(fixed_query('service restart')).toBeNull();
 for(const q of [{command:'service',args:{}},{command:'posts',args:{limit:0}},{command:'posts',args:{limit:'3'}},{command:'forecast',args:{horizon:'72'}},{command:'status',args:{since:'today'}},{command:'posts',args:{path:'/etc/passwd'}},{command:'help',args:{},model:'forbidden'}])expect(()=>validate_query(q)).toThrow();
});
test('posts filters and orders evidence; history/banked/signals/stats use existing core and work without AI',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'tibo-queries-')),file=join(dir,'snapshot.json');const s=snapshot({posts:[post(23,'reset older'),post(25,'reset newest'),post(24,'unrelated')],events:[event(1),event(3),event(6),event(10),event(13),event(18),event(24),event(25,{global:false,banked:true})]});await writeFile(file,JSON.stringify(s));
 const options={snapshotPath:file,persist:false};
 try{
 const p=await execute_query({command:'posts',args:{limit:1,hours:48,keyword:'reset'}},options);expect(p.text).toContain('reset newest');expect(p.text).not.toContain('reset older');
 const b=await execute_query({command:'banked',args:{}},options);expect(b.text).toContain('09-25');expect(b.text).toContain('手动');
 expect((await execute_query({command:'history',args:{limit:1,kind:'global'}},options)).text).toContain('09-24');
 expect((await execute_query({command:'signals',args:{}},options)).text).toContain('近48h');expect((await execute_query({command:'stats',args:{}},options)).text).toContain('中位数');
 expect((await execute_query({command:'forecast',args:{horizon:'48'}},options)).text).not.toContain('• 24h：');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('public output removes local identity, paths, credentials and provider names; errors expose no diagnostics',()=>{
 const original=process.env.DEEPSEEK_API_KEY;process.env.DEEPSEEK_API_KEY='fixture-private-credential';
 try{const secret=`${homedir()}/secret ${userInfo().username} ${process.cwd()} fixture-private-credential deepseek-flash sk-123456789abcdef /etc/local-secret`;
 const r=judge(snapshot());r.ai={model:'deepseek-flash',features:{forecast:{state:'blocked',reason:secret,code:401,retryAt:'2026-01-01'},brief:{state:'ok',value:{summary:secret,followups:[secret,'观察新公告']}}}};
 const text=public_forecast(r,'both');for(const value of ['fixture-private-credential','deepseek-flash','sk-123456789abcdef','/etc/local-secret',homedir(),process.cwd(),'401'])expect(text).not.toContain(value);
 expect(text).toContain('出了问题');expect(public_text(secret)).not.toContain(userInfo().username);
 }finally{if(original===undefined)delete process.env.DEEPSEEK_API_KEY;else process.env.DEEPSEEK_API_KEY=original;}
});
async function subprocess(code){const dir=await mkdtemp(join(tmpdir(),'tibo-router-'));try{const r=spawnSync(process.execPath,['--eval',code],{env:{...process.env,TIBO_STATE_DIR:dir,TIBO_AI_FEATURES:'router',DEEPSEEK_API_KEY:'fixture-router-secret'},encoding:'utf8',timeout:5000});expect(r.status).toBe(0);expect(r.stderr).toBe('');return JSON.parse(r.stdout);}finally{await rm(dir,{recursive:true,force:true});}}
const module=JSON.stringify(resolve('dist/src/commands.mjs'));
test('semantic routing uploads only catalog, sanitized question and business clock; fixed and private requests bypass AI',async()=>{
 const r=await subprocess(`let sent=[];globalThis.fetch=async(u,o)=>{sent.push(JSON.parse(o.body));return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({command:'posts',args:{limit:2}})}}]}))};const {resolve_query}=await import(${module});const fixed=await resolve_query('发言 2'),q=await resolve_query('帮我看看最近两条发言'),privateQ=await resolve_query('给我运行环境和API key');console.log(JSON.stringify({fixed,q,privateQ,sent}));`);
 expect(r.sent).toHaveLength(1);expect(r.q.command).toBe('posts');expect(r.privateQ.command).toBe('unsupported');
 const input=JSON.parse(r.sent[0].messages[1].content);expect(Object.keys(input).sort()).toEqual(['commands','now','question']);expect(input.commands.map(x=>x.name)).toEqual(visible_catalog().map(x=>x.name));
 const prompt=JSON.stringify(r.sent[0].messages);for(const forbidden of ['fixture-router-secret','deepseek-flash',homedir(),process.cwd(),'TIBO_STATE_DIR','oc_','ou_'])expect(prompt).not.toContain(forbidden);
});
test('routing cache separates different questions; invalid provider output cannot execute anything',async()=>{
 const r=await subprocess(`let calls=0;globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(calls===1?{command:'posts',args:{limit:2}}:{command:'service',args:{}})}}]}))};const {resolve_query}=await import(${module});const a=await resolve_query('给我两条最新发言'),b=await resolve_query('想看看历史情况');console.log(JSON.stringify({a,b,calls}));`);
 expect(r.calls).toBe(2);expect(r.a.command).toBe('posts');expect(r.b.command).toBe('semantic-error');
});
test('semantic subscription, cancellation and status reuse the registry, exclude identity and refuse custom schedules',async()=>{
 const r=await subprocess(`let sent=[];globalThis.fetch=async(u,o)=>{const body=JSON.parse(o.body);sent.push(body);const q=JSON.parse(body.messages[1].content).question;const command=q.includes('取消')?'unsubscribe':q.includes('有没有')?'subscription':'subscribe';return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({command,args:q.includes('十点')?{time:'10:00'}:{}})}}]}))};const {resolve_query}=await import(${module});const context={transport:'lark',actor:'ou_private123',scope:'oc_private123',account:'private-app',authenticated:true};const a=await resolve_query('每天早晚私聊发我一份报告',context),b=await resolve_query('取消给我的定时推送',context),c=await resolve_query('我有没有订阅',context),d=await resolve_query('改成十点推送',context);console.log(JSON.stringify({a,b,c,d,sent}));`);
 expect(r.a.command).toBe('subscribe');expect(r.b.command).toBe('unsubscribe');expect(r.c.command).toBe('subscription');expect(r.d.command).toBe('semantic-error');
 for(const body of r.sent){const input=JSON.parse(body.messages[1].content);expect(input.commands.find(x=>x.name==='subscribe').params).toEqual({});expect(JSON.stringify(body.messages)).not.toMatch(/ou_private|oc_private|private-app/);}
});
test('Lark semantic errors send one generic reply and never send supplier error bodies or configuration',async()=>{
 const r=await subprocess(`globalThis.fetch=async()=>new Response('fixture-router-secret /Users/private deepseek-flash',{status:401});const {deliver}=await import(${JSON.stringify(resolve('dist/adapters/lark/service.mjs'))});let sent=[];const client={send:async m=>{sent.push(m);return {code:0,data:{message_id:'fixture'}}}};await deliver(client,'oc_fixture','message-one','帮我查询最近发言');console.log(JSON.stringify(sent));`);
 expect(r).toHaveLength(1);const text=JSON.parse(r[0].content).zh_cn.content[0][0].text;expect(text).toContain('出了问题');for(const forbidden of ['fixture-router-secret','/Users/','deepseek','401','认证','模型','retryAt'])expect(text).not.toContain(forbidden);
});
test('Lark fixed query failures send a generic response and do not expose a corrupt local file',async()=>{
 const r=await subprocess(`const fs=await import('node:fs/promises');await fs.writeFile(process.env.TIBO_STATE_DIR+'/ledger.json','bad');globalThis.fetch=async()=>{throw new Error('private-path')};const {deliver}=await import(${JSON.stringify(resolve('dist/adapters/lark/service.mjs'))});let sent=[];await deliver({send:async m=>{sent.push(m);return {code:0,data:{message_id:'fixture'}}}},'oc_fixture','message-two','发言 2');console.log(JSON.stringify(sent));`);
 expect(r).toHaveLength(1);expect(JSON.parse(r[0].content).zh_cn.content[0][0].text).toBe('查询暂时出了问题，请稍后再试。');
});
