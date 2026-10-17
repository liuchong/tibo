import {test,expect} from 'bun:test';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {spawnSync} from 'node:child_process';
import {documents_from,validate_research,validate_review} from '../../dist/src/evidence/research.mjs';import {validate_plan,official_url_QMARK_,links_from} from '../../dist/src/evidence/search.mjs';import {snapshot,post} from '../helpers/fixture.mjs';
const incident={id:'official-fixture',created_at:'2026-09-25T00:00:00Z',updated_at:'2026-09-25T00:00:00Z',name:'Codex requests failed',status:'resolved',impact:'minor',components:[{name:'Codex'}],incident_updates:[{created_at:'2026-09-25T00:00:00Z',status:'resolved',body:'A fix was deployed for affected Codex requests.'}]};
const sources=[{name:'status',ok:true,body:JSON.stringify({incidents:[incident,{...incident,id:'old',created_at:'2026-01-01T00:00:00Z',incident_updates:[{status:'resolved',created_at:'2026-01-01T00:00:00Z'}]},{...incident,id:'future',created_at:'2027-01-01T00:00:00Z',incident_updates:[]}]})},{name:'news',ok:true,body:'<rss><channel><item><title><![CDATA[Codex new tools]]></title><link>https://openai.com/index/codex-tools/</link><pubDate>Wed, 24 Sep 2026 00:00:00 GMT</pubDate><description><![CDATA[<p>New tools for Codex</p>]]></description></item></channel></rss>'}];
test('native research selects recent official Codex incidents and releases, excludes future/old records and never sends raw pages',()=>{const docs=documents_from(snapshot({sources}));expect(docs).toHaveLength(2);expect(docs[0]).toMatchObject({type:'incident',status:'resolved',impact:'minor'});expect(docs[1].text).toContain('Codex new tools');expect(docs[1].url).toBe('https://openai.com/index/codex-tools/');expect(docs.every(d=>d.text.length<=1200)).toBe(true);expect(documents_from(snapshot({sources:[{name:'status',ok:true,body:'broken'}]}))).toEqual([]);});
test('structured research and review accept only grounded quotations, bounded enums and traceable links',()=>{const input={posts:[post(25,'Codex limits reset for affected Pro accounts.'),post(25,'A fix is now deployed for affected accounts.',{id:'reply'})],documents:[]};const v={facts:[{sourceId:'post-25',quote:'Codex limits reset',kind:'reset',scope:'subset',status:'resolved',impact:'minor'}],links:[{fromId:'post-25',fromQuote:'Codex limits reset',toId:'reply',toQuote:'A fix is now deployed',relation:'clarifies'}]};expect(validate_research(v,input).facts[0].scope).toBe('subset');expect(()=>validate_research({...v,facts:[{...v.facts[0],sourceId:'invented'}]},input)).toThrow();expect(()=>validate_research({...v,links:[{...v.links[0],toQuote:'fake quote'}]},input)).toThrow();expect(()=>validate_review({accept:true,reason:'banked',citations:[{sourceId:'post-25',quote:'Codex limits reset'}]},input)).toThrow();expect(validate_review({accept:false,reason:'unsupported-scope',citations:[{sourceId:'post-25',quote:'Codex limits reset'}]},input).accept).toBe(false);});
test('AI search can only choose two bounded business queries; URLs and identities are never fetch targets',()=>{expect(validate_plan({queries:[{engine:'google',query:'Codex Pro quota compensation'}]}).queries).toHaveLength(1);for(const query of ['api key Codex','Codex https://localhost/private','Codex site:evil.invalid','Codex sk-123456789abcdef'])expect(()=>validate_plan({queries:[{engine:'google',query}]})).toThrow();expect(()=>validate_plan({queries:[{engine:'shell',query:'Codex reset'}]})).toThrow();});
test('actual Google JS shell and Baidu script redirect are unavailable, never true empty results',()=>{
 expect(()=>links_from('<title>Google Search</title><style>table,div{display:none}</style><script>window.google={}</script>','google')).toThrow('脚本');
 expect(()=>links_from('<script>location.replace(location.href.replace("https://", "http://"));</script>','baidu')).toThrow('脚本');
 expect(links_from('<html><title>Codex search results</title><p>No matches</p></html>','google')).toEqual([]);
});
test('customer stories are excluded and grounded historic context is available to research',()=>{
 const item=(title,url)=>`<item><title>${title}</title><link>${url}</link><pubDate>Wed, 24 Sep 2026 00:00:00 GMT</pubDate><description>Codex usage and new updates</description></item>`;
 const docs=documents_from(snapshot({sources:[{name:'news',ok:true,body:`<rss>${item('Chatham scales its capital markets expertise with OpenAI','https://openai.com/index/chatham/')}${item('Are you a Codex Original?','https://openai.com/form/codex-original/')}${item('DevDay 2026 Recap','https://openai.com/index/devday-2026/')}</rss>`}]}));
 expect(docs).toHaveLength(1);expect(docs[0].text).toContain('DevDay');
 expect(validate_research({facts:[{sourceId:'historic',quote:'Reset all propagated.',kind:'reset',scope:'global',status:'resolved',impact:'unknown'}],links:[]},
   {posts:[],documents:[],lastGlobal:{id:'historic',text:'Reset all propagated. Enjoy.',provenance:'primary'}}).facts[0].sourceId).toBe('historic');
});
async function run(code,features='signals,search,research,forecast,review,brief'){const dir=await mkdtemp(join(tmpdir(),'tibo-research-'));try{const r=spawnSync(process.execPath,['--eval',code],{env:{...process.env,TIBO_STATE_DIR:dir,TIBO_AI_FEATURES:features,DEEPSEEK_API_KEY:'fixture-research-key'},encoding:'utf8',timeout:6000});expect(r.status).toBe(0);expect(r.stderr).toBe('');return JSON.parse(r.stdout);}finally{await rm(dir,{recursive:true,force:true});}}
const searchModule=JSON.stringify(resolve('dist/src/evidence/search.mjs')),ai=JSON.stringify(resolve('dist/src/ai/enhance.mjs')),engine=JSON.stringify(resolve('dist/src/app/engine.mjs'));
test('search executes Google and Baidu, reads only official pages, rejects private redirects, then reuses page and query cache',async()=>{const r=await run(`let urls=[];globalThis.fetch=async(u,o)=>{urls.push(String(u));if(String(u).includes('google.com/search'))return new Response('<a href="/url?q=https%3A%2F%2Fhelp.openai.com%2Fen%2Farticle">Codex docs</a><a href="http://127.0.0.1/private">private</a>');if(String(u).includes('baidu.com/s?'))return new Response('<a href="https://www.baidu.com/link?url=fixture">Codex</a>');if(String(u).includes('baidu.com/link?'))return new Response('',{status:302,headers:{location:'http://127.0.0.1/private'}});return new Response('<main>Codex usage limits depend on your account plan. Limits are documented here, including manual resets and eligible usage policies for paid accounts.</main>')};const {run_search}=await import(${searchModule});const plan={queries:[{engine:'google',query:'Codex usage limits'},{engine:'baidu',query:'Codex usage limits'}]};const a=await run_search(plan),n=urls.length,b=await run_search(plan);console.log(JSON.stringify({a,b,urls,n}));`);expect(r.a.documents).toHaveLength(1);expect(r.a.documents[0].at).toBeNull();expect(r.a.documents[0].provenance).toBe('official-page');expect(r.urls.some(u=>u.includes('127.0.0.1'))).toBe(false);expect(r.b.engines.every(x=>x.cached)).toBe(true);expect(r.urls.length-r.n).toBe(1);/* Failed Baidu resolution is bounded; official page itself is cached. */});
test('search failure is cached and no CAPTCHA text becomes evidence',async()=>{const r=await run(`let calls=0;globalThis.fetch=async()=>{calls++;return new Response('<title>百度安全验证</title><p>Codex reset all</p>')};const {run_search}=await import(${searchModule});const p={queries:[{engine:'baidu',query:'Codex reset'}]};const a=await run_search(p),b=await run_search(p);console.log(JSON.stringify({a,b,calls}));`);expect(r.calls).toBe(3);expect(r.a.documents).toEqual([]);expect(r.a.engines[0].state).toBe('unavailable');expect(r.b.engines[0].cached).toBe(true);});
const active=snapshot({posts:[post(25,'Global reset landing tomorrow for all users.')]});
test('legacy forecast research configuration never adds a second provider call or changes probabilities',async()=>{
 const r=await run(`let calls=0;globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({facts:[{sourceId:'incident-official-fixture',quote:'Codex requests failed',kind:'incident',scope:'unknown',status:'resolved',impact:'minor'}],links:[]})}}]}))};const {judge}=await import(${engine});const {enhance}=await import(${ai});const seed=${JSON.stringify(snapshot({sources}))};const native=judge(seed),base={p24:native.forecast.p24,p48:native.forecast.p48};const r=await enhance(native);await enhance(judge(seed));console.log(JSON.stringify({calls,base,p24:r.forecast.p24,p48:r.forecast.p48,features:r.ai.features}));`,'research,forecast,review');
 expect(r.features.research.state).toBe('skipped');expect(r.features.forecast.state).toBe('retired');expect(r.calls).toBe(0);expect(r.p24).toBe(r.base.p24);expect(r.p48).toBe(r.base.p48);
});
test('unavailable research preserves the core and does not disable rule extraction',async()=>{
 const r=await run(`globalThis.fetch=async()=>new Response('',{status:500});const {judge}=await import(${engine});const {enhance}=await import(${ai});const n=judge(${JSON.stringify(snapshot({sources}))}),base=n.forecast.p24;await enhance(n);console.log(JSON.stringify({base,p24:n.forecast.p24,features:n.ai.features,structured:n.structuredFeatures}));`,'research');
 expect(r.features.research.state).toBe('skipped');expect(r.p24).toBe(r.base);expect(r.structured.ruleRows).toBeGreaterThan(0);
});

