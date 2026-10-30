import {test,expect} from 'bun:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
const root=resolve('dist');
async function trial(code){
 const dir=await mkdtemp(join(tmpdir(),'tibo-model-rebuttal-'));
 try{
  const r=spawnSync(process.execPath,['--eval',code],{env:{...process.env,TIBO_CONFIG_FILE:join(dir,'absent.env'),TIBO_STATE_DIR:dir,TIBO_AI_FEATURES:'trigger,read,answer',DEEPSEEK_API_KEY:'fixture-key',TIBO_LARK_APP_ID:'fixture-app',TIBO_LARK_DOMAIN:'lark'},encoding:'utf8',timeout:9000,maxBuffer:500000});
  expect(r.status,r.stderr).toBe(0);return JSON.parse(r.stdout);
 }finally{await rm(dir,{recursive:true,force:true});}
}
const setup=`
let now=Date.now();Date.now=()=>now;const prompts=[],posts=[];let answerGate=null;
const result=value=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}]});
globalThis.fetch=async(u,o)=>{
 const b=JSON.parse(o.body);prompts.push(b);const e=JSON.parse(b.messages.at(-1).content);
 if(b.max_tokens===120)return result({scores:Object.fromEntries(e.keywords.map(k=>[k,0.10])),rebuttal:!e.text.includes('不是说')});
 if(b.max_tokens===600)return result({topic:'model comparison',queries:[]});
 if(b.max_tokens===1200){if(answerGate)await answerGate;return result({text:'我站GPT和Codex。Gemini可以有亮点，这就给整个系列办退场仪式，也太急着撤椅子了。'});}
 throw Error('Unexpected model task');
};
const {message_candidate,sender_context,delivery_key}=await import(${JSON.stringify(root+'/adapters/lark/service.mjs')});
const {process_interaction}=await import(${JSON.stringify(root+'/adapters/lark/interaction.mjs')});
const {read_state}=await import(${JSON.stringify(root+'/src/platform/state.mjs')});
const client={send:async b=>{posts.push(JSON.parse(b.content).zh_cn.content[0][0].text);return {code:0,data:{message_id:'om_reply'+posts.length}}}};
function job(text,id,scope='oc_room'){
 const event={sender:{sender_type:'user',sender_id:{open_id:'ou_member'}},message:{message_id:id,chat_id:scope,chat_type:'group',message_type:'text',content:JSON.stringify({text}),mentions:[]}};
 const c=message_candidate(event,['all'],'ou_bot');
 return {group:scope,key:id,command:c.command,triggerLevel:c.level,triggerKind:c.kind,companion:c.companion,prayerMaterial:c.material,context:sender_context(event),createdAt:new Date(now).toISOString()};
}
`;
test('unmentioned low-score GPT comparison reaches semantic classification and delivers a specific rebuttal without router calls',async()=>{
 const r=await trial(setup+`const j=job('Gemini4 argon效果蛮好的，至少吊打了gpt系列了','om_compare');await process_interaction(client,j);await process_interaction(client,j);console.log(JSON.stringify({posts,prompts,receipt:await read_state(delivery_key(j.group,j.key))}));`);
 expect(r.posts).toHaveLength(1);expect(r.posts[0]).toContain('Gemini');expect(r.posts[0]).not.toContain('Claude');
 expect(r.receipt.state).toBe('sent');expect(r.receipt.businessOk).toBe(true);
 expect(r.prompts.map(b=>b.max_tokens)).toEqual([120,600,1200]);
 const evidence=JSON.parse(r.prompts[2].messages.at(-1).content);
 expect(evidence.replyIntent).toBe('openai-rebuttal');expect(evidence.question).toContain('吊打了gpt');
 for(const p of r.prompts){expect(p.tools).toBeUndefined();expect(JSON.stringify(p)).not.toMatch(/ou_member|oc_room|fixture-key|fixture-app/);}
});
test('Codex-only comparison upgrades third-layer admission only after semantic confirmation; negated criticism stays quiet',async()=>{
 const r=await trial(setup+`const positive=job('Gemini比Codex强多了','om_codex');const negative=job('Gemini不错，不是说Codex不行','om_negated','oc_other');await process_interaction(client,positive);await process_interaction(client,negative);console.log(JSON.stringify({posts,prompts,level:positive.triggerLevel,negative:await read_state(delivery_key(negative.group,negative.key))}));`);
 expect(r.level).toBe(3);expect(r.posts).toHaveLength(1);expect(r.negative.state).toBe('filtered');
 expect(r.prompts.filter(b=>b.max_tokens===120)).toHaveLength(2);
 expect(r.prompts.filter(b=>b.max_tokens===1200)).toHaveLength(1);
});
test('prayer and rebuttal remain independent concurrent tasks; subsequent comparison respects the speech budget without another classifier call',async()=>{
 const r=await trial(setup+`let release;answerGate=new Promise(r=>release=r);const j=job('Gemini吊打gpt了🙏','om_compound');const running=process_interaction(client,j);for(let i=0;i<100&&!posts.length;i++)await new Promise(r=>setTimeout(r,5));const first=[...posts];release();await running;now+=16000;await process_interaction(client,job('Gemini又吊打gpt了','om_cooling'));console.log(JSON.stringify({first,posts,prompts,prayer:await read_state('pray-identities'),root:await read_state(delivery_key(j.group,j.key)),suppressed:await read_state(delivery_key('oc_room','om_cooling'))}));`);
 expect(r.first).toHaveLength(1);expect(r.first[0]).toContain('🙏 香客');expect(r.posts).toHaveLength(2);
 expect(r.prayer.offers).toBe(1);expect(r.root.state).toBe('handled');expect(r.suppressed.state).toBe('suppressed');
 expect(r.prompts.filter(b=>b.max_tokens===120)).toHaveLength(1);
});
test('confirmed semantic intent still produces a short stance reply when answer generation fails',async()=>{
 const r=await trial(setup+`const provider=globalThis.fetch;globalThis.fetch=async(u,o)=>JSON.parse(o.body).max_tokens===1200?new Response('',{status:503}):provider(u,o);await process_interaction(client,job('Gemini4比gpt强多了','om_fallback'));console.log(JSON.stringify({posts,receipt:await read_state(delivery_key('oc_room','om_fallback'))}));`);
 expect(r.posts).toHaveLength(1);expect(r.posts[0]).toMatch(/GPT|OpenAI/);expect(r.posts[0]).not.toContain('Claude');expect(r.receipt.businessOk).toBe(true);
});
