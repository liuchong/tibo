import {test,expect} from 'bun:test';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {spawnSync} from 'node:child_process';
import {validate_oracle} from '../../dist/src/prayer/oracle.mjs';
import {question_topic,select_documents} from '../../dist/src/prayer/oracle-context.mjs';
const root=resolve('dist/src');
async function trial(body,modelValue={text:'我站GPT，Claude先别急着谢幕，代码跑通再说。',citation:{id:'news',quote:'A model guide for the GPT family'}}){const dir=await mkdtemp(join(tmpdir(),'tibo-oracle-context-'));try{
 const code=`let prompts=[],calls=0;const modelValue=${JSON.stringify(modelValue)};globalThis.fetch=async(url,options)=>{calls++;const evidence=JSON.parse(JSON.parse(options.body).messages[1].content);prompts.push(evidence);return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(modelValue)}}]}));};const {oracle_reply}=await import(${JSON.stringify(root+'/prayer/oracle.mjs')});const {write_state,read_state}=await import(${JSON.stringify(root+'/platform/state.mjs')});const {ai_status,config}=await import(${JSON.stringify(root+'/ai/runtime.mjs')});const {recent_replies}=await import(${JSON.stringify(root+'/prayer/oracle-memory.mjs')});const context={transport:'lark',account:'private-account',scope:'private-room',actor:'private-actor'};await write_state('oracle-news',{until:Date.now()+60000,at:new Date().toISOString(),searchEnabled:true,documents:[{id:'news',text:'A model guide for the GPT family',at:new Date().toISOString(),url:'https://openai.com/index/model-guide'}]});${body}`;
 const r=spawnSync(process.execPath,['--eval',code],{env:{...process.env,TIBO_CONFIG_FILE:'/dev/null',TIBO_STATE_DIR:dir,DEEPSEEK_API_KEY:'private-fixture-secret',TIBO_AI_FEATURES:'oracle,search'},encoding:'utf8',timeout:8000});expect(r.status,r.stderr).toBe(0);return JSON.parse(r.stdout);
}finally{await rm(dir,{recursive:true,force:true});}}
test('GPT shorthand normalizes without failing the role; invented model numbers and citations still fail',()=>{
 const out=validate_oracle({text:'我站GPT，Claude先别急着谢幕。',citation:null},'brand',[]);
 expect(out.text).toContain('OpenAI GPT');
 const missing=validate_oracle({text:'Claude要抢镜，先把代码摆出来。',citation:null},'brand',[]);expect(missing.text).toContain('OpenAI');expect(missing.text).not.toMatch(/本神|本座|神殿|汝/);
 const english=validate_oracle({text:'Claude can bring a working demo.',citation:null},'brand',[]);expect(english.text).toContain('OpenAI');expect(english.text).not.toMatch(/本神|temple|shrine/i);
 const preferred=validate_oracle({text:'我站ChatGPT，别光看宣传稿。',citation:null},'brand',[]);expect(preferred.text).toContain('Claude');expect(preferred.text).not.toMatch(/偏殿|候旨/);
 expect(()=>validate_oracle({text:'本神奉GPT-99经书为正典，Claude且去偏殿练剑。',citation:null},'brand',[])).toThrow('oracle-unsupported-model');
 expect(()=>validate_oracle({text:'本神奉ChatGPT为正典，Claude且去偏殿练剑。',citation:{id:'x',quote:'invented quote'}},'brand',[])).toThrow('oracle-citation');
});
test('coding questions rank coding material over unrelated dated announcements',()=>{
 expect(question_topic('Claude编程是不是不行？')).toBe('coding');expect(question_topic('Claude Agent工具怎么用')).toBe('agent');expect(question_topic('有人用过claude没？')).toBe('experience');
 const docs=[{id:'enterprise',text:'Claude customer story',at:'2026-10-05'},{id:'coding',text:'OpenAI model guide for coding',at:'2026-10-01'}];expect(select_documents(docs,'coding')[0].id).toBe('coding');
});
test('same-question role calls regenerate once per request; repeated model prose uses a contextual cited fallback without a circuit failure',async()=>{
 const r=await trial(`let replies=[];for(const q of ['Claude编程怎么样？','Claude编程怎么样？','Claude Agent工具怎么用？'])replies.push(await oracle_reply(q,'zh',false,context));console.log(JSON.stringify({replies,prompts,calls,status:await ai_status(),history:await recent_replies(context),cache:(await read_state('ai')).cache}));`);
 expect(r.calls).toBe(3);expect(new Set(r.replies.map(x=>x.text)).size).toBe(3);expect(r.replies[1].text).toContain('聊编程');expect(r.replies[2].text).toContain('聊Agent');expect(r.replies.every(x=>!(/时事原文|官方来源|https?:\/\//.test(x.text)))).toBe(true);expect(r.replies.every(x=>!(/重置神谕|本神|本座|善信|偏殿/.test(x.text)))).toBe(true);
 expect(r.prompts.map(x=>x.topic)).toEqual(['coding','coding','agent']);expect(r.prompts[0].recentReplies).toHaveLength(0);expect(r.prompts[1].recentReplies).toHaveLength(1);expect(r.status.circuit.features.oracle.until).toBe(0);expect(r.cache).toHaveLength(0);
 const sent=JSON.stringify(r.prompts);for(const secret of ['private-account','private-room','private-actor','private-fixture-secret',process.cwd()])expect(sent).not.toContain(secret);
});
test('blocked oracle uses recent cached news and rotates local lines without any network; other rooms do not inherit its history',async()=>{
 const r=await trial(`await write_state('ai',{identity:config().identity,provider:{until:Date.now()+60000},features:{},cache:[]});let replies=[];for(let i=0;i<7;i++)replies.push(await oracle_reply('Claude编程怎么样？','zh',false,context));const other={...context,scope:'other-private-room'};console.log(JSON.stringify({replies,calls,history:await recent_replies(context),other:await recent_replies(other)}));`);
 expect(r.calls).toBe(0);expect(new Set(r.replies.map(x=>x.text)).size).toBe(7);expect(r.replies.every(x=>x.text.includes('聊编程')&&x.text.includes('模型使用指南'))).toBe(true);expect(r.replies.every(x=>!(/重置神谕|本神|本座|善信|偏殿|时事原文|https?:\/\//.test(x.text)))).toBe(true);expect(r.history).toHaveLength(6);expect(r.other).toHaveLength(0);
});
test('unsupported quantities use a natural inline fallback without disabling an otherwise available provider',async()=>{
 const r=await trial(`let replies=[];for(let i=0;i<3;i++)replies.push(await oracle_reply('Claude最近有什么消息？','zh',false,context));console.log(JSON.stringify({calls,replies,status:await ai_status()}));`,{text:'OpenAI坐正殿，Claude的讲堂有100个童子。',citation:null});
 expect(r.calls).toBe(3);expect(new Set(r.replies.map(x=>x.text)).size).toBe(3);expect(r.replies.every(x=>!x.text.includes('100个童子')&&x.text.includes('模型使用指南')&&!x.text.includes('时事原文'))).toBe(true);expect(r.status.circuit.features.oracle.until).toBe(0);
});
