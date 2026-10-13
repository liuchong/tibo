import {test,expect} from 'bun:test';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync,spawn} from 'node:child_process';

const id='2109430343346581527',next='2109439315570999598';
const now=Date.parse('2026-10-12T12:00:00Z');
const html=(id,text)=>`<article><a href="/thsottiaux/status/${id}">12h</a><div dir="auto" class="text-body whitespace-pre-wrap">${text}</div></article>`;
const modulePath=name=>JSON.stringify(resolve(`dist/src/${name}.mjs`));
const setup=`let now=${now};Date.now=()=>now;let calls=[];let page=${JSON.stringify(html(id,'Reset all propagated. Enjoy.'))};let broken=false;
globalThis.fetch=async u=>{calls.push(String(u));await new Promise(r=>setTimeout(r,10));if(broken)throw Error('offline');
if(u==='https://x.com/thsottiaux')return new Response(page);
if(String(u).includes('/oembed?')){const url=new URL(u).searchParams.get('url');return Response.json({url,author_url:'https://x.com/thsottiaux',html:'<blockquote class="twitter-tweet"><p>Reset all propagated. Enjoy.</p></blockquote>'})}
if(String(u).startsWith('https://status.openai.com/'))return Response.json({incidents:[]});
if(String(u).startsWith('https://openai.com/'))return new Response('<rss><channel></channel></rss>');throw Error('unexpected');};
const {collect_sources}=await import(${modulePath('evidence/sources')});const {read_state,write_state}=await import(${modulePath('platform/state')});
const collect=()=>collect_sources(new Date(now).toISOString());`;
async function trial(code){
 const dir=await mkdtemp(join(tmpdir(),'tibo-evidence-cache-'));
 try{const r=spawnSync(process.execPath,['--eval',setup+code],{env:{...process.env,TIBO_STATE_DIR:dir,TIBO_AI_FEATURES:''},encoding:'utf8',timeout:10000});
 expect(r.stderr).toBe('');expect(r.status).toBe(0);return JSON.parse(r.stdout);
 }finally{await rm(dir,{recursive:true,force:true});}
}
test('concurrent readers share collection, return isolated copies and advance observation time without forging verification',async()=>{
 const r=await trial(`const rows=await Promise.all(Array.from({length:8},collect));const original=rows[1].posts[0].text;rows[0].posts[0].text='private mutation';now+=60000;const later=await collect();console.log(JSON.stringify({calls,states:rows.map(x=>x.collectionReuse.state),original,later}));`);
 expect(r.calls).toHaveLength(4);expect(r.states.filter(x=>x==='fresh')).toHaveLength(1);expect(r.states.filter(x=>x==='cached')).toHaveLength(7);
 expect(r.later.posts[0].text).toBe(r.original);expect(r.later.now).toBe(new Date(now+60000).toISOString());
 expect(r.later.collectionReuse.collectedAt).toBe(new Date(now).toISOString());
 expect(r.later.sources.every(x=>x.fetched===false&&x.cached===true)).toBe(true);
 expect(r.later.posts[0].cachedAt).toBe(new Date(now).toISOString());
 expect(r.later.sources.find(x=>x.name==='oembed')).toMatchObject({attempted:0,verified:0,reused:1});
});
test('list expiry discovers new posts but complete originals remain reusable indefinitely',async()=>{
 const r=await trial(`await collect();now+=86400000;page+=${JSON.stringify(html(next,'Reset all propagated. Enjoy.'))};const refreshed=await collect();console.log(JSON.stringify({calls,refreshed,ledger:await read_state('ledger')}));`);
 expect(r.calls.filter(u=>u==='https://x.com/thsottiaux')).toHaveLength(2);
 expect(r.calls.filter(u=>u.includes('/oembed?')&&u.includes(id))).toHaveLength(1);
 expect(r.calls.filter(u=>u.includes('/oembed?')&&u.includes(next))).toHaveLength(1);
 expect(r.ledger.posts).toHaveLength(2);expect(r.refreshed.sources.find(x=>x.name==='oembed')).toMatchObject({attempted:1,verified:1,reused:1});
 expect(r.ledger.posts.find(x=>x.id===id).cachedAt).toBe(new Date(now).toISOString());
});
test('audited coverage is preserved during fresh collection and changes invalidate the shared evidence cache',async()=>{
 const r=await trial(`await collect();let ledger=await read_state('ledger');const coverage={from:'2026-01-01T00:00:00Z',through:new Date(now).toISOString(),audited:true,eventsComplete:true,postsComplete:true};ledger.coverage=coverage;await write_state('ledger',ledger);const audited=await collect();const fresh=calls.length;coverage.postsComplete=false;ledger=await read_state('ledger');ledger.coverage=coverage;await write_state('ledger',ledger);const changed=await collect();console.log(JSON.stringify({audited:audited.coverage,changed:changed.coverage,saved:(await read_state('ledger')).coverage,fresh,calls:calls.length}));`);
 expect(r.audited.postsComplete).toBe(true);expect(r.changed.postsComplete).toBe(false);
 expect(r.saved).toEqual(r.changed);expect(r.calls).toBe(r.fresh+3);
});
test('changed primary body is verified again; truncated originals are retried rather than treated as complete',async()=>{
 const r=await trial(`await collect();now+=120001;page=${JSON.stringify(html(id,'Changed text from the same official post.'))};await collect();const changedCalls=calls.length;let ledger=await read_state('ledger');ledger.posts[0].truncated=true;await write_state('ledger',ledger);await collect();console.log(JSON.stringify({calls,changedCalls}));`);
 expect(r.calls.filter(u=>u.includes('/oembed?'))).toHaveLength(3);
});
test('clearing or updating history invalidates discovery cache; corrupt cache and offline mode degrade correctly',async()=>{
 const r=await trial(`await collect();await write_state('ledger',{posts:[],events:[]});await collect();const cleared=calls.length;await write_state('source-cache',{schemaVersion:1,expiresAt:now+10000,snapshot:null});await collect();const corrupt=calls.length;await collect_sources(new Date(now).toISOString(),true);console.log(JSON.stringify({cleared,corrupt,final:calls.length}));`);
 expect(r.cleared).toBe(8);expect(r.corrupt).toBe(11);expect(r.final).toBe(11);
});
test('discovery failure is shared briefly and retries in 15s while preserving permanent originals',async()=>{
 const r=await trial(`await collect();now+=120001;broken=true;const failed=await collect();const count=calls.length;await collect();const reusedCount=calls.length;now+=15001;const retried=await collect();console.log(JSON.stringify({failed,count,reusedCount,retried,calls}));`);
 expect(r.failed.collectionReuse.ttlMs).toBe(15000);expect(r.count).toBe(r.reusedCount);
 expect(r.calls).toHaveLength(r.count+3);expect(r.retried.posts[0].text).toBe('Reset all propagated. Enjoy.');
 expect(r.retried.sources.find(x=>x.name==='primary').ok).toBe(false);
});
test('forecast and posts commands share the same public collection',async()=>{
 const r=await trial(`const {execute_core}=await import(${modulePath('commands/execute')});const [p,f]=await Promise.all([execute_core({command:'posts',args:{limit:1,hours:48}}),execute_core({command:'forecast',args:{}},{noAi:true})]);console.log(JSON.stringify({calls,p,f:f.result.snapshot}));`);
 expect(r.calls).toHaveLength(4);expect(r.p.text).toContain('Reset all propagated. Enjoy.');
 expect(r.f.posts[0].text).toBe('Reset all propagated. Enjoy.');expect(r.f.collectionReuse.state).toBe('cached');
});
test('hits do not extend expiry and backward clocks cannot reuse future collection',async()=>{
 const r=await trial(`await collect();now+=119999;await collect();const hit=calls.length;now+=2;await collect();const expired=calls.length;now-=200000;await collect();console.log(JSON.stringify({hit,expired,rollback:calls.length}));`);
 expect(r.hit).toBe(4);expect(r.expired).toBe(7);expect(r.rollback).toBe(10);
});
test('failed requests exceeding 15s still share a recovery cooldown after completion',async()=>{
 const r=await trial(`const {cached_sources}=await import(${modulePath('evidence/cache')});let generations=0;const generate=async()=>{generations++;const start=new Date(now).toISOString();now+=25000;return {schemaVersion:1,now:start,posts:[],events:[],sources:[{name:'primary',ok:false}],unknowns:[]}};await cached_sources(new Date(now).toISOString(),false,generate);const later=await cached_sources(new Date(now).toISOString(),false,generate);console.log(JSON.stringify({generations,later}));`);
 expect(r.generations).toBe(1);expect(r.later.collectionReuse.state).toBe('cached');
});
test('optional cache storage failure does not fail collection or leak a shared mutable result',async()=>{
 const r=await trial(`const {mkdir}=await import('node:fs/promises');const {join}=await import('node:path');await mkdir(join(process.env.TIBO_STATE_DIR,'source-cache.json'));const a=await collect();const b=await collect();console.log(JSON.stringify({states:[a.collectionReuse.state,b.collectionReuse.state],calls}));`);
 expect(r.states).toEqual(['fresh','fresh']);expect(r.calls).toHaveLength(7);
});
test('different processes and restart share persisted discovery and original caches',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'tibo-cross-process-cache-'));
 const log=join(dir,'requests.log');
 const code=setup.replace('calls.push(String(u));',`calls.push(String(u));await (await import('node:fs/promises')).appendFile(${JSON.stringify(log)},String(u)+'\\n');`)+`const s=await collect();console.log(JSON.stringify(s.collectionReuse));`;
 const run=()=>new Promise((resolve,reject)=>{const p=spawn(process.execPath,['--eval',code],{env:{...process.env,TIBO_STATE_DIR:dir},stdio:['ignore','pipe','pipe']});let out='',err='';p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>err+=d);p.on('error',reject);p.on('close',status=>resolve({status,out,err}));});
 try{const rows=await Promise.all(Array.from({length:4},run));rows.push(await run());
 for(const row of rows){expect(row.status).toBe(0);expect(row.err).toBe('');}
 expect(rows.filter(r=>JSON.parse(r.out).state==='fresh')).toHaveLength(1);
 expect((await readFile(log,'utf8')).trim().split('\n')).toHaveLength(4);
 }finally{await rm(dir,{recursive:true,force:true});}
},10000);
