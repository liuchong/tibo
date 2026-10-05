import {test,expect} from 'bun:test';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';import {tmpdir,homedir} from 'node:os';import {spawnSync} from 'node:child_process';
import {parse_pipeline,detect_language,validate_stages} from '../dist/src/presentation.mjs';
import {snapshot,post} from './fixture.mjs';
const commands=JSON.stringify(resolve('dist/src/commands.mjs'));
const evidence=snapshot({posts:[post(24,'Older statement.',{id:'2100000000000000001'}),post(25,'Either an improvement or a full reset. 17% is a forecast, not a promise.',{id:'2100000000000000002',truncated:true})]});
async function trial(body,setup='',features='router,translate,answer'){
 const dir=await mkdtemp(join(tmpdir(),'tibo-pipes-')),file=join(dir,'snapshot.json');await writeFile(file,JSON.stringify(evidence));
 try{const script=`let sent=[];const reply=value=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}]}));${setup};const {resolve_query,execute_query}=await import(${commands});const opts={snapshotPath:process.env.TIBO_SNAPSHOT,persist:false};${body}`;
 const r=spawnSync(process.execPath,['--eval',script],{env:{...process.env,TIBO_STATE_DIR:dir,TIBO_SNAPSHOT:file,TIBO_AI_FEATURES:features,DEEPSEEK_API_KEY:'fixture-presentation-secret',LANG:'ja_JP.UTF-8',LC_ALL:'ja_JP.UTF-8',TZ:'Europe/Paris',TIBO_LARK_CHAT_IDS:'oc_fixtureGroup',TIBO_LARK_ADMIN_OPEN_IDS:'ou_fixtureOwner'},encoding:'utf8',timeout:10000});expect(r.stderr).toBe('');expect(r.status).toBe(0);return JSON.parse(r.stdout);
 }finally{await rm(dir,{recursive:true,force:true});}
}
const fake=String.raw`globalThis.fetch=async(u,o)=>{const b=JSON.parse(o.body),e=JSON.parse(b.messages[1].content);sent.push(b.messages);if(e.commands)return reply({command:'posts',args:{limit:1},language:e.question.includes('发言')?'zh':'en'});return reply({text:e.targetLanguage?'Translated '+e.targetLanguage+'\n'+e.text:'AI explanation '+e.responseLanguage+'\n'+e.text});}`;
test('pipe grammar preserves quoted keywords and apostrophes; validates all stages and bounds before execution',()=>{
 expect(parse_pipeline('posts 2 "a|b" |translate zh-CN |ask 用两句话总结 |original')).toEqual({base:'posts 2 "a|b"',stages:[{name:'translate',language:'zh'},{name:'ask',instruction:'用两句话总结'},{name:'original'}]});
 expect(parse_pipeline("What's the difference? |ask translate").base).toBe("What's the difference?");
 for(const text of ['posts |','posts |shell rm','posts |translate','posts |translate xx','posts |original x','posts |ask API key','posts |original |original |original |original','posts "unterminated'])expect(()=>parse_pipeline(text)).toThrow();
 for(const s of [[{name:'ask',instruction:'ok',command:'confirm'}],[{name:'original',args:{}}],[{name:'translate',language:'xx'}],[{name:'ask',instruction:'sk-fixtureprivatekey'}],{name:'original'}])expect(()=>validate_stages(s)).toThrow();
 expect(detect_language('查看发言')).toBe('zh');expect(detect_language('Show latest posts')).toBe('en');expect(detect_language('最近の投稿を見せて')).toBe('ja');expect(detect_language('Bonjour, les derniers messages ?')).toBe('fr');
});
test('fixed queries bypass AI; postId retrieves known older originals and flags source truncation',async()=>{
 const r=await trial(`const q=await resolve_query('原文 --postId 2100000000000000002');const raw=await execute_query(q,opts),older=await execute_query({command:'posts',args:{postId:'2100000000000000001',hours:1}},opts);console.log(JSON.stringify({raw,older,sent}));`,fake);
 expect(r.sent).toHaveLength(0);expect(r.raw.text).toContain(evidence.posts[1].text);expect(r.raw.text).toContain('正文已截断');expect(r.older.text).toContain('Older statement.');expect(r.raw.originalText).toBe(r.raw.text);
});
test('semantic post replies preserve original alongside translation and use message language, never locale or identity',async()=>{
 const r=await trial(`const zh=await execute_query(await resolve_query('给我最近一条发言'),opts),en=await execute_query(await resolve_query('Show me the latest post'),opts);console.log(JSON.stringify({zh,en,sent}));`,fake);
 expect(r.zh.text).toContain('Translated zh');expect(r.zh.text).toContain('**原文**');expect(r.en.text).toContain('**Tibo X posts**');expect(r.en.text).toContain('Original verified');expect(r.en.text).toContain(evidence.posts[1].text);expect(r.en.text).not.toContain('原文已核实');expect(r.sent).toHaveLength(3);expect(r.zh.originalText).toContain(evidence.posts[1].text);
 const prompts=JSON.stringify(r.sent);for(const privateValue of ['fixture-presentation-secret','ja_JP','Europe/Paris',homedir(),process.cwd(),'ou_fixtureOwner','oc_fixtureGroup','deepseek-flash','TIBO_'])expect(prompts).not.toContain(privateValue);
 const input=JSON.parse(r.sent[0][1].content);expect(Object.keys(input).sort()).toEqual(['commands','now','question']);
});
test('translation, explanation and original stages compose; repeat hits validated cache; AI cannot execute a returned command',async()=>{
 const r=await trial(`const q=await resolve_query('posts 1 |translate zh |ask 用一句话总结 |original'),a=await execute_query(q,opts),b=await execute_query(q,opts);console.log(JSON.stringify({a,b,sent}));`,fake);
 expect(r.sent).toHaveLength(2);expect(r.a.text).toBe(r.a.originalText);expect(r.b.text).toBe(r.a.text);expect(JSON.parse(r.sent[1][1].content).text).toContain('Translated zh');expect(JSON.parse(r.sent[1][1].content).capabilities.pipes.map(x=>x.name)).toEqual(['translate','ask','original']);
 const injected=await trial(`const r=await execute_query(await resolve_query('help |ask summarize'),opts);console.log(JSON.stringify(r));`,`globalThis.fetch=async()=>reply({command:'clear-history',args:{}});`);
 expect(injected.partial).toBe(true);expect(injected.text).toContain('Tibo 查询命令');expect(injected.text).toContain('temporarily unavailable');
});
test('changed facts reject translation; feature circuit is independent; failure keeps original with no provider diagnostics',async()=>{
 const r=await trial(`const first=await execute_query(await resolve_query('posts 1 |translate zh'),opts),second=await execute_query(await resolve_query('posts 1 |translate zh'),opts),blocked=await execute_query(await resolve_query('posts 1 |translate zh'),opts),answer=await execute_query(await resolve_query('posts 1 |ask 用一句话解释'),opts);console.log(JSON.stringify({first,second,blocked,answer,sent}));`,
 `globalThis.fetch=async(u,o)=>{const b=JSON.parse(o.body),e=JSON.parse(b.messages[1].content);sent.push(b.messages);return reply({text:e.targetLanguage?'Invented reset at 90%':'可用的独立解释'});}`);
 expect(r.sent).toHaveLength(3);expect(r.first.partial).toBe(true);expect(r.blocked.text).toContain('17%');expect(r.blocked.text).toContain('出了问题');expect(r.answer.text).toBe('可用的独立解释');expect(r.answer.partial).toBe(false);
 const auth=await trial(`const first=await execute_query(await resolve_query('posts 1 |translate en'),opts),second=await execute_query(await resolve_query('posts 1 |ask summarize'),opts);console.log(JSON.stringify({first,second,sent}));`,`globalThis.fetch=async()=>{sent.push('attempt');return new Response('fixture-presentation-secret /Users/private deepseek-flash',{status:401});}`);
 expect(auth.sent).toHaveLength(1);for(const item of [auth.first,auth.second]){expect(item.text).toContain(evidence.posts[1].text);expect(item.text).not.toMatch(/fixture-presentation-secret|\/Users\/|deepseek|401|认证/);}
});
test('no-AI switch preserves forecast and originals even with text pipelines; standalone answer does not request AI',async()=>{
 const r=await trial(`const p=await execute_query(await resolve_query('posts 1 |translate zh'),{...opts,noAi:true}),f=await execute_query({command:'forecast',args:{},pipeline:[{name:'ask',instruction:'summarize'}]},{...opts,noAi:true}),a=await execute_query({command:'ask',args:{question:'Explain global and banked'}},{...opts,noAi:true});console.log(JSON.stringify({p,f,a,sent}));`,fake);
 expect(r.sent).toHaveLength(0);expect(r.p.text).toContain(evidence.posts[1].text);expect(r.f.ok).toBe(true);expect(r.f.result.forecast.mode).not.toBe('ai-blend');expect(r.a.ok).toBe(false);
});
test('translation cannot add fabricated probabilities while retaining old facts; explanation cannot invent a new percentage',async()=>{
 const r=await trial(`const t=await execute_query(await resolve_query('posts 1 |translate zh'),opts),a=await execute_query(await resolve_query('posts 1 |ask 用一句话解释'),opts);console.log(JSON.stringify({t,a,sent}));`,
 `globalThis.fetch=async(u,o)=>{const e=JSON.parse(JSON.parse(o.body).messages[1].content);sent.push(e);return reply({text:e.text+' 新概率90%'});}`);
 expect(r.t.partial).toBe(true);expect(r.a.partial).toBe(true);expect(r.t.text).not.toContain('90%');expect(r.a.text).not.toContain('90%');expect(r.t.text).toContain('17%');expect(r.a.text).toContain('17%');
});
test('administrator pipelines reject before proposals or confirmations; malformed metadata cannot execute base writes',async()=>{
 const r=await trial(`const {write_state,read_state}=await import(${JSON.stringify(resolve('dist/src/state.mjs'))});await write_state('ledger',{sentinel:'keep'});const context={transport:'lark',actor:'ou_fixtureOwner',scope:'oc_fixtureGroup'};const results=[];for(const text of ['clear-history |translate zh','confirm 12345678-1234-1234-1234-123456789abc |original'])results.push(await execute_query(await resolve_query(text,context),{context}));results.push(await execute_query({command:'clear-history',args:{},pipeline:[{name:'execute'}]},{context}));const fs=await import('node:fs/promises');console.log(JSON.stringify({results,ledger:await read_state('ledger'),files:await fs.readdir(process.env.TIBO_STATE_DIR),sent}));`,fake);
 expect(r.results.every(x=>!x.ok)).toBe(true);expect(r.ledger.sentinel).toBe('keep');expect(r.files.some(x=>x.startsWith('confirm-'))).toBe(false);expect(r.sent).toHaveLength(0);
});
test('one-shot generic questions use safe capabilities, not a second router or invented current evidence',async()=>{
 const r=await trial(`const direct=await execute_query({command:'ask',args:{question:'global和banked有什么区别？'}},opts);console.log(JSON.stringify({direct,sent}));`,fake);
 expect(r.sent).toHaveLength(1);expect(r.direct.ok).toBe(true);const payload=JSON.parse(r.sent[0][1].content);expect(payload.responseLanguage).toBe('zh');expect(payload.text).toBe('');expect(payload.capabilities.rules).toContain('unknown without fetched evidence');expect(payload.capabilities.commands.some(c=>c.name==='confirm')).toBe(false);
});
test('actual CLI pipe tokens and MCP question pipelines use the same core without spawning shell commands',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'tibo-pipe-wire-')),file=join(dir,'snapshot.json');await writeFile(file,JSON.stringify(evidence));
 try{const env={...process.env,TIBO_STATE_DIR:dir,TIBO_SNAPSHOT:file,TIBO_AI_FEATURES:'',DEEPSEEK_API_KEY:'',TIBO_CONFIG_FILE:join(dir,'absent.env')};
 for(const [cmd,...args] of [['posts','--limit','1'],['status'],['forecast'],['history'],['commands'],['help']]){
  const child=spawnSync(process.execPath,['bin/tibo.mjs',cmd,...args,'--snapshot',file,'|original'],{env,encoding:'utf8',timeout:10000});expect(child.status).toBe(0);expect(child.stderr).toBe('');expect(child.stdout.length).toBeGreaterThan(20);
 }
 const child=spawnSync(process.execPath,['bin/tibo.mjs','mcp'],{env,encoding:'utf8',timeout:10000,input:[{jsonrpc:'2.0',id:1,method:'initialize'},{jsonrpc:'2.0',method:'notifications/initialized'},{jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'tibo_ask',arguments:{question:'posts 1 |original'}}}].map(x=>JSON.stringify(x)).join('\n')+'\n'});
 expect(child.status).toBe(0);const reply=child.stdout.trim().split('\n').map(x=>JSON.parse(x)).find(x=>x.id===2);expect(reply.result.isError).toBe(false);expect(reply.result.content[0].text).toContain(evidence.posts[1].text);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('Lark delivery keeps Markdown and honors pipeline language without forwarding supplier error bodies',async()=>{
 const r=await trial(`const {deliver}=await import(${JSON.stringify(resolve('dist/adapters/lark/service.mjs'))});let outgoing=[];const client={send:async m=>{outgoing.push(m);return {code:0,data:{message_id:'fixture-'+outgoing.length}}}};await deliver(client,'oc_fixtureGroup','pipeline-help','help |translate en');await deliver(client,'oc_fixtureGroup','pipeline-error','help |ask summarize');console.log(JSON.stringify({outgoing,sent}));`,
 String.raw`globalThis.fetch=async(u,o)=>{sent.push(JSON.parse(o.body).messages);return sent.length===1?reply({text:'**Help**\n'+JSON.parse(JSON.parse(o.body).messages[1].content).text}):new Response('fixture-presentation-secret /Users/private deepseek-flash',{status:422});}`);
 expect(r.outgoing).toHaveLength(2);const texts=r.outgoing.map(x=>JSON.parse(x.content).zh_cn.content[0][0]);expect(texts.every(x=>x.tag==='md')).toBe(true);expect(texts[0].text).toContain('**Help**');expect(texts[1].text).toContain('temporarily unavailable');expect(texts[1].text).not.toMatch(/fixture-presentation-secret|\/Users\/|deepseek|422/);
});
