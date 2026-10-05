import {test,expect} from 'bun:test';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {feed_posts,reference_url} from '../dist/src/reference.mjs';
import {events_from_posts,collect_sources} from '../dist/src/sources.mjs';
import {execute_query} from '../dist/src/commands.mjs';
import {snapshot} from './fixture.mjs';
const id='2106967126250791091',at='2026-10-05T04:38:03Z',now='2026-10-05T13:00:00Z';
const feed={profile:{handle:'thsottiaux'},fetched_at:now,tweets:[{id,at,url:`https://x.com/thsottiaux/status/${id}`,text:'Reset all propagated.',kind:'reset'}]};
import {spawnSync} from 'node:child_process';import {resolve} from 'node:path';
async function trial(code){const dir=await mkdtemp(join(tmpdir(),'tibo-reference-'));try{const r=spawnSync(process.execPath,['--eval',code],{env:{...process.env,TIBO_STATE_DIR:dir,DEEPSEEK_API_KEY:'fixture-reference-key',TIBO_AI_FEATURES:'answer'},encoding:'utf8',timeout:7000});expect(r.stderr).toBe('');expect(r.status).toBe(0);return JSON.parse(r.stdout);}finally{await rm(dir,{recursive:true,force:true});}}
const refs=JSON.stringify(resolve('dist/src/reference.mjs')),sources=JSON.stringify(resolve('dist/src/sources.mjs')),commands=JSON.stringify(resolve('dist/src/commands.mjs'));
const values=`const feed=${JSON.stringify(feed)};`;

test('optional feed ignores tracker classes, validates identity/URLs, and cannot move the clock without primary verification',()=>{
 const posts=feed_posts(feed,now);expect(posts).toHaveLength(1);expect(posts[0].provenance).toBe('archive');expect(posts[0].kind).toBeUndefined();expect(events_from_posts(posts)).toEqual([]);
 expect(feed_posts({...feed,tweets:[{...feed.tweets[0],url:'https://127.0.0.1'}]},now)).toEqual([]);
 expect(()=>feed_posts({...feed,profile:{handle:'other'}},now)).toThrow();
});
test('discovery caches success and failure for one minute, blocks other endpoints and redirects; offline never fetches',async()=>{
 const r=await trial(`${values}const calls=[];let failing=false,clock=Date.now();Date.now=()=>clock;globalThis.fetch=async(u,o)=>{calls.push({u,redirect:o.redirect});if(failing)throw new Error('private supplier diagnostics');return Response.json(feed);};const {reference_data}=await import(${refs});const a=await reference_data('feed'),b=await reference_data('feed');let rejected=false;try{await reference_data('forecast')}catch{rejected=true}const offline=await reference_data('feed',true);failing=true;clock+=60001;const c=await reference_data('feed'),d=await reference_data('feed');console.log(JSON.stringify({a,b,c,d,offline,rejected,calls}));`);
 expect(r.a.ok).toBe(true);expect(r.b.cached).toBe(true);expect(r.calls).toHaveLength(2);expect(r.calls[0].redirect).toBe('error');expect(r.rejected).toBe(true);expect(r.offline.ok).toBe(false);expect(r.c.ok).toBe(false);expect(r.d.ok).toBe(false);
});
test('AI questions never fetch external predictions, and input, help and echoed answers hide discovery endpoints',async()=>{
 const r=await trial(`const hidden=${JSON.stringify(reference_url)},sent=[];globalThis.fetch=async(u,o)=>{if(!String(u).endsWith('/chat/completions'))throw new Error('Unexpected external request');const input=JSON.parse(o.body).messages;sent.push(input);return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({text:'请阅读 [说明]('+hidden+'/forecast-method)。'})}}]});};const {execute_query,help_text}=await import(${commands});const q={command:'ask',args:{question:'请解释 '+hidden+' 的概率'}};const result=await execute_query(q);await execute_query(q,{noAi:true});console.log(JSON.stringify({result,sent,help:help_text()}));`);
 expect(r.result.ok).toBe(true);expect(r.sent).toHaveLength(1);expect(JSON.stringify(r)).not.toContain(new URL(reference_url).hostname);
 expect(r.sent[0][0].content).toContain('不提及第三方重置概率预测网站');expect(r.result.text).toContain('[数据源]');
});
test('supplemental feed discovery still verifies official authors and can operate when primary timeline and archive fail',async()=>{
 const r=await trial(`${values}globalThis.fetch=async u=>{if(String(u).endsWith('/api/feed'))return Response.json(feed);if(String(u).includes('/oembed?'))return Response.json({url:'https://x.com/thsottiaux/status/${id}',author_url:'https://x.com/thsottiaux',html:'<blockquote class="twitter-tweet"><p>Facts</p></blockquote>'});return new Response('',{status:503});};const {collect_sources}=await import(${sources});const s=await collect_sources('${now}');console.log(JSON.stringify(s));`);
 expect(r.posts[0].text).toBe('Facts');expect(r.posts[0].provenance).toBe('primary');expect(r.events).toEqual([]);expect(r.sources.find(x=>x.name==='reference-feed').ok).toBe(true);
});