test('late resolved edits and postmortems do not turn an old outage into a recent incident',()=>{
 const closed={...incident,created_at:'2026-09-01T00:00:00Z',updated_at:'2026-09-25T00:00:00Z',status:'postmortem',incident_updates:[
  {created_at:'2026-09-25T00:00:00Z',status:'postmortem',body:'Codex incident write-up'},
  {created_at:'2026-09-01T02:00:00Z',status:'resolved',body:'Codex recovered'},
  {created_at:'2026-09-01T00:00:00Z',status:'identified',body:'Codex outage'}]};
 expect(documents_from(snapshot({sources:[{name:'status',ok:true,at:'2026-09-25T00:00:00Z',body:JSON.stringify({incidents:[closed]})}]}))).toEqual([]);
});

test('a real reopen has its own transition time; future lifecycle updates are not available in an earlier snapshot',()=>{
 const reopened={...incident,created_at:'2026-09-01T00:00:00Z',updated_at:'2026-09-27T00:00:00Z',incident_updates:[
  {created_at:'2026-09-01T00:00:00Z',status:'identified',body:'Codex outage'},
  {created_at:'2026-09-01T02:00:00Z',status:'resolved',body:'Recovered'},
  {created_at:'2026-09-24T10:00:00Z',status:'identified',body:'Codex errors have returned'},
  {created_at:'2026-09-27T00:00:00Z',status:'resolved',body:'Recovered later'}]};
 const source={name:'status',ok:true,at:'2026-09-25T00:00:00Z',body:JSON.stringify({incidents:[reopened]})};
 const docs=documents_from(snapshot({sources:[source]}));expect(docs[0]).toMatchObject({at:'2026-09-24T10:00:00.000Z',publishedAt:'2026-09-01T00:00:00.000Z',status:'identified',resolvedAt:null,timeGrade:'state-transition'});
 expect(docs[0].text).not.toContain('Recovered later');
 expect(documents_from(snapshot({sources:[{...source,at:'2026-09-27T00:00:00Z'}]}))).toEqual([]);
});

