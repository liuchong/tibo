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
 const r=spawnSync(process.execPath,['--eval',code],{env:{...process.env,TIBO_STATE_DIR:dir,TIBO_CONFIG_FILE:'/dev/null',TIBO_AI_FEATURES:'signals',DEEPSEEK_API_KEY:'fixture-features'},encoding:'utf8',timeout:6000});
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
