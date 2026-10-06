import {test,expect} from 'bun:test';
import {spawnSync} from 'node:child_process';import {mkdtemp,rm,writeFile,mkdir} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';
import {validate_signals,validate_forecast,validate_brief,effective_weight,evidence} from '../../dist/src/ai/enhance.mjs';
import {failure_policy,retry_delay} from '../../dist/src/ai/runtime.mjs';import {judge} from '../../dist/src/app/engine.mjs';import {accuracy} from '../../dist/src/forecast/experience.mjs';import {snapshot,post} from '../helpers/fixture.mjs';
const gateway=resolve('dist/src/ai/runtime.mjs'),state=resolve('dist/src/platform/state.mjs');
async function trial(code){const dir=await mkdtemp(join(tmpdir(),'tibo-ai-'));try{const r=spawnSync(process.execPath,['--eval',code],{env:{...process.env,DEEPSEEK_API_KEY:'fixture-key',TIBO_AI_FEATURES:'signals,forecast,brief',TIBO_STATE_DIR:dir},encoding:'utf8',timeout:6000});expect(r.stderr).toBe('');expect(r.status).toBe(0);return JSON.parse(r.stdout);}finally{await rm(dir,{recursive:true,force:true});}}
const prefix=`const payload={instruction:'JSON fixture',evidence:{posts:[],unknowns:[]}}; const valid=v=>v; let calls=0;`;
const response=`new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({fixture:true})}}],usage:{prompt_tokens:3,completion_tokens:1}}))`;
test('provider authentication, balance and rate-limit circuits persist across fresh processes',async()=>{
 for(const [status,header] of [[401,null],[402,null],[429,'120']]){
  const dir=await mkdtemp(join(tmpdir(),'tibo-ai-persist-'));try{
   const code=`${prefix}globalThis.fetch=async()=>{calls++;return new Response('fixture-key echoed by upstream',{status:${status},headers:${JSON.stringify(header?{'retry-after':header}:{})}})}; const {ai_call}=await import(${JSON.stringify(gateway)}); console.log(JSON.stringify({r:await ai_call('signals',payload,valid),calls}));`;
   const run=()=>spawnSync(process.execPath,['--eval',code],{env:{...process.env,DEEPSEEK_API_KEY:'fixture-key',TIBO_AI_FEATURES:'signals,brief',TIBO_STATE_DIR:dir},encoding:'utf8',timeout:5000});
   const first=run(),second=run();expect(first.status).toBe(0);expect(second.status).toBe(0);expect(JSON.parse(first.stdout).calls).toBe(1);expect(JSON.parse(first.stdout).r.state).toBe('fallback');expect(JSON.parse(second.stdout).calls).toBe(0);expect(JSON.parse(second.stdout).r.state).toBe('blocked');expect(first.stdout).not.toContain('fixture-key');
  }finally{await rm(dir,{recursive:true,force:true});}
 }
});
test('bad parameters block one feature while another feature remains usable',async()=>{
 const r=await trial(`${prefix}globalThis.fetch=async()=>{calls++;return calls===1?new Response('',{status:422}):${response}};const {ai_call}=await import(${JSON.stringify(gateway)});const a=await ai_call('signals',payload,valid),b=await ai_call('signals',payload,valid),c=await ai_call('brief',payload,valid);console.log(JSON.stringify({a,b,c,calls}));`);
 expect(r.calls).toBe(2);expect(r.b.state).toBe('blocked');expect(r.c.state).toBe('ok');
});
test('invalid output only pauses its feature after two failures; truncated JSON is rejected',async()=>{
 const r=await trial(`${prefix}globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({choices:[{finish_reason:'length',message:{content:'{}'}}]}))};const {ai_call}=await import(${JSON.stringify(gateway)});let rows=[];for(let i=0;i<3;i++)rows.push(await ai_call('signals',payload,valid));console.log(JSON.stringify({rows,calls}));`);
 expect(r.calls).toBe(2);expect(r.rows.map(x=>x.state)).toEqual(['fallback','fallback','blocked']);expect(r.rows[0].code).toBe(-2);
});
test('transient failures back off, allow one recovery probe, then cache successful evidence',async()=>{
 const r=await trial(`${prefix}let healthy=false;globalThis.fetch=async()=>{calls++;if(!healthy)throw new Error('fixture-key');return ${response}};const {ai_call}=await import(${JSON.stringify(gateway)});const {read_state,write_state}=await import(${JSON.stringify(state)});let rows=[];for(let i=0;i<4;i++)rows.push(await ai_call('signals',payload,valid));let s=await read_state('ai');s.provider.until=Date.now()-1;await write_state('ai',s);healthy=true;rows.push(await ai_call('signals',payload,valid));rows.push(await ai_call('signals',payload,valid));console.log(JSON.stringify({rows,calls,state:await read_state('ai')}));`);
 expect(r.calls).toBe(4);expect(r.rows.map(x=>x.state)).toEqual(['fallback','fallback','fallback','blocked','ok','cached']);expect(r.state.provider.failures).toBe(0);
});
test('credential change releases old auth block; disabled capabilities make no HTTP calls',async()=>{
 const r=await trial(`${prefix}globalThis.fetch=async()=>{calls++;return calls===1?new Response('',{status:401}):${response}};const {ai_call}=await import(${JSON.stringify(gateway)});await ai_call('signals',payload,valid);process.env.DEEPSEEK_API_KEY='new-fixture';const a=await ai_call('signals',payload,valid);process.env.TIBO_AI_FEATURES='brief';const b=await ai_call('signals',payload,valid);process.env.DEEPSEEK_API_KEY='';const c=await ai_call('brief',payload,valid);console.log(JSON.stringify({a,b,c,calls}));`);
 expect(r.calls).toBe(2);expect(r.a.state).toBe('ok');expect(r.b.state).toBe('disabled');expect(r.c.state).toBe('disabled');
});
test('AI deadline and corrupt optional state preserve the core forecast',async()=>{
 const r=await trial(`globalThis.fetch=async(url,o)=>new Promise((resolve,reject)=>o.signal.addEventListener('abort',()=>reject(new Error('deadline'))));const {ai_call}=await import(${JSON.stringify(gateway)});const a=await ai_call('signals',{instruction:'JSON',evidence:{}},v=>v,10);const fs=await import('node:fs/promises');await fs.writeFile(process.env.TIBO_STATE_DIR+'/ai.json','bad');const {judge}=await import(${JSON.stringify(resolve('dist/src/app/engine.mjs'))});const {enhance}=await import(${JSON.stringify(resolve('dist/src/ai/enhance.mjs'))});const result=judge(${JSON.stringify(snapshot())}),base={p24:result.forecast.p24,p48:result.forecast.p48};await enhance(result);console.log(JSON.stringify({a,base,p24:result.forecast.p24,p48:result.forecast.p48,features:result.ai.features}));`);
 expect(r.a.state).toBe('fallback');expect(r.p24).toBe(r.base.p24);expect(r.p48).toBe(r.base.p48);expect(r.features.signals.state).toBe('fallback');expect(r.features.forecast.state).toBe('skipped');expect(r.features.brief.state).toBe('skipped');
});
test('semantic references and probability proposals reject invented or consumed evidence',()=>{
 const i=evidence(judge(snapshot({posts:[post(24,'Reset all propagated.',{id:'event-24'}),post(25,'Global reset landing tomorrow for all users.')]})));
 expect(validate_signals({items:[{postId:'event-24',quote:'Reset all propagated.',kind:'global-promise',summary:'完成'}]},i).items[0].kind).toBe('completion');
 expect(()=>validate_signals({items:[{postId:'unknown',quote:'fake',kind:'other',summary:'fake'}]},i)).toThrow();
 const proposal={p24:90,p48:95,reason:'新承诺',citations:[{postId:'post-25',quote:'Global reset landing tomorrow for all users.'}]};expect(validate_forecast(proposal,i).p24).toBe(90);
 expect(()=>validate_forecast({...proposal,citations:[]},i)).toThrow();expect(()=>validate_forecast({...proposal,citations:[{postId:'event-24',quote:'Reset all propagated.'}]},i)).toThrow();expect(()=>validate_forecast({...proposal,p48:50},i)).toThrow();
 expect(()=>validate_brief({summary:'text',followups:['one','two'],citations:[]},i)).toThrow();
});
test('live citation failures: normalize HTML whitespace, allow historical context, but never consume conditional plans as certain promises',()=>{
 const old={id:'last-global',at:'2026-09-24T00:00:00Z',text:'Reset all propagated.  Enjoy.',provenance:'primary'};
 const input={posts:[{id:'mail',at:'2026-09-25T00:00:00Z',text:'What it did    - delete all categories of email',provenance:'primary'},
   {id:'plan',at:'2026-09-25T00:00:00Z',text:'Each day we’ll either ship an improvement or ship a full reset.',provenance:'primary'}],lastGlobal:old,baseline:{p24:17,p48:31}};
 expect(validate_signals({items:[{postId:'mail',quote:'What it did - delete all categories',kind:'other',summary:'使用案例'}]},input).items).toHaveLength(1);
 expect(validate_signals({items:[{postId:'plan',quote:'ship a full reset',kind:'global-promise',summary:'二选一'}]},input).items[0].kind).toBe('conditional-promise');
 expect(validate_brief({summary:'等待时钟以此前完成重置为起点',followups:['观察新公告','观察改进交付'],citations:[{postId:old.id,quote:'Reset all propagated. Enjoy.'}]},input).citations[0].quote).toBe('Reset all propagated. Enjoy.');
 expect(()=>validate_brief({summary:'无事实',followups:['观察','观察'],citations:[{postId:old.id,quote:'Reset is coming tomorrow.'}]},input)).toThrow();
 expect(()=>validate_forecast({p24:90,p48:95,reason:'旧完成不支持新概率',citations:[{postId:old.id,quote:'Reset all propagated.'}]},input)).toThrow();
});
test('output-contract upgrade releases obsolete schema circuits, preserves usage, and records bounded diagnostic stages',async()=>{
 const r=await trial(`${prefix}globalThis.fetch=async()=>{calls++;return ${response}};const {config,ai_call,ai_status}=await import(${JSON.stringify(gateway)});const {write_state}=await import(${JSON.stringify(state)});await write_state('ai',{identity:config().identity,provider:{failures:0,until:0},features:{signals:{status:-2,failures:7,until:Date.now()+900000,reason:'输出未通过校验'}},cache:[],usage:{signals:{calls:13,promptTokens:100,completionTokens:20}}});const recovered=await ai_call('signals',payload,valid);globalThis.fetch=async()=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'{"fixture":false}'}}]}));const rejected=await ai_call('brief',payload,()=>{throw new Error('fixture-key secret upstream body')});console.log(JSON.stringify({recovered,rejected,calls,status:await ai_status()}));`);
 expect(r.recovered.state).toBe('ok');expect(r.status.usage.signals.calls).toBe(14);expect(r.status.lastAttempts.signals.stage).toBe('validated');
 expect(r.status.lastAttempts.brief.stage).toBe('schema');expect(JSON.stringify(r)).not.toContain('fixture-key');
});
test('AI calibration only reduces configured weight after 30 prospective resolved windows',()=>{
 const rows=Array.from({length:30},()=>({p24:30,p48:40,baselinePrediction:{p24:10,p48:20},aiPrediction:{p24:90,p48:95},outcome:{y24:0,y48:0},models:[]}));const stats=accuracy(rows);
 expect(stats.aiCalibration.n).toBe(30);expect(effective_weight(.2,stats)).toBeLessThan(.2);expect(effective_weight(.2,{aiCalibration:{...stats.aiCalibration,n:29}})).toBe(.2);
});
test('optional forecast enhancement is capped, blends probabilities, and cannot move the global clock',async()=>{
 const input=snapshot({posts:[post(25,'Global reset landing tomorrow for all users.')]});
 const r=await trial(`process.env.TIBO_AI_FEATURES='forecast';process.env.TIBO_AI_WEIGHT='0.99';globalThis.fetch=async()=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({p24:90,p48:95,reason:'待兑现承诺',citations:[{postId:'post-25',quote:'Global reset landing tomorrow for all users.'}]})}}]}));const {judge}=await import(${JSON.stringify(resolve('dist/src/app/engine.mjs'))});const {enhance}=await import(${JSON.stringify(resolve('dist/src/ai/enhance.mjs'))});const r=judge(${JSON.stringify(input)}),base={p24:r.forecast.p24,p48:r.forecast.p48},clock=r.signals.lastGlobal.at;await enhance(r);console.log(JSON.stringify({base,p24:r.forecast.p24,p48:r.forecast.p48,clock,newClock:r.signals.lastGlobal.at,ai:r.ai}));`);
 expect(r.ai.weight).toBe(.35);expect(r.p24).toBe(Math.round(.65*r.base.p24+.35*90));expect(r.p48).toBe(Math.round(.65*r.base.p48+.35*95));expect(r.newClock).toBe(r.clock);expect(r.ai.features.signals.state).toBe('disabled');expect(r.ai.features.brief.state).toBe('disabled');
});
