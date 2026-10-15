import {test,expect} from 'bun:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
const root='2109812216212099456',child='2109812360596865224',now='2026-10-13T04:08:00Z';
const article=(id,text,author='thsottiaux')=>`<article><a href="/${author}">${author}</a><a href="/${author}/status/${id}">time</a><div data-testid="tweetText">${text}</div></article>`;
const body='Global reset landing by EOD PST time. Enjoy';
async function trial(code){
 const dir=await mkdtemp(join(tmpdir(),'tibo-official-thread-'));
 try{const r=spawnSync(process.execPath,['--eval',code],{env:{...process.env,TIBO_STATE_DIR:dir,TIBO_CONFIG_FILE:join(dir,'absent.env')},encoding:'utf8',timeout:8000});
 expect(r.status).toBe(0);expect(r.stderr).toBe('');return JSON.parse(r.stdout);
 }finally{await rm(dir,{recursive:true,force:true});}
}
test('official detail page discovers the self-reply missing from the homepage and feeds the actual forecast',async()=>{
 const code=`const calls=[];globalThis.fetch=async u=>{calls.push(String(u));
 if(u==='https://x.com/thsottiaux')return new Response(${JSON.stringify(article(root,'Day 8/ Reset'))});
 if(u==='https://x.com/thsottiaux/status/${root}')return new Response(${JSON.stringify(article(root,'Day 8/ Reset')+article(child,body)+article(child,'Global reset by EOD.','other'))});
 if(String(u).includes('/oembed?')){const url=new URL(u).searchParams.get('url');return Response.json({url,author_url:'https://x.com/thsottiaux',html:'<blockquote class="twitter-tweet"><p>'+(url.endsWith('${root}')?'Day 8/ Reset':${JSON.stringify(body)})+'</p></blockquote>'})}
 if(String(u).startsWith('https://status.openai.com/'))return Response.json({incidents:[]});
 return new Response('<rss><channel></channel></rss>');};
 const {collect_sources}=await import(${JSON.stringify(resolve('dist/src/evidence/sources.mjs'))});
 const {available_judgment}=await import(${JSON.stringify(resolve('dist/src/app/engine.mjs'))});
 const s=await collect_sources('${now}'),r=available_judgment(s);await collect_sources('${now}');
 console.log(JSON.stringify({s,forecast:r.forecast,calls}));`;
 const r=await trial(code);
 expect(r.s.posts.map(p=>p.id)).toEqual([root,child]);expect(r.s.posts[1]).toMatchObject({text:body,provenance:'primary',truncated:false});
 expect(r.forecast).toMatchObject({available:true,promisePolicy:{applied:false,reason:'clock-unverified'}});expect(r.s.events).toHaveLength(0);
 expect(r.calls.filter(u=>u===`https://x.com/thsottiaux/status/${root}`)).toHaveLength(1);
 expect(r.calls.every(u=>['x.com','publish.x.com','status.openai.com','openai.com'].includes(new URL(u).hostname))).toBe(true);
});
test('thread discovery is bounded, refreshes conversations and degrades without losing cached originals',async()=>{
 const code=`let clock=Date.now();Date.now=()=>clock;let calls=0,healthy=false;globalThis.fetch=async()=>{calls++;if(!healthy)throw Error('offline');return new Response(${JSON.stringify(article(root,'Day 8/ Reset')+article(child,body))})};
 const {collect_threads}=await import(${JSON.stringify(resolve('dist/src/evidence/post-thread.mjs'))});
 const roots=['2109812216212099456','2109812216212099457','2109812216212099458'].map(id=>({id,author:'thsottiaux',at:'2026-10-13T01:03:25Z',text:'Day 8/ Reset'}));
 const failed=await collect_threads(roots,[],'${now}');
 const consumed=await collect_threads(roots,[{global:true,at:'2026-10-13T02:00:00Z'}],'${now}');
 healthy=true;clock+=30001;
 const a=await collect_threads(roots.slice(0,1),[],'${now}');const b=await collect_threads(roots.slice(0,1),[],'${now}');
 console.log(JSON.stringify({failed,consumed,a,b,calls}));`;
 const r=await trial(code);expect(r.failed.source).toMatchObject({ok:false,attempted:2});expect(r.failed.posts).toEqual([]);
 expect(r.consumed.source.attempted).toBe(0);expect(r.a.posts).toHaveLength(2);expect(r.b.posts).toHaveLength(2);expect(r.calls).toBe(3);
});
