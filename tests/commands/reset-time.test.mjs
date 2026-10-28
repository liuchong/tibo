// Constructed public evidence. The provider stub tests wiring, not model quality.
import {test,expect} from 'bun:test';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {snapshot} from '../helpers/fixture.mjs';
const root=resolve('.tibo/tests/reset-time');await mkdir(root,{recursive:true});
const id='2090000000000000001',deadline='2090000000000000002';
const s=snapshot({now:'2026-10-28T05:43:00Z',posts:[...snapshot().posts,
 {id,at:'2026-10-28T02:42:00Z',text:'We will reset usage for all paid accounts.',author:'thsottiaux',provenance:'primary'},
 {id:deadline,at:'2026-10-28T02:43:00Z',text:'Lands by midnight PST.',parentId:id,parentRelationProvenance:'official-page-data',author:'thsottiaux',provenance:'primary'}]});
test('fixed status and forecast carry one deadline contract; natural and quoted questions reach the answer with it',async()=>{
 const dir=await mkdtemp(join(root,'wiring-'));try{
  const path=join(dir,'evidence.json');await writeFile(path,JSON.stringify(s));
  const code=`const prompts=[];globalThis.fetch=async(u,o)=>{const b=JSON.parse(o.body),e=JSON.parse(b.messages.at(-1).content);prompts.push(b);const value=b.max_tokens===280?{command:'ask',args:{},language:'zh'}:b.max_tokens===600?{topic:'下一次重置时间',scope:{subject:'tibo',source:'current',quote:e.question},queries:[{command:'forecast',args:{}}]}:{text:e.builtinFacts.reads[0].data.resetTiming.targetLocal+' 前，可能提前。'};return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}]});};const{resolve_query,execute_query}=await import(${JSON.stringify(resolve('dist/src/commands/index.mjs'))});const options={snapshotPath:${JSON.stringify(path)},persist:false};const status=await execute_query({command:'status',args:{}},{...options,noAi:true});const forecast=await execute_query({command:'forecast',args:{}},options);const results=[];for(const [question,threadConversation] of [['具体什么时候重置？',undefined],['还有多久？',{state:'ready',messages:[{role:'assistant',content:'Tibo said: Lands by midnight PST.'}],quotedMessage:{role:'assistant',content:'Tibo said: Lands by midnight PST.'}}]]){const q=await resolve_query(question,null,{humanInput:true,conversationMode:!!threadConversation});results.push(await execute_query(q,{...options,threadConversation}));}console.log(JSON.stringify({status,forecastData:forecast.data,results,prompts}));`;
  const p=spawnSync(process.execPath,['--eval',code],{env:{...process.env,TIBO_CONFIG_FILE:join(dir,'absent.env'),TIBO_STATE_DIR:dir,TIBO_TIMEZONE:'Asia/Shanghai',TIBO_AI_FEATURES:'router,read,answer',TIBO_AI_PROVIDER:'deepseek',DEEPSEEK_API_KEY:'fixture-reset-time',TIBO_AI_API_KEY:'fixture-reset-time'},encoding:'utf8',timeout:10000});
  expect(p.status,p.stderr).toBe(0);const r=JSON.parse(p.stdout);
  expect(r.status.ok).toBe(true);expect(r.status.text).toContain('北京时间 10-28 16:00 前');expect(r.status.text).toContain('2 小时 17 分钟');expect(r.status.text).toContain('https://x.com/thsottiaux/status/'+deadline);
  expect(r.status.data.resetTiming).toMatchObject({state:'pending',asOf:s.now,targetAt:'2026-10-28T08:00:00.000Z',remainingSeconds:8220});
  expect(r.forecastData.resetTiming).toEqual(r.status.data.resetTiming);
  expect(r.results.every(x=>x.ok&&x.text.includes('16:00 前'))).toBe(true);
  const answers=r.prompts.filter(p=>p.max_tokens===1200);expect(answers).toHaveLength(2);
  for(const p of answers){const input=JSON.parse(p.messages.at(-1).content);expect(input.builtinFacts.reads[0].data.resetTiming.targetAt).toBe('2026-10-28T08:00:00.000Z');}
  expect(r.prompts).toHaveLength(6);for(const p of r.prompts){expect(p.tools).toBeUndefined();expect(p.functions).toBeUndefined();}
 }finally{await rm(dir,{recursive:true,force:true});}
});
