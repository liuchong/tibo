import {test,expect} from 'bun:test';
import {spawnSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';
const module=JSON.stringify(resolve('dist/src/ai/post-features.mjs'));
const state=JSON.stringify(resolve('dist/src/platform/state.mjs'));
const gateway=JSON.stringify(resolve('dist/src/ai/runtime.mjs'));
const posts=[{id:'2109045392684032299',at:'2026-10-10T22:16:20.441Z',author:'thsottiaux',text:'Global reset by EOD. May the tokens do good things for you.',provenance:'primary',privateExtra:'PRIVATE_RUNTIME_DATA'}];
const provider=`let calls=0,prompts=[];globalThis.fetch=async(u,o)=>{calls++;const request=JSON.parse(o.body),input=JSON.parse(request.messages.at(-1).content);prompts.push(input);return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({rows:input.posts.map(p=>({postId:p.id,claims:[{kind:'promise',subject:'codex-usage',scope:'global',statement:'future',quote:'Global reset by EOD.',timeText:'by EOD',contextMissing:false}]}))})}}]}))};`;
async function trial(code){const dir=await mkdtemp(join(tmpdir(),'tibo-post-features-'));try{
 const r=spawnSync(process.execPath,['--eval',code],{env:{...process.env,TIBO_STATE_DIR:dir,TIBO_CONFIG_FILE:join(dir,'absent.env'),TIBO_AI_FEATURES:'signals',DEEPSEEK_API_KEY:'fixture-features'},encoding:'utf8',timeout:6000});
 expect(r.status,r.stderr).toBe(0);return JSON.parse(r.stdout);
}finally{await rm(dir,{recursive:true,force:true});}}
test('per-post extraction is shared, cached beyond gateway TTL and readable during provider cooling',async()=>{
 const r=await trial(`${provider}const {extract_post_features}=await import(${module});const {read_state,write_state}=await import(${state});const {config}=await import(${gateway});const posts=${JSON.stringify(posts)};const first=await Promise.all([extract_post_features(posts),extract_post_features(posts)]);const ai=await read_state('ai');ai.cache=[];ai.provider={status:401,reason:'认证失败',until:Date.now()+86400000};await write_state('ai',ai);const cooled=await extract_post_features(posts);console.log(JSON.stringify({calls,first,cooled,prompts}));`);
 expect(r.calls).toBe(1);expect(r.first.every(x=>x.aiRows===1)).toBe(true);expect(r.cooled.rows[0].state).toBe('cached');expect(r.cooled.calls).toHaveLength(0);
 expect(JSON.stringify(r.prompts)).not.toContain('PRIVATE_RUNTIME_DATA');expect(r.prompts[0]).not.toHaveProperty('baseline');expect(r.prompts[0]).not.toHaveProperty('events');
});
test('changed body or parent context invalidates extraction; explicit no-AI never calls the provider',async()=>{
 const r=await trial(`${provider}const {extract_post_features,cache_key,public_post}=await import(${module});const p=${JSON.stringify(posts[0])};await extract_post_features([p]);await extract_post_features([{...p,parentId:'parent',parentText:'An explicit new context'}]);const native=await extract_post_features([{...p,text:p.text+' New sentence.'}],true);console.log(JSON.stringify({calls,native,keys:[cache_key(public_post(p)),cache_key(public_post({...p,text:p.text+' New sentence.'})),cache_key(public_post({...p,parentText:'context'}))]}));`);
 expect(r.calls).toBe(2);expect(new Set(r.keys).size).toBe(3);expect(r.native.ruleRows).toBe(1);expect(r.native.aiRows).toBe(0);
});
test('malformed extraction trips only its task circuit, keeps rules and never repeats a batch',async()=>{
 const r=await trial(`let calls=0;globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({p24:99,p48:100})}}]}))};const {extract_post_features}=await import(${module});const {ai_status}=await import(${gateway});const posts=${JSON.stringify(posts)};const a=await extract_post_features(posts),b=await extract_post_features(posts),c=await extract_post_features(posts);console.log(JSON.stringify({calls,a,b,c,status:await ai_status()}));`);
 expect(r.calls).toBe(2);expect(r.a.ruleRows).toBe(1);expect(r.a.rows[0].claims[0].kind).toBe('promise');expect(r.c.calls[0].state).toBe('blocked');expect(r.status.circuit.features.signals.status).toBe(-2);expect(r.status.circuit.provider.until).toBe(0);
});
test('partial semantic failure cools just that post; source grade upgrades revalidate without new API calls',async()=>{
 const r=await trial(`${provider}const {extract_post_features,cache_key,public_post}=await import(${module});const p=${JSON.stringify(posts[0])};const broken={...p,id:'release',text:'Today we will ship a product change.'};const a=await extract_post_features([{...p,provenance:'archive'},broken]);const b=await extract_post_features([{...p,provenance:'primary'},broken]);console.log(JSON.stringify({calls,a,b,sameKey:cache_key(public_post({...p,provenance:'archive'}))===cache_key(public_post(p))}));`);
 expect(r.calls).toBe(1);expect(r.sameKey).toBe(true);expect(r.a.aiRows).toBe(1);expect(r.b.rows[0].claims[0].provenance).toBe('primary');expect(r.b.rows[1].state).toBe('rules');expect(r.b.rows[1].retryAt).toBeDefined();
});

test('semantic promises reach the forecast policy without matching the fallback reset vocabulary',async()=>{
 const r=await trial(`let calls=0;globalThis.fetch=async(u,o)=>{calls++;const input=JSON.parse(JSON.parse(o.body).messages.at(-1).content);return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({dimensions:input.windows.map(w=>({name:w.name,support:w.ids.includes('semantic')?1:0,opposition:0,commitment:w.ids.includes('semantic')?1:0,imminence:w.ids.includes('semantic')?1:0,citations:w.ids.includes('semantic')?[{postId:'semantic',quote:input.posts.find(p=>p.id==='semantic').text}]:[]})),rows:input.posts.map(p=>({postId:p.id,claims:p.id==='semantic'?[{kind:'promise',subject:'codex-usage',scope:'global',statement:'future',quote:p.text,timeText:'Within 2 hours',timing:{stance:'commitment',window:'within-hours',amount:2,zone:'unknown'},contextMissing:false}]:[]}))})}}]});};const {snapshot}=await import(${JSON.stringify(resolve('tests/helpers/fixture.mjs'))});const {available_judgment}=await import(${JSON.stringify(resolve('dist/src/app/engine.mjs'))});const {enhance}=await import(${JSON.stringify(resolve('dist/src/ai/enhance.mjs'))});const {render_report}=await import(${JSON.stringify(resolve('dist/src/presentation/report.mjs'))});const s=snapshot({now:'2026-09-25T01:00:00Z',posts:[{id:'semantic',at:'2026-09-25T00:30:00Z',author:'thsottiaux',provenance:'primary',text:'Within 2 hours, all accounts receive refreshed allowances.'}]});const native=available_judgment(s),before=native.signals.promise;const ai=await enhance(native);const fallback=await enhance(available_judgment(s),true);console.log(JSON.stringify({calls,before,promise:ai.signals.promise,forecast:ai.forecast,text:render_report(ai),fallbackPromise:fallback.signals.promise}));`);
 expect(r.before).toBeNull();expect(r.calls).toBe(2);
 expect(r.promise).toMatchObject({postId:'semantic',targetAt:'2026-09-25T02:30:00.000Z',extractor:'post-claims-3'});
 expect(r.forecast).toMatchObject({available:true,mode:'dimensional-delivery'});expect(r.text).toMatch(/24h：[0-9]+%/);expect(r.fallbackPromise).toBeNull();
});

test('semantic completion claims and parent-reply promise threads advance the reset clock and lift probabilities even without fallback keyword triggers',async()=>{
 const r=await trial(`globalThis.fetch=async(u,o)=>{const input=JSON.parse(JSON.parse(o.body).messages.at(-1).content);return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({dimensions:input.windows.map(w=>({name:w.name,support:w.ids.includes('sem-reply')?0.9:0,opposition:0,commitment:w.ids.includes('sem-reply')?0.85:0,imminence:w.ids.includes('sem-reply')?0.5:0,citations:w.ids.includes('sem-reply')?[{postId:'sem-parent',quote:input.posts.find(p=>p.id==='sem-parent').text.slice(0,80)},{postId:'sem-reply',quote:input.posts.find(p=>p.id==='sem-reply').text}]:[]})),rows:[{postId:'sem-done',claims:[{kind:'completion',subject:'codex-usage',scope:'global',statement:'completed',quote:'Fresh quota wave just rolled out across the board. Enjoy.',objectText:'Codex quota for all accounts',objectBasis:'explicit',timeText:null,timing:null,contextMissing:false}]},{postId:'sem-parent',claims:[{kind:'promise',subject:'codex-usage',scope:'global',statement:'future',quote:'Day 17/ Bet you thought we forgot, but no, quota refresh day today.',timeText:'today',timing:{stance:'commitment',window:'today',amount:null,zone:'unknown'},contextMissing:false}]},{postId:'sem-reply',claims:[{kind:'promise',subject:'codex-usage',scope:'global',statement:'future',quote:'Lands tomorrow before 10am PST.',timeText:'tomorrow before 10am PST',timing:{stance:'commitment',window:'tomorrow',amount:null,zone:'PST'},contextMissing:false}]}]})}}]});};const {snapshot}=await import(${JSON.stringify(resolve('tests/helpers/fixture.mjs'))});const {available_judgment}=await import(${JSON.stringify(resolve('dist/src/app/engine.mjs'))});const {enhance}=await import(${JSON.stringify(resolve('dist/src/ai/enhance.mjs'))});const s=snapshot({now:'2026-10-22T06:59:00Z',posts:[...snapshot().posts,{id:'sem-done',at:'2026-10-20T06:33:48.848Z',author:'thsottiaux',provenance:'primary',text:'Fresh quota wave just rolled out across the board. Enjoy.'},{id:'sem-parent',at:'2026-10-22T06:55:22.314Z',author:'thsottiaux',provenance:'primary',text:'Day 17/ Bet you thought we forgot, but no, quota refresh day today. Also it only takes 15 mins to set up access.'},{id:'sem-reply',at:'2026-10-22T06:55:54.577Z',author:'thsottiaux',provenance:'primary',parentId:'sem-parent',parentRelationProvenance:'official-page-data',text:'Lands tomorrow before 10am PST.'}]});const ai=await enhance(available_judgment(s));console.log(JSON.stringify({lastGlobal:ai.signals.lastGlobal,promise:ai.signals.promise,p24:ai.forecast.p24,p48:ai.forecast.p48,card:ai.forecast.cardAdvice}));`);
 expect(r.lastGlobal).toMatchObject({id:'sem-done',global:true,verified:true});
 expect(r.promise).toMatchObject({postId:'sem-reply',parentId:'sem-parent',targetAt:'2026-10-22T18:00:00.000Z'});
 expect(r.p24).toBeGreaterThan(80);
 expect(r.card.decision).toBe('wait');
});

test('AI semantic extraction confirms unlinked late completion and recognizes colloquial delay without presuming delivery',async()=>{
 const r=await trial(`
  let handler;globalThis.fetch=(u,o)=>handler(u,o);
  const {snapshot}=await import(${JSON.stringify(resolve('tests/helpers/fixture.mjs'))});
  const {available_judgment}=await import(${JSON.stringify(resolve('dist/src/app/engine.mjs'))});
  const {enhance}=await import(${JSON.stringify(resolve('dist/src/ai/enhance.mjs'))});
  const plan={id:'2106845241357824205',at:'2026-10-04T00:00:00Z',author:'thsottiaux',provenance:'primary',text:'Over the next 28 days, each day we will either ship a clear improvement or ship a full reset.'};
  const day15={id:'2112432076767289678',at:'2026-10-20T06:33:48.848Z',author:'thsottiaux',provenance:'primary',text:"Day 15/ Nevermind, we're still cooking... and reset. Enjoy."};
  const day17={id:'2113162277688070445',at:'2026-10-22T06:55:22.314Z',author:'thsottiaux',provenance:'primary',text:'Day 17/ Bet you thought we forgot, but no, it is reset day today.'};
  const reply={id:'2113162413008884099',at:'2026-10-22T06:55:54.577Z',author:'thsottiaux',provenance:'primary',parentId:day17.id,parentRelationProvenance:'official-page-data',text:'Lands tomorrow before 10am PST.'};
  const unlinkedDone={id:'2113600000000000001',at:'2026-10-23T02:00:00Z',author:'thsottiaux',provenance:'primary',text:'Done and dusted'};
  const colloquialDelay={id:'2113600000000000002',at:'2026-10-22T19:00:00Z',author:'thsottiaux',provenance:'primary',text:'Hang tight everyone, we hit a snag and need a few extra hours before tonight’s drop lands.'};

  // Case 1: unlinked completion after presumed deadline
  handler=async(u,o)=>{
   const input=JSON.parse(JSON.parse(o.body).messages.at(-1).content);
   return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({
    dimensions:input.windows.map(w=>({name:w.name,support:0,opposition:0,commitment:0,imminence:0,citations:[]})),
    rows:[{postId:unlinkedDone.id,claims:[{kind:'completion',subject:'codex-usage',scope:'global',statement:'completed',quote:'Done and dusted',objectText:'Previously announced global quota reset',objectBasis:'context',timeText:null,timing:null,contextMissing:false}]}]
   })}}]});
  };
  const s1=snapshot({now:'2026-10-23T03:00:00Z',posts:[...snapshot().posts,plan,day15,day17,reply,unlinkedDone]});
  const native1=available_judgment(s1);
  const beforePresumed=native1.signals.lastGlobal.presumed;
  const ai1=await enhance(native1);

  // Case 2: colloquial delay revokes presumed deadline
  handler=async(u,o)=>{
   const input=JSON.parse(JSON.parse(o.body).messages.at(-1).content);
   return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({
    dimensions:input.windows.map(w=>({name:w.name,support:w.ids.includes(colloquialDelay.id)?0.8:0,opposition:0,commitment:w.ids.includes(colloquialDelay.id)?0.8:0,imminence:w.ids.includes(colloquialDelay.id)?0.8:0,citations:w.ids.includes(colloquialDelay.id)?[{postId:colloquialDelay.id,quote:colloquialDelay.text}]:[]})),
    rows:[{postId:colloquialDelay.id,claims:[{kind:'hint',subject:'codex-usage',scope:'global',statement:'future',status:'delayed',quote:colloquialDelay.text,timeText:'few extra hours',timing:{stance:'intention',window:'soon',amount:null,zone:'unknown'},contextMissing:false}]}]
   })}}]});
  };
  const s2=snapshot({now:'2026-10-23T01:00:00Z',posts:[...snapshot().posts,plan,day15,day17,reply,colloquialDelay]});
  const native2=available_judgment(s2);
  const beforePresumed2=native2.signals.lastGlobal.presumed;
  const ai2=await enhance(native2);

  console.log(JSON.stringify({
   beforePresumed,
   after1LastGlobal:ai1.signals.lastGlobal,
   after1PresumedCount:ai1.events.filter(e=>e.presumed).length,
   after1Intervals:ai1.history.intervals.length,
   native1Intervals:native1.history.intervals.length,
   beforePresumed2,
   after2LastGlobal:ai2.signals.lastGlobal,
   after2Promise:ai2.signals.promise
  }));
 `);
 expect(r.beforePresumed).toBeFalsy();
 expect(r.after1LastGlobal).toMatchObject({id:'2113600000000000001',verified:true,global:true});
 expect(r.after1LastGlobal.presumed).toBeFalsy();
 expect(r.after1PresumedCount).toBe(0);
 expect(r.after1Intervals).toBe(r.native1Intervals);
 expect(r.beforePresumed2).toBeFalsy();
 expect(r.after2LastGlobal.id).toBe('2112432076767289678');
 expect(r.after2Promise).toMatchObject({fulfilled:false,delayed:true});
});
