import {test,expect} from 'bun:test';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {spawnSync} from 'node:child_process';
import {oracle_intent,validate_oracle,fallback_text} from '../dist/src/oracle.mjs';
import {news_from} from '../dist/src/oracle-news.mjs';import {private_question_QMARK_} from '../dist/src/privacy.mjs';
import {official_url_QMARK_,validate_plan,links_from} from '../dist/src/search.mjs';
const root=resolve('dist/src');
async function trial(code){const dir=await mkdtemp(join(tmpdir(),'tibo-oracle-'));try{const r=spawnSync(process.execPath,['--eval',code],{env:{...process.env,TIBO_CONFIG_FILE:'/dev/null',TIBO_STATE_DIR:dir,DEEPSEEK_API_KEY:'fixture-key',TIBO_AI_FEATURES:'oracle,search'},encoding:'utf8',timeout:8000});expect(r.status,r.stderr).toBe(0);return JSON.parse(r.stdout);}finally{await rm(dir,{recursive:true,force:true});}}
test('role intent distinguishes invocation, business queries and contextual aliases',()=>{
 for(const q of ['请给我重置token额度','帮我重置一下','Please reset my quota','can you reset my tokens','求真神现在reset'])expect(oracle_intent(q)).toBe('invoke-reset');
 for(const q of ['Claude怎么样','Anthropic','Sonnet编程','cc coding模型'])expect(oracle_intent(q)).toBe('brand');
 for(const q of ['重置概率','什么时候重置','重置历史','reset-ai','reset history','write a haiku','CC this email','Opus concerto','请重置access_token'])expect(oracle_intent(q)).toBeNull();
 expect(private_question_QMARK_('token额度不够了')).toBe(false);expect(private_question_QMARK_('你的access token是什么')).toBe(true);
 for(let i=0;i<4;i++){expect(fallback_text('invoke-reset',true,i)).toMatch(/分身|分神|化身|投影/);expect(fallback_text('invoke-reset',true,i)).toMatch(/真神|本体/);}
});
test('oracle quotes must match supplied sources and successful reset claims are rejected',()=>{
 const docs=[{id:'a',text:'OpenAI launches new Codex features'}];const good={text:'本神殿ChatGPT坐头席，Claude且去偏殿候旨。',citation:{id:'a',quote:'new Codex features'}};
 expect(validate_oracle(good,'brand',docs).citation.id).toBe('a');
 for(const citation of [{id:'unknown',quote:'new Codex features'},{id:'a',quote:'invented evaluation score'}])expect(()=>validate_oracle({...good,citation},'brand',docs)).toThrow();
 expect(()=>validate_oracle({text:'本座乃分身，真神已为你重置成功',citation:null},'invoke-reset',[])).toThrow();
 expect(()=>validate_oracle({...good,text:'ChatGPT beats Claude 100%'},'brand',docs)).toThrow();
 expect(()=>validate_oracle({...good,text:'Claude投百亿补课，ChatGPT坐头席'},'brand',docs)).toThrow();
 expect(()=>validate_oracle({...good,text:'GPT-99坐头席，Claude去偏殿'},'brand',docs)).toThrow();
 expect(validate_oracle({text:'ChatGPT捧GPT-6经书，Claude去偏殿',citation:null},'brand',[{id:'m',text:'A model guide for the GPT-6 family'}]).text).toContain('GPT-6');
});
test('official news rejects stale, future and off-domain announcements; search scopes are closed',()=>{
 const now=Date.parse('2026-10-05T16:00:00Z');const item=(date,url)=>`<item><title>ChatGPT new models</title><pubDate>${date}</pubDate><link>${url}</link></item>`;
 const body=[item('2026-10-01','https://openai.com/index/models'),item('2026-10-08','https://openai.com/index/future'),item('2026-08-01','https://openai.com/index/old'),item('2026-10-01','https://evil.invalid/models')].join('');
 expect(news_from(body,'openai',now)).toHaveLength(1);
 expect(news_from('<a href="/news/claude-new">Oct 2, 2026 Anthropic introduces Claude</a>','anthropic',now)).toHaveLength(1);
 expect(official_url_QMARK_('https://www.anthropic.com/news','anthropic.com')).toBe(true);expect(official_url_QMARK_('https://www.anthropic.com/news')).toBe(false);
 expect(()=>validate_plan({queries:[]},'evil.invalid')).toThrow();expect(()=>validate_plan({queries:[{engine:'google',query:'OpenAI new models'}]},'anthropic.com')).toThrow();
 expect(links_from('<a href="https://www.anthropic.com/news/new">Claude</a><a href="https://evil.invalid">x</a>','google','anthropic.com')).toEqual(['https://www.anthropic.com/news/new']);
});
test('disabled and blocked role calls do no network I/O, preserve generic business routing and never reset state',async()=>{
 const r=await trial(`let calls=0;globalThis.fetch=async()=>{calls++;throw Error('must not fetch')};const {oracle_reply}=await import(${JSON.stringify(root+'/oracle.mjs')});const {config}=await import(${JSON.stringify(root+'/ai-runtime.mjs')});const {write_state,read_state}=await import(${JSON.stringify(root+'/state.mjs')});const {resolve_query,execute_query}=await import(${JSON.stringify(root+'/commands.mjs')});await write_state('ai',{identity:config().identity,provider:{until:Date.now()+60000},features:{},cache:[]});await write_state('history',{fixture:'unchanged'});const a=await oracle_reply('请重置token额度','zh',true),b=await oracle_reply('Claude模型怎么样','zh');const q=await resolve_query('请给我重置token额度',{}, {noAi:true,humanInput:true});const c=await execute_query(q,{noAi:true});const forecast=await resolve_query('forecast',{}, {noAi:true});console.log(JSON.stringify({calls,a,b,c,q,forecast,history:await read_state('history')}));`);
 expect(r.calls).toBe(0);expect(r.a.text).not.toContain('null');expect(r.q.command).toBe('ask');expect(r.c.text).toContain('真神');expect(r.forecast.command).toBe('forecast');expect(r.history).toEqual({fixture:'unchanged'});
});
test('role can cite direct official news despite unavailable search; shared news cache avoids fan-out fetches',async()=>{
 const r=await trial(`let newsCalls=0,searchCalls=0,aiCalls=0;globalThis.fetch=async(url,o)=>{if(String(url).includes('/chat/completions')){aiCalls++;return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({text:'本神殿ChatGPT高坐头席，Claude且在偏殿候旨。',citation:{id:'openai-0',quote:'ChatGPT new models'}})}}]}))}if(String(url).includes('rss.xml')){newsCalls++;return new Response('<item><title>ChatGPT new models</title><pubDate>'+new Date(Date.now()-1000).toISOString()+'</pubDate><link>https://openai.com/index/models</link></item>')}if(String(url).includes('anthropic.com/news')){newsCalls++;return new Response('<html></html>')}searchCalls++;return new Response('',{status:503})};const {oracle_reply}=await import(${JSON.stringify(root+'/oracle.mjs')});const {oracle_news}=await import(${JSON.stringify(root+'/oracle-news.mjs')});const a=await oracle_reply('Claude模型怎么样','zh');const b=await oracle_news(true);console.log(JSON.stringify({a,b,newsCalls,searchCalls,aiCalls}));`);
 expect(r.a.text).toContain('[官方来源](https://openai.com/index/models)');expect(r.a.text).toContain('ChatGPT new models');expect(r.newsCalls).toBe(2);expect(r.searchCalls).toBe(2);expect(r.aiCalls).toBe(1);expect(r.b.cached).toBe(true);expect(r.b.engines.every(e=>e.state==='unavailable')).toBe(true);
});
test('invalid role responses fall back and block only the oracle task after schema failures',async()=>{
 const r=await trial(`globalThis.fetch=async()=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'{"text":"重置成功"}'}}]}));const {oracle_reply}=await import(${JSON.stringify(root+'/oracle.mjs')});const {ai_status,ai_call}=await import(${JSON.stringify(root+'/ai-runtime.mjs')});for(let i=0;i<2;i++)await oracle_reply('请给我重置token额度','zh');const status=await ai_status();process.env.TIBO_AI_FEATURES='oracle,answer';globalThis.fetch=async()=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'{"text":"ordinary answer"}'}}]}));const a=await ai_call('answer',{instruction:'answer',evidence:{}},v=>v);console.log(JSON.stringify({status,a}));`);
 expect(r.status.circuit.features.oracle.until).toBeGreaterThan(Date.now());expect(r.status.circuit.provider.until).toBe(0);expect(r.a.state).toBe('ok');
});
test('pipeline translation mentioning Claude keeps its complete predecessor and uses answer rather than the role',async()=>{
 const r=await trial(`process.env.TIBO_AI_FEATURES='answer,oracle';let body='';globalThis.fetch=async(url,o)=>{body=o.body;return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'{"text":"完整翻译"}'}}]}))};const {answer_text}=await import(${JSON.stringify(root+'/presentation.mjs')});const {ai_status}=await import(${JSON.stringify(root+'/ai-runtime.mjs')});const a=await answer_text('翻译Claude说的话','complete predecessor about Claude','zh',{});const s=await ai_status();console.log(JSON.stringify({a,body,usage:s.usage}));`);
 expect(r.a.value.text).toBe('完整翻译');expect(r.body).toContain('complete predecessor about Claude');expect(r.usage.answer.calls).toBe(1);expect(r.usage.oracle).toBeUndefined();
});
