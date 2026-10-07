import {test,expect} from 'bun:test';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {spawnSync} from 'node:child_process';
import {post_address,parse_public_post} from '../../dist/src/evidence/public-posts.mjs';
import {validate_plan,links_from} from '../../dist/src/evidence/search.mjs';
const id='2107676653895967106',url=`https://x.com/OpenAIDevs/status/${id}`,now='2026-10-07T13:00:00Z';
const embed={url,author_url:'https://twitter.com/OpenAIDevs',html:'<blockquote class="twitter-tweet"><p>Codex usage limits have been reset for eligible accounts.</p></blockquote>'};
test('official social originals require exact account and post, recent time and useful complete Codex evidence',()=>{
 const address=post_address(url),p=parse_public_post(embed,address,now);expect(p.provenance).toBe('official-post');expect(p.author).toBe('openaidevs');expect(p.at).toBe('2026-10-07T03:37:27.684Z');
 for(const u of ['http://127.0.0.1','https://x.com/random/status/'+id,'https://x.com/OpenAIDevs/status/'+id+'/extra','https://x.com.evil.invalid/OpenAIDevs/status/'+id,'https://user@x.com/OpenAIDevs/status/'+id])expect(post_address(u)).toBeNull();
 for(const data of [{...embed,author_url:'https://x.com/random'},{...embed,url:url.replace(id,'2107676653895967107')},{...embed,html:embed.html.replace('eligible accounts.','eligible accounts…')},{...embed,html:embed.html.replace('Codex usage limits have been reset for eligible accounts.','My account quota in Codex changed.')}])expect(()=>parse_public_post(data,address,now)).toThrow();
 expect(()=>parse_public_post(embed,address,'2026-10-06T01:00:00Z')).toThrow();expect(()=>parse_public_post(embed,address,'2026-10-10T01:00:00Z')).toThrow();
 expect(links_from(`<a href="${url}">Codex</a><a href="https://x.com/random/status/${id}">Other</a>`,'google','related-posts')).toEqual([url]);
 expect(()=>validate_plan({queries:[{engine:'google',query:'Codex reset',scope:'arbitrary'}]})).toThrow();
});
test('bounded search fetches official oEmbed rather than snippets; a second request reuses validated original cache',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'tibo-public-post-'));
 try{const code=`Date.now=()=>Date.parse(${JSON.stringify(now)});let urls=[];globalThis.fetch=async(u,o)=>{urls.push(String(u));if(String(u).includes('google.com/search'))return new Response(${JSON.stringify(`<a href="${url}">Untrusted search summary says tomorrow!</a><a href="https://x.com/random/status/${id}">fake</a>`)});if(String(u).startsWith('https://publish.x.com/oembed'))return Response.json(${JSON.stringify(embed)});throw Error('unexpected URL')};const {run_search}=await import(${JSON.stringify(resolve('dist/src/evidence/search.mjs'))});const plan={queries:[{engine:'google',query:'Codex usage reset',scope:'posts'}]};const a=await run_search(plan),count=urls.length,b=await run_search(plan);console.log(JSON.stringify({a,b,urls,count}));`;
 const run=spawnSync(process.execPath,['--eval',code],{env:{...process.env,TIBO_CONFIG_FILE:'/dev/null',TIBO_STATE_DIR:dir},encoding:'utf8',timeout:8000});expect(run.status,run.stderr).toBe(0);const r=JSON.parse(run.stdout);
 expect(r.a.documents).toHaveLength(1);expect(r.a.documents[0].text).toBe('Codex usage limits have been reset for eligible accounts.');expect(r.a.documents[0].text).not.toContain('tomorrow');expect(r.urls).toHaveLength(2);expect(r.count).toBe(2);expect(r.b.documents).toEqual(r.a.documents);
 }finally{await rm(dir,{recursive:true,force:true});}
});
