import {test,expect} from 'bun:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {parse_primary,snowflake_time,events_from_posts} from '../../dist/src/evidence/sources.mjs';
import {expanded_body} from '../../dist/src/evidence/post-body.mjs';
import {information} from '../../dist/src/forecast/availability.mjs';
import {snapshot} from '../helpers/fixture.mjs';

const id='2109430343346581527',quotedId='2109132167112782291',now='2026-10-12T12:00:00Z';
const prefix='We shipped four things and heard the community. The global reset has been';
const modern=(id,text,author='thsottiaux',extra='')=>`<article><a href="/${author}">${author}</a><a href="/${author}/status/${id}">12h</a><div class="text-body font-normal whitespace-pre-wrap wrap-break-word" dir="auto">${text}</div>${extra}</article>`;
const legacy=`<article><a href="/thsottiaux/status/${id}"><time datetime="${snowflake_time(id)}">Oct 11</time></a><div data-testid="tweetText">${prefix} processed.</div></article>`;

test('current server-rendered page yields author, exact ID time, clean body, deduplication and truncation without executing scripts',()=>{
 const quoted=modern(quotedId,'Reset all propagated.');
 const html=modern(id,'We shipped a speed improvement.', 'thsottiaux',quoted)+modern(id,'duplicate')+
   modern('2109439315570999598',`${prefix} <button>Show more</button>`)+`<script>throw new Error('must not run')</script>`;
 const posts=parse_primary(html,now);
 expect(posts).toHaveLength(3);expect(posts.find(p=>p.id===id)).toMatchObject({text:'We shipped a speed improvement.',at:snowflake_time(id),provenance:'primary',truncated:false});
 expect(posts.find(p=>p.id==='2109439315570999598')).toMatchObject({text:prefix+'…',truncated:true});
 expect(events_from_posts(posts).map(e=>e.id)).toEqual([quotedId]);
 expect(parse_primary(legacy,now)[0].text).toBe(prefix+' processed.');
});

test('foreign quoted authors, external links, missing body, future posts and login pages do not become Tibo originals',()=>{
 const foreign=modern('2109439315570999598','Reset all propagated.','other',`<a href="/thsottiaux/status/${quotedId}">mention</a>`);
 expect(parse_primary(modern(id,'Ordinary update.','thsottiaux',foreign),now)).toHaveLength(1);
 for(const html of [foreign,'<html>Log in to X</html>',modern(id,''),modern(id,'Reset all propagated.').replace(`/thsottiaux/status/${id}`,`https://example.invalid/thsottiaux/status/${id}`)])expect(()=>parse_primary(html,now)).toThrow();
 expect(()=>parse_primary(modern(id,'Reset all propagated.'),'2026-01-01T00:00:00Z')).toThrow();
});

test('official full page can restore a truncated completion; wrong identity or another truncated body cannot',()=>{
 const excerpt={id,text:prefix+'…',provenance:'primary',truncated:true,at:snowflake_time(id)};
 const body=parse_primary(modern(id,prefix+' processed. Enjoy!'),now)[0];
 expect(expanded_body(excerpt,body)).toMatchObject({text:body.text,provenance:'primary',via:'official-post-page',truncated:false});
 for(const bad of [{...body,id:quotedId},{...body,author:'other'},{...body,truncated:true},{...body,provenance:'archive'}])expect(()=>expanded_body(excerpt,bad)).toThrow();
 expect(events_from_posts([excerpt])).toEqual([]);
 expect(events_from_posts([{...body,provenance:'archive'}])).toEqual([]);
});

test('collector uses official hosts only, independently discovers posts without old data, and keeps full text when oEmbed is truncated',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'tibo-official-'));
 const html=modern(id,prefix+' <button>Show more</button>');
 const detail=modern(id,prefix+' processed. Enjoy!');
 const embed={url:`https://x.com/thsottiaux/status/${id}`,author_url:'https://x.com/thsottiaux',html:`<blockquote class="twitter-tweet"><p>${prefix}…</p></blockquote>`};
 const code=`const calls=[];globalThis.fetch=async(u)=>{calls.push(String(u));if(u==='https://x.com/thsottiaux')return new Response(${JSON.stringify(html)});if(u==='https://x.com/thsottiaux/status/${id}')return new Response(${JSON.stringify(detail)});if(String(u).startsWith('https://publish.x.com/oembed?'))return Response.json(${JSON.stringify(embed)});if(String(u).startsWith('https://status.openai.com/'))return Response.json({incidents:[]});if(String(u).startsWith('https://openai.com/'))return new Response('<rss><channel></channel></rss>');throw new Error('unexpected host');};const {collect_sources}=await import(${JSON.stringify(resolve('dist/src/evidence/sources.mjs'))});const result=await collect_sources('${now}');console.log(JSON.stringify({calls,result}));`;
 try{
  const r=spawnSync(process.execPath,['--eval',code],{env:{...process.env,TIBO_STATE_DIR:dir},encoding:'utf8',timeout:5000});expect(r.stderr).toBe('');expect(r.status).toBe(0);
  const {calls,result}=JSON.parse(r.stdout);expect(calls).toHaveLength(5);expect(calls.every(u=>['x.com','publish.x.com','status.openai.com','openai.com'].includes(new URL(u).hostname))).toBe(true);
  expect(result.posts[0]).toMatchObject({text:prefix+' processed. Enjoy!',provenance:'primary',truncated:false});expect(result.events[0]).toMatchObject({id,global:true});
  expect(result.sources.find(s=>s.name==='primary').ok).toBe(true);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('recent official page success is not complete historical coverage and cannot enable negative labels',()=>{
 const s=snapshot({sources:[{name:'primary',ok:true},{name:'oembed',ok:true}]});
 expect(information(s,{lastGlobal:{verified:true}},null).historyFresh).toBe(false);
});
