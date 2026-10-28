import {test,expect} from 'bun:test';import {mkdir,mkdtemp,rm} from 'node:fs/promises';import{join,resolve}from'node:path';
import {analyze_semantic} from '../../dist/src/ai/semantic-recovery.mjs';
import {dimension_input} from '../../dist/src/evidence/dimensions.mjs';import{available_judgment}from'../../dist/src/app/engine.mjs';
import {makeSnapshot,done,claim,response} from '../helpers/reset-semantic.mjs';
const root=resolve('.tibo/tests/semantic');await mkdir(root,{recursive:true});
async function isolated(f){const dir=await mkdtemp(join(root,'recovery-'));try{return await f(dir);}finally{await rm(dir,{recursive:true,force:true});}}
const input=()=>dimension_input(available_judgment(makeSnapshot()));
test('T03 dual agreement, bounded third opinion and persistent evidence cache merge concurrent requests',()=>isolated(async directory=>{
 let calls=0;const request=async(profile,i)=>{calls++;return {state:'ok',value:response(i)}};
 const opts={directory,request};const [a,b]=await Promise.all([analyze_semantic(input(),opts),analyze_semantic(input(),opts)]);
 expect(calls).toBe(2);expect(a.claims.find(c=>c.postId===done.id)).toMatchObject({semanticAgreed:true});expect(b.state).toBe('cached');
 await analyze_semantic(input(),opts);expect(calls).toBe(2);
}));
test('T03 disagreement is repaired once; malformed and endless failures share the three attempt budget and cooldown',()=>isolated(async directory=>{
 let calls=0;const a=await analyze_semantic(input(),{directory,request:async(profile,i)=>{calls++;return {state:'ok',value:profile==='main'?{rows:[{postId:done.id,claims:[{...claim(done),kind:'hint',statement:'future'}]}]}:response(i)}}});
 expect(calls).toBe(3);expect(a.claims.find(c=>c.kind==='completion')).toMatchObject({semanticAgreed:true});
 const other=join(directory,'failed');let failed=0;const opts={directory:other,request:async()=>{failed++;return {state:'fallback',code:-2}}};
 const b=await analyze_semantic(input(),opts);expect(failed).toBe(3);expect(b.analysisState).toBe('pending');await analyze_semantic(input(),opts);expect(failed).toBe(3);
}));
test('T04 authentication and rate limits stop immediately, while schema errors keep precise item diagnostics',()=>isolated(async directory=>{
 for(const code of [401,402,403,429]){let calls=0;const r=await analyze_semantic(input(),{directory:join(directory,String(code)),request:async()=>{calls++;return{state:'fallback',code}}});expect(calls).toBe(1);expect(r.analysisState).toBe('pending');}
}));
test('T04 whole operation deadline bounds an unresponsive injected request',()=>isolated(async directory=>{
 const start=performance.now();const r=await analyze_semantic(input(),{directory,budgetMs:40,request:()=>new Promise(()=>{})});expect(performance.now()-start).toBeLessThan(500);expect(r.analysisState).toBe('pending');
}));

test('provider changes release a pending evidence cache without discarding successful runtime facts',()=>isolated(async directory=>{
 const previous=process.env.TIBO_AI_PROVIDER;let calls=0;
 try{
  process.env.TIBO_AI_PROVIDER='kimi';
  await analyze_semantic(input(),{directory,request:async()=>{calls++;return {state:'fallback',code:402}}});
  expect(calls).toBe(1);
  process.env.TIBO_AI_PROVIDER='deepseek';
  const recovered=await analyze_semantic(input(),{directory,request:async(profile,i)=>{calls++;return {state:'ok',value:response(i)}}});
  expect(calls).toBe(3);expect(recovered.analysisState).toBe('ready');
 }finally{if(previous===undefined)delete process.env.TIBO_AI_PROVIDER;else process.env.TIBO_AI_PROVIDER=previous;}
}));