test('ongoing older Codex incidents remain context, metadata-only records and unknown states cannot become active outages',async()=>{
 const {judge}=await import('../../dist/src/app/engine.mjs');const {report_evidence}=await import('../../dist/src/presentation/forecast-evidence.mjs');
 const ongoing={...incident,name:'Codex elevated errors',status:'monitoring',created_at:'2026-09-01T00:00:00Z',incident_updates:[{created_at:'2026-09-01T00:00:00Z',status:'monitoring',body:'Codex errors remain under investigation'}]};
 const source={name:'status',ok:true,at:'2026-09-25T00:00:00Z',body:JSON.stringify({incidents:[ongoing]})};
 const result=judge(snapshot({sources:[source]}));expect(result.forecast.information.activeIncident).toBe(true);
 expect(report_evidence(result).some(r=>r.kind==='active-incident')).toBe(true);
 expect(documents_from(snapshot({sources:[{...source,at:'2026-09-01T00:00:00Z'}]}))).toEqual([]);
 const unknown={...incident,status:'unknown',incident_updates:[]},missing={...incident,created_at:null,incident_updates:[]};
 const other=judge(snapshot({sources:[{...source,body:JSON.stringify({incidents:[unknown,missing]})}]}));expect(other.forecast.information.activeIncident).toBe(false);
 expect(report_evidence(other).some(r=>r.author==='OpenAI')).toBe(false);
 const untimed=judge(snapshot({sources:[{...source,body:JSON.stringify({incidents:[{...unknown,status:'resolved'}]})}]}));
 expect(report_evidence(untimed).some(r=>r.author==='OpenAI')).toBe(false);
 expect(documents_from(other.snapshot)).toHaveLength(1);
 expect(result.forecast.p24).toBe(other.forecast.p24);expect(result.forecast.p48).toBe(other.forecast.p48);
});
