import {test,expect} from 'bun:test';import {mkdtemp,rm,writeFile} from 'node:fs/promises';import {tmpdir,homedir} from 'node:os';import {join,resolve} from 'node:path';import {spawnSync} from 'node:child_process';
import {language,parse_pipeline} from '../dist/src/presentation.mjs';import {snapshot,post} from './fixture.mjs';
const module=JSON.stringify(resolve('dist/src/commands.mjs'));
const fixture=snapshot({posts:[post(25,'An improvement or a full reset, not a guarantee. 17%.',{id:'2100000000000000002'})]});
async function run(body,setup='',features='repair,translate,answer'){
 const dir=await mkdtemp(join(tmpdir(),'tibo-repair-'));await writeFile(join(dir,'snapshot.json'),JSON.stringify(fixture));
 try{const code=`let sent=[];const fs=await import('node:fs/promises');const reply=v=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(v)}}]});${setup};const {resolve_query,execute_query}=await import(${module});const opts={humanInput:true,snapshotPath:process.env.TIBO_SNAPSHOT,persist:false};${body}`;
 const r=spawnSync(process.execPath,['--eval',code],{env:{...process.env,TIBO_STATE_DIR:dir,TIBO_SNAPSHOT:join(dir,'snapshot.json'),TIBO_CONFIG_FILE:join(dir,'absent.env'),TIBO_AI_FEATURES:features,DEEPSEEK_API_KEY:'fixture-repair-secret',LANG:'ja_JP.UTF-8',TZ:'Europe/Paris',TIBO_LOCAL_ADMIN_UID:String(process.getuid()),TIBO_LARK_CHAT_IDS:'oc_fixtureGroup',TIBO_LARK_ADMIN_OPEN_IDS:'ou_fixtureOwner'},encoding:'utf8',timeout:10000});expect(r.status).toBe(0);expect(r.stderr).toBe('');const marker=r.stdout.lastIndexOf('TRACE:');return marker<0?JSON.parse(r.stdout):{...JSON.parse(r.stdout.slice(marker+6)),output:r.stdout.slice(0,marker)};
 }finally{await rm(dir,{recursive:true,force:true});}
}
const healthy=String.raw`globalThis.fetch=async(u,o)=>{const b=JSON.parse(o.body),e=JSON.parse(b.messages[1].content);sent.push({e,messages:b.messages});if(e.definitions)return reply(typeof e.definitions[0].params==='string'?{name:'translate',language:e.messageLanguage}:{command:'posts',args:{limit:2}});return reply({text:e.targetLanguage?'译：'+e.text:'FIRST_STAGE_OUTPUT'});};`;
test('common language spellings normalize locally and valid inputs never call repair',async()=>{
 for(const alias of ['zh','cn','zh-cn','zh-CN','中文','汉语','国语','普通话']){expect(language(alias)).toBe('zh');expect(parse_pipeline('posts 1 |translate '+alias).stages[0].language).toBe('zh');}
 const r=await run(`for(const q of ['posts 1','posts 1 |translate cn','posts 1 |translate zh-CN','posts 1 |translate 汉语'])await execute_query(await resolve_query(q,null,opts),opts);console.log(JSON.stringify(sent));`,healthy);
 expect(r).toHaveLength(1);expect(r[0].e.targetLanguage).toBe('zh');expect(r[0].e.definitions).toBeUndefined();
});
test('human unknown pipe is deferred until execution and repaired once with only the failing fragment',async()=>{
 const r=await run(`const q=await resolve_query('posts 1 |翻译',null,opts);const before=sent.length;const result=await execute_query(q,opts);console.log(JSON.stringify({q,before,result,sent}));`,healthy);
 expect(r.before).toBe(0);expect(r.q.pipeline[0].name).toBe('pending');expect(r.result.partial).toBe(false);expect(r.result.text).toContain('译：');expect(r.sent).toHaveLength(2);expect(r.sent[0].e.input).toBe('翻译');expect(r.sent[0].e.messageLanguage).toBe('zh');expect(r.sent[0].e.text).toBeUndefined();expect(r.sent[0].e.definitions.map(x=>x.name)).toEqual(['translate','ask','original']);
 const prompt=JSON.stringify(r.sent[0].messages);for(const value of ['fixture-repair-secret',homedir(),process.cwd(),'ja_JP','Europe/Paris','oc_fixtureGroup','ou_fixtureOwner','deepseek-flash','TIBO_'])expect(prompt).not.toContain(value);
});
test('my-language arguments infer from human message only; known translate cannot change into another pipe',async()=>{
 const r=await run(`const zh=await execute_query(await resolve_query('posts 1 |translate 我使用的语言',null,opts),opts);const enOpts={...opts,repairBudget:null};const en=await execute_query(await resolve_query('posts 1 |translate my language',null,enOpts),enOpts);console.log(JSON.stringify({zh,en,sent}));`,healthy);
 const repair=r.sent.filter(x=>x.e.definitions);expect(repair.map(x=>x.e.messageLanguage)).toEqual(['zh','en']);expect(repair.every(x=>x.e.knownName==='translate'&&x.e.definitions.length===1)).toBe(true);expect(r.zh.partial).toBe(false);expect(r.en.partial).toBe(false);
 const invalid=await run(`const result=await execute_query(await resolve_query('posts 1 |translate 我使用的语言',null,opts),opts);console.log(JSON.stringify({result,sent}));`,`globalThis.fetch=async()=>{sent.push('repair');return reply({name:'ask',instruction:'summarize'});}`);
 expect(invalid.sent).toHaveLength(1);expect(invalid.result.partial).toBe(true);expect(invalid.result.text).toContain(fixture.posts[0].text);
});
test('checkpoint retains preceding output and a real non-idempotent pray action executes only once',async()=>{
 const r=await run(`const {cli_context}=await import(${JSON.stringify(resolve('dist/src/admin.mjs'))});opts.context=cli_context();const result=await execute_query(await resolve_query('pray |ask summarize |翻译',opts.context,opts),opts);const file=(await fs.readdir(process.env.TIBO_STATE_DIR)).find(x=>x.startsWith('pray-'));const profile=JSON.parse(await fs.readFile(process.env.TIBO_STATE_DIR+'/'+file,'utf8'));console.log(JSON.stringify({result,profile,sent,offersAtRepair}));`,
 String.raw`let offersAtRepair;globalThis.fetch=async(u,o)=>{const e=JSON.parse(JSON.parse(o.body).messages[1].content);sent.push(e);if(e.definitions){const file=(await fs.readdir(process.env.TIBO_STATE_DIR)).find(x=>x.startsWith('pray-'));offersAtRepair=JSON.parse(await fs.readFile(process.env.TIBO_STATE_DIR+'/'+file,'utf8')).offers;return reply({name:'translate',language:'zh'});}return reply({text:e.targetLanguage?'译：'+e.text:'FIRST_STAGE_OUTPUT'});};`);
 expect(r.profile.offers).toBe(1);expect(r.offersAtRepair).toBe(1);expect(r.sent).toHaveLength(3);expect(r.sent[2].text).toBe('FIRST_STAGE_OUTPUT');expect(r.result.text).toBe('译：FIRST_STAGE_OUTPUT');expect(r.result.originalText).toContain('累计🙏 1');
});
test('failed repair keeps completed result, stops suffix, and never repeats pray or discloses supplier errors',async()=>{
 const r=await run(`const {cli_context}=await import(${JSON.stringify(resolve('dist/src/admin.mjs'))});opts.context=cli_context();const result=await execute_query(await resolve_query('pray |ask summarize |翻译 |original',opts.context,opts),opts);const file=(await fs.readdir(process.env.TIBO_STATE_DIR)).find(x=>x.startsWith('pray-'));console.log(JSON.stringify({result,offers:JSON.parse(await fs.readFile(process.env.TIBO_STATE_DIR+'/'+file,'utf8')).offers,sent}));`,
 `globalThis.fetch=async(u,o)=>{const e=JSON.parse(JSON.parse(o.body).messages[1].content);sent.push(e);return e.definitions?new Response('fixture-repair-secret /Users/private deepseek-flash',{status:401}):reply({text:'FIRST_STAGE_OUTPUT'});};`);
 expect(r.offers).toBe(1);expect(r.sent).toHaveLength(2);expect(r.result.partial).toBe(true);expect(r.result.text).toStartWith('FIRST_STAGE_OUTPUT');expect(r.result.text).not.toMatch(/fixture-repair-secret|\/Users\/|deepseek|401/);
});
test('internal structured queries, MCP, private syntax, no-AI and disabled repair never invoke recovery',async()=>{
 const r=await run(`let rows=[];for(const question of ['posts 1 |翻译','posts 1 |ask API key','posts 1 |','posts 1 |original |original |original |original'])rows.push(await resolve_query(question));rows.push(await execute_query({command:'posts',args:{limit:1},pipeline:[{name:'pending',fragment:'翻译'}]},{snapshotPath:opts.snapshotPath}));const noAI={...opts,noAi:true};rows.push(await execute_query(await resolve_query('posts 1 |翻译',null,noAI),noAI));const {dispatch}=await import(${JSON.stringify(resolve('dist/src/mcp.mjs'))});rows.push(await dispatch({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'tibo_ask',arguments:{question:'posts 1 |翻译'}}},{phase:2}));console.log(JSON.stringify({rows,sent}));`,healthy);
 expect(r.sent).toHaveLength(0);expect(r.rows.slice(0,4).every(x=>x.command==='pipeline-error')).toBe(true);expect(r.rows[4].ok).toBe(false);expect(r.rows[5].partial).toBe(true);expect(r.rows[6].result.isError).toBe(true);
 const off=await run(`const result=await execute_query(await resolve_query('posts 1 |翻译',null,opts),opts);console.log(JSON.stringify({result,sent}));`,healthy,'translate');expect(off.sent).toHaveLength(0);expect(off.result.text).toContain(fixture.posts[0].text);
});
test('runtime I/O and permission failures are not command parsing errors and cannot trigger repair or replay',async()=>{
 const r=await run(`await fs.writeFile(opts.snapshotPath,'bad');let thrown=false;try{await execute_query(await resolve_query('posts 1',null,opts),opts);}catch{thrown=true;}const denied=await execute_query(await resolve_query('pray |翻译',null,opts),{...opts,context:null});console.log(JSON.stringify({thrown,denied,sent}));`,healthy);
 expect(r.thrown).toBe(true);expect(r.denied.ok).toBe(false);expect(r.sent).toHaveLength(0);
});
test('business parameters are repaired before execution, bounded and constrained to the original command',async()=>{
 const r=await run(`const q=await resolve_query('posts --limit 两',null,opts),result=await execute_query(q,opts);const malformed=await resolve_query('posts --limit 超级多',null,opts);console.log(JSON.stringify({q,result,malformed,sent}));`,
 `globalThis.fetch=async(u,o)=>{const e=JSON.parse(JSON.parse(o.body).messages[1].content);sent.push(e);return reply(e.input.includes('超级多')?{command:'history',args:{}}:{command:'posts',args:{limit:2}});};`);
 expect(r.q.args.limit).toBe(2);expect(r.result.ok).toBe(true);expect(r.malformed.command).toBe('invalid');expect(r.sent).toHaveLength(2);expect(r.sent.every(x=>x.knownName==='posts'&&x.definitions.length===1)).toBe(true);
});
test('confirmation and destructive operations cannot be repaired, and pipes reject before creating a ticket',async()=>{
 const r=await run(`const ctx={transport:'lark',actor:'ou_fixtureOwner',scope:'oc_fixtureGroup',authenticated:true};let results=[];for(const q of ['clear-history extra','confirm not-a-uuid','clear-history |翻译','subscribe --time 10:00']){try{results.push(await execute_query(await resolve_query(q,ctx,opts),{...opts,context:ctx}));}catch{results.push({ok:false});}}console.log(JSON.stringify({results,files:await fs.readdir(process.env.TIBO_STATE_DIR),sent}));`,healthy);
 expect(r.results.every(x=>!x.ok)).toBe(true);expect(r.sent).toHaveLength(0);expect(r.files.some(x=>x.startsWith('confirm-'))).toBe(false);
});
test('two repair attempts per request bound latency, including cache hits; third failure retains the second result',async()=>{
 const r=await run(`const result=await execute_query(await resolve_query('posts 1 |翻译 |翻译 |翻译',null,opts),opts);console.log(JSON.stringify({result,sent,remaining:opts.repairBudget.remaining}));`,healthy);
 expect(r.remaining).toBe(0);expect(r.result.partial).toBe(true);expect(r.result.text).toStartWith('译：译：');expect(r.sent.filter(x=>x.e.definitions)).toHaveLength(1);expect(r.sent.filter(x=>x.e.targetLanguage)).toHaveLength(2);
});
test('actual CLI corrects Chinese numeric parameters and unknown pipe names without uploading local flags or paths',async()=>{
 const r=await run(`process.once('beforeExit',()=>console.log('TRACE:'+JSON.stringify({sent})));process.argv=['bun','tibo','posts','--limit','两','--snapshot',opts.snapshotPath,'|翻译'];await import(${JSON.stringify(resolve('dist/src/cli.mjs'))});`,healthy);
 expect(r.output).toContain('译：');expect(r.sent.filter(x=>x.e.definitions)).toHaveLength(2);expect(r.sent.filter(x=>x.e.targetLanguage)).toHaveLength(1);expect(r.sent[0].e.input).toBe('posts --limit 两');expect(r.sent[1].e.input).toBe('翻译');expect(JSON.stringify(r.sent.map(x=>x.messages))).not.toMatch(/snapshot.json|\/private\/|fixture-repair-secret|TIBO_SNAPSHOT/);
});
test('Lark enables recovery only for authenticated human interactions; prepared bulletins never parse or repair',async()=>{
 const r=await run(`const {deliver}=await import(${JSON.stringify(resolve('dist/adapters/lark/service.mjs'))});let outgoing=[];const client={send:async m=>{outgoing.push(m);return {code:0,data:{message_id:'fixture-'+outgoing.length}}}};const ctx={transport:'lark',actor:'ou_fixtureOwner',scope:'oc_fixtureGroup',authenticated:true};await deliver(client,ctx.scope,'human','help |翻译',null,ctx);await deliver(client,ctx.scope,'prepared','help |翻译',null,ctx,{text:'SHARED BULLETIN |翻译'});await deliver(client,ctx.scope,'internal','help |翻译');console.log(JSON.stringify({sent,texts:outgoing.map(m=>JSON.parse(m.content).zh_cn.content[0][0].text)}));`,healthy);
 expect(r.sent.filter(x=>x.e.definitions)).toHaveLength(1);expect(r.sent.filter(x=>x.e.targetLanguage)).toHaveLength(1);expect(r.texts[0]).toStartWith('译：');expect(r.texts[1]).toBe('SHARED BULLETIN |翻译');expect(r.texts[2]).not.toStartWith('译：');
});
test('relative date repair supplies a UTC business clock, with schema validation retaining the same status command',async()=>{
 const r=await run(`const q=await resolve_query('status --since today',null,opts);console.log(JSON.stringify({q,sent}));`,`globalThis.fetch=async(u,o)=>{const e=JSON.parse(JSON.parse(o.body).messages[1].content);sent.push(e);return reply({command:'status',args:{since:e.now.slice(0,10)+'T00:00:00Z'}});};`);
 expect(r.sent).toHaveLength(1);expect(r.sent[0].now).toMatch(/^20\d\d-\d\d-\d\dT\d\d:\d\d:00.000Z$/);expect(r.q.command).toBe('status');expect(r.q.args.since).toMatch(/T00:00:00Z$/);
});
test('updated repair contract releases only its obsolete schema circuit, preserving other task and provider pauses',async()=>{
 const r=await run(`const {config}=await import(${JSON.stringify(resolve('dist/src/ai-runtime.mjs'))});const path=process.env.TIBO_STATE_DIR+'/ai.json';const pause={failures:2,until:Date.now()+900000,status:-2,outputPolicy:'2'};await fs.writeFile(path,JSON.stringify({identity:config().identity,provider:{failures:0,until:0},features:{repair:pause,translate:{...pause,outputPolicy:'text-3'}},cache:[]}));const result=await execute_query(await resolve_query('posts 1 |翻译',null,opts),opts);let state=JSON.parse(await fs.readFile(path,'utf8'));const translate=state.features.translate;state.provider={failures:1,until:Date.now()+900000,status:401};await fs.writeFile(path,JSON.stringify(state));const fresh={...opts,repairBudget:null};await execute_query(await resolve_query('posts 1 |translate 我使用的语言',null,fresh),fresh);console.log(JSON.stringify({result,sent,translate,provider:JSON.parse(await fs.readFile(path,'utf8')).provider}));`,healthy);
 expect(r.sent).toHaveLength(1);expect(r.sent[0].e.kind).toBe('pipe');expect(r.result.partial).toBe(true);expect(r.translate.status).toBe(-2);expect(r.translate.outputPolicy).toBe('text-3');expect(r.provider.status).toBe(401);
});
