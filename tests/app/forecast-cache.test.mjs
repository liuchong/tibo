import {test,expect} from 'bun:test';
import {spawnSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
const cache=JSON.stringify(resolve('dist/src/app/forecast-cache.mjs'));
const state=JSON.stringify(resolve('dist/src/platform/state.mjs'));
const engine=JSON.stringify(resolve('dist/src/app/engine.mjs'));
const fixture=JSON.stringify(resolve('tests/helpers/fixture.mjs'));
const setup=`let now=Date.parse('2026-10-09T11:30:00Z');Date.now=()=>now;
const {cached_forecast,invalidate_forecast,ttl_ms}=await import(${cache});
const {read_state,write_state}=await import(${state});const {judge}=await import(${engine});
const {snapshot}=await import(${fixture});let calls=0;
const result=()=>({...judge(snapshot({now:new Date(now).toISOString()})),timing:{collectionMs:40,analysisMs:20}});
const generate=async()=>{calls++;return result()};`;
async function trial(body,prefix=''){
 const dir=await mkdtemp(join(tmpdir(),'tibo-forecast-cache-'));
 try{
  const r=spawnSync(process.execPath,['--eval',prefix+setup+body],{env:{...process.env,TIBO_CONFIG_FILE:'/dev/null',TIBO_STATE_DIR:dir,
   DEEPSEEK_API_KEY:'fixture-cache-key',TIBO_AI_FEATURES:'signals,brief',TIBO_AI_WEIGHT:'0.2'},encoding:'utf8',timeout:10000,maxBuffer:2000000});
  expect(r.status,r.stderr).toBe(0);return JSON.parse(r.stdout);
 }finally{await rm(dir,{recursive:true,force:true});}
}
test('eight concurrent callers share generation, independent mutable copies and the original collection clock',async()=>{
 const r=await trial(`let release;const gate=new Promise(r=>release=r);const slow=async()=>{calls++;await gate;const r=result();await write_state('ledger',{events:r.snapshot.events,posts:r.snapshot.posts});return r};const jobs=Array.from({length:8},(_,i)=>cached_forecast({channel:'room'+i,horizon:i%2?'24':'48',language:i%2?'en':'zh'},slow));for(let i=0;i<100&&!calls;i++)await new Promise(r=>setTimeout(r,1));const before=calls;release();const out=await Promise.all(jobs);out[0].forecast.p24=99;out[1].snapshot.posts[0].text='modified privately';now+=30000;const later=await cached_forecast({channel:'cli'},generate);console.log(JSON.stringify({before,calls,states:out.map(r=>r.reuse.state),clocks:out.map(r=>r.snapshot.now),later,timing:out[2].timing}));`);
 expect(r.before).toBe(1);expect(r.calls).toBe(1);expect(r.states).toEqual(['fresh',...Array(7).fill('cached')]);expect(new Set(r.clocks).size).toBe(1);expect(r.later.forecast.p24).not.toBe(99);expect(r.later.snapshot.posts[0].text).not.toContain('modified');expect(r.later.reuse.ageMs).toBe(30000);expect(r.timing).toEqual({collectionMs:0,analysisMs:0});
});
test('hits never extend TTL; expiry and clock rollback require a new generation',async()=>{
 const r=await trial(`const first=await cached_forecast({},generate);now+=119999;const hit=await cached_forecast({},generate);now++;const expired=await cached_forecast({},generate);now-=1000;const rollback=await cached_forecast({},generate);console.log(JSON.stringify({calls,first:first.reuse,hit:hit.reuse,expired:expired.reuse,rollback:rollback.reuse}));`);
 expect(r.calls).toBe(3);expect(r.hit.state).toBe('cached');expect(r.hit.ageMs).toBe(119999);expect(r.expired.state).toBe('fresh');expect(r.rollback.state).toBe('fresh');
});
test('new public evidence, experience, relevant configuration and AI recovery invalidate; unrelated wish usage does not',async()=>{
 const r=await trial(`const {config}=await import(${JSON.stringify(resolve('dist/src/ai/runtime.mjs'))});let states=[];const ask=async()=>states.push((await cached_forecast({},generate)).reuse.state);await ask();await write_state('ledger',{events:[],posts:[{id:'new',text:'reset has been processed'}]});await ask();await write_state('experience',{accuracy:{resolved:31,models:[]}});await ask();process.env.TIBO_AI_WEIGHT='0.3';await ask();await write_state('ai',{identity:config().identity,features:{},provider:{status:429,until:now+1000},usage:{wish:{calls:1}}});await ask();let ai=await read_state('ai');ai.usage.wish.calls++;await write_state('ai',ai);await ask();now+=1001;await ask();await invalidate_forecast();await ask();const native=await cached_forecast({noAi:true},generate);const nativeHit=await cached_forecast({noAi:true},generate);console.log(JSON.stringify({calls,states,native:native.reuse.state,nativeHit:nativeHit.reuse.state}));`);
 expect(r.states).toEqual(['fresh','fresh','fresh','fresh','fresh','cached','fresh','fresh']);expect(r.calls).toBe(8);expect(r.native).toBe('fresh');expect(r.nativeHit).toBe('cached');
});
test('failed generation and corrupt optional cache cannot poison later requests; old collections are not cached',async()=>{
 const r=await trial(`let failed=false;try{await cached_forecast({},async()=>{throw Error('failed generation')})}catch{failed=true}await write_state('forecast-cache-ai',{schemaVersion:1,expiresAt:now+ttl_ms,result:{forecast:{},snapshot:{now:'invalid'}}});const a=await cached_forecast({},generate);await invalidate_forecast();const long=async()=>{calls++;const r=result();now+=ttl_ms+1;return r};const b=await cached_forecast({},long);const c=await cached_forecast({},generate);console.log(JSON.stringify({failed,calls,states:[a.reuse.state,b.reuse.state,c.reuse.state]}));`);
 expect(r.failed).toBe(true);expect(r.calls).toBe(3);expect(r.states).toEqual(['fresh','fresh','fresh']);
});
test('administrator or configuration changes during generation prevent a stale cache write',async()=>{
 const r=await trial(`await cached_forecast({},async()=>{calls++;await invalidate_forecast();return result()});const first=await read_state('forecast-cache-ai');await cached_forecast({},generate);await invalidate_forecast();await cached_forecast({},async()=>{calls++;process.env.TIBO_AI_WEIGHT='0.31';return result()});const after=await cached_forecast({},generate);console.log(JSON.stringify({calls,first,after:after.reuse.state}));`);
 expect(r.first).toBeNull();expect(r.calls).toBe(4);expect(r.after).toBe('fresh');
});
test('offline, supplied snapshots and schedule slots bypass the interactive cache entirely',async()=>{
 const r=await trial(`for(const option of [{offline:true},{snapshotPath:'fixture'},{titleTime:new Date(now).toISOString()},{channel:'schedule'}]){await cached_forecast(option,generate);await cached_forecast(option,generate)}console.log(JSON.stringify({calls,saved:await read_state('forecast-cache-ai')}));`);
 expect(r.calls).toBe(8);expect(r.saved).toBeNull();
});
test('separate processes share the completed forecast and only one performs generation',async()=>{
 const r=await trial(`const child=${JSON.stringify(setup+`const r=await cached_forecast({},async()=>{const count=(await read_state('trial-count'))||{n:0};await write_state('trial-count',{n:count.n+1});await new Promise(r=>setTimeout(r,250));return result()});console.log(JSON.stringify({state:r.reuse.state,at:r.snapshot.now}));`)};const run=async()=>{const p=Bun.spawn([process.execPath,'--eval',child],{env:process.env,stdout:'pipe',stderr:'pipe'});const out=await new Response(p.stdout).text(),err=await new Response(p.stderr).text();if(await p.exited)throw Error(err);return JSON.parse(out)};const rows=await Promise.all([run(),run(),run()]);console.log(JSON.stringify({rows,count:await read_state('trial-count')}));`);
 expect(r.count.n).toBe(1);expect(r.rows.map(x=>x.state).toSorted()).toEqual(['cached','cached','fresh']);expect(new Set(r.rows.map(x=>x.at)).size).toBe(1);
});
test('actual engine shares collection across callers and persists each channel without duplicating prediction samples',async()=>{
 const r=await trial(`const seed=snapshot({now:new Date(now-1000).toISOString()});await write_state('ledger',{schemaVersion:1,...seed});const {run_report}=await import(${engine});const first=await run_report({channel:'cli',noAi:true});const before=network;const many=await Promise.all(Array.from({length:8},(_,i)=>run_report({channel:'im'+i,noAi:true})));const experience=await read_state('experience');console.log(JSON.stringify({before,network,first:first.reuse,states:many.map(x=>x.reuse.state),timestamps:many.map(x=>x.snapshot.now),experience:experience.predictions.length,saved:await read_state('report-im7')}));`,
 `let network=0;globalThis.fetch=async()=>{network++;return new Response('',{status:503})};`);
 expect(r.before).toBeGreaterThan(0);expect(r.network).toBe(r.before);expect(r.first.state).toBe('fresh');expect(r.states.every(x=>x==='cached')).toBe(true);expect(new Set(r.timestamps).size).toBe(1);expect(r.experience).toBe(1);expect(r.saved.now).toBe(r.timestamps[0]);
});
