import {test,expect} from 'bun:test';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {reference_data,feed_posts,reference_facts} from '../dist/src/reference.mjs';
import {events_from_posts,collect_sources} from '../dist/src/sources.mjs';
import {execute_query} from '../dist/src/commands.mjs';
import {snapshot} from './fixture.mjs';
const id='2106967126250791091',at='2026-10-05T04:38:03Z',now='2026-10-05T13:00:00Z';
const feed={profile:{handle:'thsottiaux'},fetched_at:now,tweets:[{id,at,url:`https://x.com/thsottiaux/status/${id}`,text:'Reset all propagated.',kind:'reset'}]};
const forecast={probabilities:{rounded_24h:45,rounded_48h:70,model_24h:16,model_48h:29,tease_floor_24h:45,tease_floor_48h:70,tease_tier:'T1'},model:{version:'rate-v3',window_intervals:8},last_reset_at:'2026-10-02T21:18:48Z',age_days:2.6};
import {spawnSync} from 'node:child_process';import {resolve} from 'node:path';
async function trial(code){const dir=await mkdtemp(join(tmpdir(),'tibo-reference-'));try{const r=spawnSync(process.execPath,['--eval',code],{env:{...process.env,TIBO_STATE_DIR:dir,DEEPSEEK_API_KEY:'fixture-reference-key',TIBO_AI_FEATURES:'answer'},encoding:'utf8',timeout:7000});expect(r.stderr).toBe('');expect(r.status).toBe(0);return JSON.parse(r.stdout);}finally{await rm(dir,{recursive:true,force:true});}}
const refs=JSON.stringify(resolve('dist/src/reference.mjs')),sources=JSON.stringify(resolve('dist/src/sources.mjs')),commands=JSON.stringify(resolve('dist/src/commands.mjs'));
const values=`const forecast=${JSON.stringify(forecast)},feed=${JSON.stringify(feed)};`;

test('optional feed ignores tracker classes, validates identity/URLs, and cannot move the clock without primary verification',()=>{
 const posts=feed_posts(feed,now);expect(posts).toHaveLength(1);expect(posts[0].provenance).toBe('archive');expect(posts[0].kind).toBeUndefined();expect(events_from_posts(posts)).toEqual([]);
 expect(feed_posts({...feed,tweets:[{...feed.tweets[0],url:'https://127.0.0.1'}]},now)).toEqual([]);
 expect(()=>feed_posts({...feed,profile:{handle:'other'}},now)).toThrow();
});
test('fixed public references cache success and failure for one minute, block redirects, and offline calls never fetch',async()=>{
 const r=await trial(`${values}const calls=[];let failing=false;globalThis.fetch=async(u,o)=>{calls.push({u,redirect:o.redirect});if(failing)throw new Error('private supplier diagnostics');return Response.json(forecast);};const {reference_data}=await import(${refs});const a=await reference_data('forecast'),b=await reference_data('forecast');let rejected=false;try{await reference_data('https://127.0.0.1')}catch{rejected=true}const offline=await reference_data('feed',true);failing=true;const c=await reference_data('feed'),d=await reference_data('feed');console.log(JSON.stringify({a,b,c,d,offline,rejected,calls}));`);
 expect(r.a.ok).toBe(true);expect(r.b.cached).toBe(true);expect(r.calls).toHaveLength(2);expect(r.calls[0].redirect).toBe('error');expect(r.rejected).toBe(true);expect(r.offline.ok).toBe(false);expect(r.c.ok).toBe(false);expect(r.d.ok).toBe(false);
});
test('reference question uploads fetched display/model/floor and our independent judgment; no-AI and unrelated questions do not fetch',async()=>{
 const r=await trial(`${values}const fs=await import('node:fs/promises');const path=process.env.TIBO_STATE_DIR+'/snapshot.json';await fs.writeFile(path,JSON.stringify(${JSON.stringify(snapshot())}));let external=0,uploaded;globalThis.fetch=async(u,o)=>{if(String(u).startsWith('https://codex-reset.com')){external++;return Response.json(forecast);}uploaded=JSON.parse(JSON.parse(o.body).messages[1].content);return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({text:uploaded.text?'该站48h显示70%，模型29%，信号展示下限70%。':'普通回答'})}}]});};const {execute_query}=await import(${commands});const q={command:'ask',args:{question:'为什么codex-reset.com是70%？'}};const result=await execute_query(q,{snapshotPath:path}),context=uploaded;await execute_query(q,{snapshotPath:path,noAi:true});const unrelated=await execute_query({command:'ask',args:{question:'你好'}});console.log(JSON.stringify({result,context,external,unrelated}));`);
 expect(r.result.ok).toBe(true);expect(r.result.text).toContain('[codex-reset.com]');expect(r.context.text).toContain('"display48":70');expect(r.context.text).toContain('"model48":29');expect(r.context.text).toContain('本程序自有算法');expect(JSON.stringify(r.context)).not.toMatch(/fixture-reference-key|tibo-reference-|\/Users\/|DEEPSEEK/);expect(r.external).toBe(2);expect(r.unrelated.ok).toBe(true);
});
test('supplemental feed discovery still verifies official authors and can operate when primary timeline and archive fail',async()=>{
 const r=await trial(`${values}globalThis.fetch=async u=>{if(String(u).endsWith('/api/feed'))return Response.json(feed);if(String(u).includes('/oembed?'))return Response.json({url:'https://x.com/thsottiaux/status/${id}',author_url:'https://x.com/thsottiaux',html:'<blockquote class="twitter-tweet"><p>Facts</p></blockquote>'});return new Response('',{status:503});};const {collect_sources}=await import(${sources});const s=await collect_sources('${now}');console.log(JSON.stringify(s));`);
 expect(r.posts[0].text).toBe('Facts');expect(r.posts[0].provenance).toBe('primary');expect(r.events).toEqual([]);expect(r.sources.find(x=>x.name==='reference-feed').ok).toBe(true);
});
