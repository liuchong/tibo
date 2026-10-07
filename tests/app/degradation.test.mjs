import {test,expect} from 'bun:test';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {snapshot,event,post} from '../helpers/fixture.mjs';
import {available_judgment,judge,run_report} from '../../dist/src/app/engine.mjs';
import {public_forecast} from '../../dist/src/commands/index.mjs';
import {signal_experience} from '../../dist/src/forecast/signal-model.mjs';
import {record_prediction} from '../../dist/src/forecast/experience.mjs';
import {read_state,write_state} from '../../dist/src/platform/state.mjs';
import {spawnSync} from 'node:child_process';import {resolve} from 'node:path';

test('missing clock verification disables elapsed models, with rates still available; missing background is explicit',()=>{
 const known=judge(snapshot()),unverified=judge(snapshot({posts:[],sources:[{name:'status',ok:false},{name:'archive',ok:false}]}));
 expect(known.forecast.model.candidates.filter(x=>x.weight>0)).toHaveLength(4);
 expect(unverified.forecast.model.candidates.filter(x=>x.weight>0).map(x=>x.name)).toEqual(['recent-rate','decayed-rate']);
 expect(unverified.forecast.mode).toBe('history-rate-fallback');expect(unverified.forecast.information.missing).toContain('官方事故资料');
 expect(unverified.forecast.p24).toBeGreaterThan(0);expect(unverified.forecast.p48).toBeGreaterThanOrEqual(unverified.forecast.p24);
});
test('insufficient history degrades to evidence rather than fabricated probability or a total command error',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'tibo-evidence-only-'));const old=process.env.TIBO_STATE_DIR;process.env.TIBO_STATE_DIR=dir;
 try{
  for(const events of [[],[event(24)],[event(1),event(24)]]){
   const s=snapshot({events}),path=join(dir,'snapshot.json');await writeFile(path,JSON.stringify(s));
   const r=await run_report({snapshotPath:path,channel:'cli'});expect(r.forecast.available).toBe(false);
   expect(r.report).toContain('暂无法估计');expect(r.report).not.toMatch(/\d+%/);expect(public_forecast(r,'both')).toContain('暂无法估计');
   expect(await read_state('experience')).toBeNull();expect(await read_state('report-cli')).toBeNull();
  }
 }finally{if(old===undefined)delete process.env.TIBO_STATE_DIR;else process.env.TIBO_STATE_DIR=old;await rm(dir,{recursive:true,force:true});}
});
test('signal learning needs real resolved samples and improves on chronological holdout; adverse validation and future outcomes reject',()=>{
 const rows=Array.from({length:30},(_,i)=>({at:new Date(Date.UTC(2026,0,1+i*2)).toISOString(),signal:'重置暗示',historicalPrediction:{p24:10,p48:20},outcome:{y24:1,y48:1,scoredAt:'2026-04-01T00:00:00Z'}}));
 expect(signal_experience(rows.slice(0,29),'重置暗示',10,20).applied).toBe(false);
 const positive=signal_experience(rows,'重置暗示',10,20,'2026-05-01T00:00:00Z');expect(positive.applied).toBe(true);expect(positive.validationN).toBe(10);expect(positive.p24).toBe(28);expect(positive.p48).toBe(36);
 const adverse=rows.map((x,i)=>({...x,outcome:{...x.outcome,y24:i<20?1:0,y48:i<20?1:0}}));
 expect(signal_experience(adverse,'重置暗示',10,20).applied).toBe(false);
 expect(signal_experience(rows,'重置暗示',10,20,'2026-02-01T00:00:00Z').n).toBe(0);
 expect(signal_experience(rows,'条件性重置计划',10,20).n).toBe(0);
});
test('failed history ingestion does not turn unresolved windows into negative experience; recovery can settle them',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'tibo-experience-health-')),old=process.env.TIBO_STATE_DIR;process.env.TIBO_STATE_DIR=dir;
 try{
  await write_state('experience',{predictions:[{at:'2026-09-01T00:00:00Z',p24:10,p48:20,models:[],signal:'未识别新承诺',outcome:null}]});
  await record_prediction(judge(snapshot()));expect((await read_state('experience')).predictions[0].outcome).toBeNull();
  await record_prediction(judge(snapshot({sources:[{name:'archive',ok:true}]})));expect((await read_state('experience')).predictions[0].outcome).toBeNull();
  await record_prediction(judge(snapshot({sources:[{name:'archive',ok:true}],posts:[...snapshot().posts,post(3,'Reset all propagated.',{id:'event-3'})]})));expect((await read_state('experience')).predictions[0].outcome.y48).toBe(1);
 }finally{if(old===undefined)delete process.env.TIBO_STATE_DIR;else process.env.TIBO_STATE_DIR=old;await rm(dir,{recursive:true,force:true});}
});

test('corrupt optional experience preserves the file and still returns and saves a native forecast',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'tibo-corrupt-experience-'));
 try{
  const damaged='{broken optional experience';await writeFile(join(dir,'experience.json'),damaged);
  await writeFile(join(dir,'ledger.json'),JSON.stringify(snapshot()));
  const module=JSON.stringify(resolve('dist/src/app/engine.mjs'));
  const r=spawnSync(process.execPath,['--eval',`globalThis.fetch=async()=>new Response('',{status:503});const {run_report}=await import(${module});const result=await run_report({noAi:true});console.log(JSON.stringify({forecast:result.forecast,report:result.report}));`],{
   env:{...process.env,TIBO_STATE_DIR:dir,DEEPSEEK_API_KEY:'',TIBO_AI_FEATURES:''},encoding:'utf8',timeout:7000});
  expect(r.stderr).toBe('');expect(r.status).toBe(0);const result=JSON.parse(r.stdout);
  expect(result.forecast.p24).toBeGreaterThan(0);expect(result.forecast.information.experienceUnavailable).toBe(true);
  expect(await Bun.file(join(dir,'experience.json')).text()).toBe(damaged);
  const diagnostics=await Bun.file(join(dir,'diagnostics-cli.json')).json();expect(diagnostics.forecast.information.experienceUnavailable).toBe(true);
  expect((await Bun.file(join(dir,'report-cli.json')).json()).p24).toBe(result.forecast.p24);
 }finally{await rm(dir,{recursive:true,force:true});}
});
