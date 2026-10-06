import {test,expect} from 'bun:test';
import {parse_html,html_text,decode_entities} from '../../dist/src/evidence/html.mjs';
import {parse_embed,snowflake_time,parse_primary,merge_posts,merge_events,events_from_posts} from '../../dist/src/evidence/sources.mjs';
import {spawnSync} from 'node:child_process';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';
const id='2106131810921136451',now='2026-10-03T14:00:00Z';
test('HTML data reader handles quoted >, entities, multiline tags, and inert script text',()=>{
 const root=parse_html('<div title="a > b">A &amp; <b>z</b><script>throw 1; <article>fake</article></script><!--fake--><br>&#x1f525;</div>');
 expect(html_text(root)).toContain('A &');expect(html_text(root)).toContain('🔥');expect(html_text(root)).not.toContain('fake');
 expect(decode_entities('&apos; &quot; &#39; &amp;lt;')).toBe("' \" ' &lt;");
 expect(()=>parse_html('<div>'.repeat(129))).toThrow('depth');
});
test('official oEmbed validates author, identity, body, precise Snowflake time and future records',()=>{
 const data={url:`https://x.com/thsottiaux/status/${id}`,author_url:'https://x.com/thsottiaux',html:'<blockquote class="twitter-tweet"><p>Reset all propagated. Enjoy.</p></blockquote>'};
 const p=parse_embed(data,id,now);expect(p.provenance).toBe('primary');expect(p.at).toBe(snowflake_time(id));expect(p.at.slice(0,19)).toBe('2026-10-02T21:18:48');
 expect(()=>parse_embed({...data,author_url:'https://x.com/impostor'},id,now)).toThrow('作者');
 expect(()=>parse_embed(data,id,'2025-01-01T00:00:00Z')).toThrow('时间');expect(()=>parse_embed({...data,html:'login'},id,now)).toThrow('内容');
});
test('original evidence outranks archived copies and future promises never become completed events',()=>{
 const primary={id,at:now,text:'Reset all propagated.',provenance:'primary'};
 expect(merge_posts([primary],[{...primary,text:'stale',provenance:'archive'}])[0].text).toBe(primary.text);
 expect(merge_events([{id,at:now,global:false}],[{id,at:now,global:true}])).toHaveLength(1);
 expect(events_from_posts([{...primary,text:'We will reset tomorrow.'}])).toHaveLength(0);
 expect(events_from_posts([primary])[0].global).toBe(true);
 expect(events_from_posts([{...primary,text:'A banked reset has been added.'}])[0]).toMatchObject({global:false,banked:true});
});
test('HTTP 200 login pages are reported as parse failures while official oEmbed verification succeeds independently',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'tibo-primary-health-'));
 const code=`globalThis.fetch=async u=>{if(String(u).includes('/oembed?'))return new Response(JSON.stringify({url:'https://x.com/thsottiaux/status/${id}',author_url:'https://x.com/thsottiaux',html:'<blockquote class="twitter-tweet"><p>Reset all propagated.  Enjoy.</p></blockquote>'}));if(String(u).includes('x.com/thsottiaux'))return new Response('<html>Log in to X</html>');return new Response('',{status:503})};const {write_state}=await import(${JSON.stringify(resolve('dist/src/platform/state.mjs'))});await write_state('ledger',{posts:[{id:'${id}',url:'https://x.com/thsottiaux/status/${id}',at:'2026-10-02T21:18:48Z',author:'thsottiaux',text:'archived',provenance:'archive'}],events:[]});const {collect_sources}=await import(${JSON.stringify(resolve('dist/src/evidence/sources.mjs'))});const s=await collect_sources('${now}');console.log(JSON.stringify({sources:s.sources,post:s.posts[0]}));`;
 try{const r=spawnSync(process.execPath,['--eval',code],{env:{...process.env,TIBO_STATE_DIR:dir},encoding:'utf8',timeout:5000});expect(r.status).toBe(0);const s=JSON.parse(r.stdout);
 expect(s.sources.find(x=>x.name==='primary')).toMatchObject({ok:false,fetched:true});expect(s.sources.find(x=>x.name==='oembed')).toMatchObject({ok:true,fetched:true,attempted:1,verified:1});expect(s.post.text).toBe('Reset all propagated. Enjoy.');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('all network sources can fail; local ledger still yields current offline observation without network I/O',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'tibo-source-'));
 const code=`globalThis.fetch=async()=>{throw new Error('network unavailable')};
 const {write_state}=await import(${JSON.stringify(resolve('dist/src/platform/state.mjs'))});
 await write_state('ledger',{schemaVersion:1,now:'2026-10-02T00:00:00Z',events:[{id:'known',at:'2026-10-01T00:00:00Z',global:true,banked:false}],posts:[]});
 const {collect_sources}=await import(${JSON.stringify(resolve('dist/src/evidence/sources.mjs'))});
 const a=await collect_sources(${JSON.stringify(now)});let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('unexpected')};
 const b=await collect_sources(${JSON.stringify(now)},true);console.log(JSON.stringify({a,b,calls}));`;
 try{const result=spawnSync(process.execPath,['--eval',code],{env:{...process.env,TIBO_STATE_DIR:dir},encoding:'utf8',timeout:5000});expect(result.stderr).toBe('');expect(result.status).toBe(0);const s=JSON.parse(result.stdout);expect(s.a.events[0].id).toBe('known');expect(s.a.now).toBe(now);expect(s.a.unknowns.join('')).toContain('保留本地证据');expect(s.b.sources.every(x=>!x.ok)).toBe(true);expect(s.calls).toBe(0);
 }finally{await rm(dir,{recursive:true,force:true});}
});
