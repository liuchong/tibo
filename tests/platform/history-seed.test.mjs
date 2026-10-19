import {test,expect} from 'bun:test';
import {mkdir,readFile,writeFile,rm,mkdtemp} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {install_history,export_history,public_ledger,merge_history,validate_seed} from '../../dist/src/platform/history-seed.mjs';
import {read_state,write_state} from '../../dist/src/platform/state.mjs';
import {timeline_from_posts} from '../../dist/src/evidence/timeline.mjs';
import {available_judgment} from '../../dist/src/app/engine.mjs';
const root=resolve('.tibo/research/history-bootstrap/tests');
await mkdir(root,{recursive:true});
const isolated=async f=>{const dir=await mkdtemp(join(root,'case-'));try{return await f(dir);}finally{await rm(dir,{recursive:true,force:true});}};
const at='2026-10-17T21:12:21.000Z';
const pid='2111566005684289735',url=`https://x.com/thsottiaux/status/${pid}`;
const sample=()=>({schemaVersion:1,now:at,posts:[{id:pid,at,text:'All reset for everyone.',author:'thsottiaux',url,provenance:'primary',truncated:false}],events:[{id:pid,at,url,global:true,banked:false,observed:false,state:'completed',provenance:'primary'}],timeline:[{id:pid,at,url,kind:'global',state:'completed',global:true,banked:false}],documents:[]});
test('T01 repository ledger preserves all researched announcements and only completed records move the global clock',async()=>{
 const seed=validate_seed(JSON.parse(await readFile('data/history/ledger.json','utf8')));
 expect(seed.posts.length).toBeGreaterThanOrEqual(55);expect(seed.timeline.length).toBeGreaterThanOrEqual(55);
 expect(seed.posts.some(p=>p.id==='2076365965915467978')).toBe(true);
 expect(seed.events.some(e=>e.id===pid&&e.global)).toBe(true);
 const result=available_judgment({...seed,sources:[],unknowns:[]});expect(result.signals.lastGlobal).toMatchObject({id:pid,verified:true});
 const withMillis={...seed,posts:seed.posts.map(p=>p.id===pid?{...p,at:'2026-10-17T21:12:21.411Z'}:p),sources:[],unknowns:[]};expect(available_judgment(withMillis).signals.lastGlobal.verified).toBe(true);
 expect(seed.events.some(e=>e.id==='2076365965915467978'&&e.global)).toBe(false);
 const serialized=JSON.stringify(seed);expect(serialized).not.toMatch(/https?:\/\/(?!x\.com\/|twitter\.com\/|t\.co\/|(?:www\.)?openai\.com\/)/);
 expect(seed.posts.map(p=>p.at)).toEqual(seed.posts.map(p=>p.at).toSorted());
 expect(new Set(seed.posts.map(p=>p.id)).size).toBe(seed.posts.length);
});
test('T02 fresh isolated installation and offline model use runtime ledger without opening the seed again',()=>isolated(async dir=>{
 const target=join(dir,'state'),seed=join(dir,'input.json');await writeFile(seed,JSON.stringify(sample()));
 const a=await install_history(seed,target);expect(a.addedPosts).toBe(1);await rm(seed);
 const ledger=await read_state('ledger',target);expect(ledger.events[0].id).toBe(pid);
 const r=available_judgment({...ledger,now:'2026-10-18T00:00:00Z',sources:[],unknowns:[]});
 expect(Number.isFinite(r.forecast.p24)).toBe(true);expect(r.signals.lastGlobal.id).toBe(pid);
}));
test('T03 reinstall is additive, idempotent and preserves runtime records, clock and unrelated user files',()=>isolated(async dir=>{
 const seed=join(dir,'seed.json');await writeFile(seed,JSON.stringify(sample()));
 await write_state('ledger',{...sample(),now:'2026-10-19T00:00:00Z',posts:[{...sample().posts[0],text:'Newer permanent original'}],custom:{keep:true}},dir);
 await write_state('pray-users',{users:['preserved']},dir);await write_state('realtime-monitor',{initializedAt:at,confirmedIds:['previous'],promiseIds:['keep']},dir);
 await install_history(seed,dir);const a=await read_state('ledger',dir);const b=await install_history(seed,dir);
 expect(a.posts[0].text).toBe('Newer permanent original');expect(a.now).toBe('2026-10-19T00:00:00Z');expect(a.custom.keep).toBe(true);
 expect((await read_state('realtime-monitor',dir)).confirmedIds).toEqual(['previous',pid]);expect((await read_state('realtime-monitor',dir)).promiseIds).toEqual(['keep']);expect(b.addedPosts).toBe(0);expect(b.addedEvents).toBe(0);expect(await read_state('pray-users',dir)).toEqual({users:['preserved']});
}));
test('T04 explicit roots, concurrent installs and invalid files cannot cross directories or lose events',()=>isolated(async dir=>{
 const a=join(dir,'a'),b=join(dir,'b'),file=join(dir,'seed.json');await writeFile(file,JSON.stringify(sample()));
 await Promise.all([install_history(file,a),install_history(file,a)]);expect((await read_state('ledger',a)).events.length).toBe(1);expect(await read_state('ledger',b)).toBeNull();
 const bad={...sample(),posts:[{...sample().posts[0],url:'https://untrusted.invalid/post'}]};await writeFile(file,JSON.stringify(bad));
 await expect(install_history(file,b)).rejects.toThrow();expect(await read_state('ledger',b)).toBeNull();
}));
test('T05 export includes only public ledger fields, strips unrelated links and round trips; live ledger cannot be the export destination',()=>isolated(async dir=>{
 const source=sample();source.privateKey='never export';source.posts[0].discoverySourceUrl='https://untrusted.invalid/archive';source.posts[0].text+=' https://untrusted.invalid/private KEEP after';source.posts[0].environment='private runtime';source.documents=[{url:'https://untrusted.invalid'}];
 await write_state('ledger',source,dir);const file=join(dir,'public.json');await export_history(file,dir);
 const saved=JSON.parse(await readFile(file,'utf8'));expect(JSON.stringify(saved)).not.toContain('untrusted.invalid');expect(JSON.stringify(saved)).not.toContain('private runtime');expect(saved.privateKey).toBeUndefined();expect(saved.posts[0].text).toContain(' KEEP after');expect(saved.posts[0].text).not.toContain('sted.invalid');
 expect(validate_seed(saved).events).toHaveLength(1);await install_history(file,join(dir,'other'));expect((await read_state('ledger',join(dir,'other'))).events).toHaveLength(1);
 await expect(export_history(join(dir,'ledger.json'),dir)).rejects.toThrow();
}));
test('T06 persisted timeline distinguishes promises, confirmations and banked posts without generating an extra reset',()=>{
 const s=sample();const p={...s.posts[0],id:'2111492738025959922',at:'2026-10-17T16:21:13.000Z',url:'https://x.com/thsottiaux/status/2111492738025959922',text:'Global reset landing today.'};
 const card={...p,id:'2111492673890824348',url:'https://x.com/thsottiaux/status/2111492673890824348',text:'A banked reset has been added.'};
 const rows=timeline_from_posts([s.posts[0],p,card],s.events);expect(rows.find(r=>r.id===p.id)).toMatchObject({state:'announced',global:false});
 expect(rows.find(r=>r.id===pid)).toMatchObject({state:'completed',global:true});expect(timeline_from_posts(s.posts,[{...s.events[0],banked:true}])[0]).toMatchObject({kind:'global',global:true,banked:true});expect(rows.find(r=>r.id===card.id)).toMatchObject({kind:'banked',global:false});
});
test('T07 CLI-only maintenance import/export and source collection share one runtime format',()=>isolated(async dir=>{
 const seed=join(dir,'seed.json'),file=join(dir,'export.json');await writeFile(seed,JSON.stringify(sample()));
 const env={...process.env,TIBO_CONFIG_FILE:join(dir,'absent.env'),TIBO_STATE_DIR:join(dir,'runtime'),TIBO_AI_FEATURES:'',DEEPSEEK_API_KEY:''};
 const run=args=>spawnSync(process.execPath,['bin/tibo.mjs',...args],{env,encoding:'utf8',timeout:10000});
 expect(run(['history-seed','install',seed]).status).toBe(0);expect(run(['history-seed','export',file]).status).toBe(0);
 const r=run(['forecast','--offline','--no-ai']);expect(r.status).toBe(0);expect(r.stdout).toMatch(/24h[：:]\s*\d+%/);
 const code=`globalThis.fetch=async u=>String(u).includes('status.openai.com')?Response.json({incidents:[]}):String(u).includes('openai.com/news')?new Response('<rss><channel></channel></rss>'):new Response('<article><a href="/thsottiaux">Tibo</a><a href="/thsottiaux/status/2112034063934742720">time</a><div data-testid="tweetText">We have reset usage limits for everyone.</div></article>');const {collect_sources}=await import('./dist/src/evidence/sources.mjs');await collect_sources('2026-10-19T09:00:00Z');const {read_state}=await import('./dist/src/platform/state.mjs');console.log(JSON.stringify(await read_state('ledger')));`;
 const live=spawnSync(process.execPath,['--eval',code],{env,encoding:'utf8',timeout:10000});expect(live.status).toBe(0);const ledger=JSON.parse(live.stdout);expect(ledger.events.some(e=>e.id==='2112034063934742720')).toBe(true);expect(ledger.timeline.some(e=>e.id==='2112034063934742720'&&e.state==='completed')).toBe(true);
}));
test('T08 installation sidecar is packaged separately and never imported from a forecast or evidence module',async()=>{
 const pkg=JSON.parse(await readFile('package.json','utf8'));expect(pkg.scripts.compile).toContain('package-history');
 const service=await readFile('src/platform/service.eli','utf8');expect(service).toContain('install-history');expect(service).not.toContain('"ledger.json" "experience.json"');
 for(const name of ['src/evidence/sources.eli','src/app/engine.eli','src/forecast/forecast.eli'])expect(await readFile(name,'utf8')).not.toContain('data/history');
});
