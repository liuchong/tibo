import {test,expect} from 'bun:test';
import {enrich_post_links} from '../../dist/src/evidence/post-links.mjs';
const now='2026-10-28T06:00:00Z';
const post=(id,text,extra={})=>({id,at:'2026-10-28T04:00:00Z',text,author:'thsottiaux',provenance:'primary',truncated:false,...extra});
test('official links supply bounded object evidence, preserve originals and reuse successful targets',async()=>{
 const posts=[post('a','https://example.com/a has landed'),post('b','https://example.com/b https://example.com/c https://example.com/d'),post('c','https://example.com/e'),post('archive','https://example.com/archive',{provenance:'archive'})];
 const calls=[];const read=async(url,options)=>{calls.push({url,options});return {state:'partial',finalUrl:url+'/final',title:'Product Playground',text:'A product site'};};
 const enriched=await enrich_post_links(posts,now,read);
 expect(calls.length).toBeLessThanOrEqual(4);expect(calls.length).toBeGreaterThan(0);
 expect(calls.every(c=>c.options.allowRender===false&&c.options.timeout===3500)).toBe(true);
 expect(enriched.map(p=>p.text)).toEqual(posts.map(p=>p.text));expect(posts.every(p=>!p.linkContext)).toBe(true);
 expect(enriched.filter(p=>p.linkContext)).toHaveLength(2);expect(enriched.find(p=>p.id==='archive').linkContext).toBeUndefined();
 const one=enriched.find(p=>p.linkContext);expect(one.linkContext).toMatchObject({complete:true});
 const cached=await enrich_post_links([one],'2026-10-28T23:00:00Z',async()=>{throw Error('must reuse')});
 expect(cached[0].linkContext).toEqual(one.linkContext);
});
test('unavailable link evidence cools down without losing the post, then can recover',async()=>{
 let calls=0;const read=async()=>{calls++;throw Error('transport detail');};
 const first=await enrich_post_links([post('a','https://example.com/a has landed')],now,read);
 expect(first[0].linkContext.complete).toBe(false);expect(JSON.stringify(first)).not.toContain('transport detail');
 await enrich_post_links(first,'2026-10-28T06:10:00Z',read);expect(calls).toBe(1);
 const next=await enrich_post_links(first,'2026-10-28T06:16:00Z',async()=>({state:'ok',title:'Example site',text:'website'}));
 expect(next[0].linkContext.complete).toBe(true);
});
test('monitor refreshes when a link gains object evidence, without reacting to collection clocks',async()=>{
 const {post_signature}=await import('../../dist/src/app/realtime-monitor.mjs');
 const s={posts:[post('a','https://example.com/a has landed')]};const original=post_signature(s);
 s.posts[0].linkContext={checkedAt:now,retryAt:123,links:[{finalUrl:'https://example.com/a',title:'Example Playground'}]};
 const enriched=post_signature(s);expect(enriched).not.toBe(original);
 s.posts[0].linkContext.checkedAt='2026-10-28T06:30:00Z';s.posts[0].linkContext.retryAt=456;
 expect(post_signature(s)).toBe(enriched);
});
