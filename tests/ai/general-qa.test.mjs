import {test,expect} from 'bun:test';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';import{join,resolve}from'node:path';import{spawnSync}from'node:child_process';
import {extract_page} from '../../dist/src/evidence/page-extract.mjs';
const root=resolve('.tibo/tests/general-qa');await mkdir(root,{recursive:true});
const path=n=>JSON.stringify(resolve('dist/src/'+n+'.mjs'));
async function trial(code){const dir=await mkdtemp(join(root,'trial-'));try{const r=spawnSync(process.execPath,['--eval',code],{env:{...process.env,TIBO_CONFIG_FILE:join(dir,'absent.env'),TIBO_STATE_DIR:dir,TIBO_AI_FEATURES:'router,read,answer',TIBO_AI_PROVIDER:'deepseek',TIBO_AI_API_KEY:'fixture-general',DEEPSEEK_API_KEY:'fixture-general'},encoding:'utf8',timeout:15000});expect(r.status,r.stderr).toBe(0);return JSON.parse(r.stdout);}finally{await rm(dir,{recursive:true,force:true});}}
test('search merges two engines, deduplicates the same page and reads diverse domains before a final factual answer',async()=>{
 const r=await trial(`let calls=[],prompts=[];globalThis.fetch=async(u,o)=>{u=String(u);calls.push(u);if(u.includes('/chat/completions')){const b=JSON.parse(o.body),e=JSON.parse(b.messages.at(-1).content);prompts.push(b);const v=b.max_tokens===280?{command:'ask',args:{},language:'zh'}:b.max_tokens===600?{topic:'Lake Bistro reservation contact',scope:{subject:'general',source:'current',quote:e.question},queries:[{command:'search',args:{query:'Lake Bistro downtown official contact'}},{command:'search',args:{query:'Lake Bistro downtown directory telephone'}}]}:{text:'Lake Bistro downtown：010-5555 0101。两份资料的门店与号码一致。https://bistro.example.com/contact'};return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(v)}}]});}if(u.includes('google.com'))return new Response('<a href="https://bistro.example.com/contact">Lake Bistro official contact</a><a href="https://bistro.example.com/about">Lake Bistro about details</a>');if(u.includes('baidu.com'))return new Response('<a href="https://bistro.example.com/contact">Lake Bistro official contact</a><a href="https://directory.example.org/bistro">Lake Bistro downtown directory</a>');return new Response('<title>Lake Bistro contact</title><article><p>Lake Bistro downtown branch. Reservation telephone 010-5555 0101. Address: 7 North Plaza. Opening hours 11:00–23:00. This is the downtown restaurant reservation contact, updated today.</p></article>',{headers:{'content-type':'text/html'}});};const{resolve_query,execute_query}=await import(${path('commands/index')});const q=await resolve_query('Lake Bistro downtown，订位电话是多少？');const response=await execute_query(q);console.log(JSON.stringify({q,response,calls,prompts}));`);
 expect(r.q.command).toBe('ask');expect(r.response.text).toContain('010-5555 0101');expect(r.response.text).not.toContain('搜索资料：');
 expect(r.prompts).toHaveLength(3);const evidence=JSON.parse(r.prompts.at(-1).messages.at(-1).content);
 expect(evidence.builtinFacts.reads).toHaveLength(2);
 for(const read of evidence.builtinFacts.reads){expect(read.data.results).toHaveLength(3);expect(read.data.pages).toHaveLength(2);expect(read.data.verification.readDomains).toHaveLength(2);expect(read.data.results.find(r=>r.url.endsWith('/contact')).engines).toEqual(['google','baidu']);}
 expect(r.calls.filter(u=>u.startsWith('https://bistro.example.com/contact'))).toHaveLength(1);
 expect(r.calls.filter(u=>u.startsWith('https://directory.example.org'))).toHaveLength(1);
 for(const p of r.prompts){expect(p.tools).toBeUndefined();expect(p.functions).toBeUndefined();}
});
test('business structured facts and numeric HTML entities survive extraction without scripts',async()=>{
 const r=await extract_page('<title>Lake &#038; Bistro &#8211; Contact</title><script type="application/ld+json">'+JSON.stringify({'@type':'Restaurant',name:'Lake Bistro',telephone:'010-5555 0101',address:{streetAddress:'7 North Plaza'},openingHours:'Mo-Su 11:00-23:00'})+'</script><div>Reservations</div>','https://bistro.example.com/');
 expect(r.title).toBe('Lake & Bistro – Contact');expect(r.text).toContain('010-5555 0101');expect(r.structuredData[0].address).toContain('7 North Plaza');expect(r.text).not.toContain('<script');
});
test('location and weather cache public data; calculations are bounded and offline does not fetch location',async()=>{
 const r=await trial(`let calls=[];globalThis.fetch=async u=>{u=String(u);calls.push(u);return Response.json(u.includes('geocoding-api')?{results:[{id:1,name:'Test City',country:'Test Country',admin1:'Test Region',latitude:39.9,longitude:116.4,timezone:'Asia/Shanghai'}]}:{timezone:'Asia/Shanghai',current:{temperature_2m:15,weather_code:0,wind_speed_10m:8},daily:{time:['2026-10-29','2026-10-30'],weather_code:[0,3],temperature_2m_max:[20,21],temperature_2m_min:[10,11],precipitation_probability_max:[0,20]}});};const{execute_query}=await import(${path('commands/index')});const opts={noAi:true};const place=await execute_query({command:'place',args:{query:'Test City'}},opts);const weather=await execute_query({command:'weather',args:{place:'Test City',days:2}},opts);await execute_query({command:'weather',args:{place:'Test City',days:2}},opts);const distance=await execute_query({command:'distance',args:{from:'0,0',to:'0,1'}},{...opts,offline:true});const date=await execute_query({command:'date-add',args:{from:'2026-10-29',amount:10,timezone:'Asia/Shanghai'}},opts);const count=calls.length;const offline=await execute_query({command:'place',args:{query:'Other City'}},{...opts,offline:true});const invalid=await execute_query({command:'distance',args:{from:'91,0',to:'0,1'}},opts);console.log(JSON.stringify({place,weather,distance,date,offline,invalid,calls,count}));`);
 expect(r.place.ok).toBe(true);expect(r.weather.data.days).toHaveLength(2);expect(r.calls).toHaveLength(2);expect(r.count).toBe(2);expect(r.distance.data.kilometers).toBeCloseTo(111.2,1);expect(r.date.data.utc).toBe('2026-11-08T00:00:00.000Z');expect(r.offline.ok).toBe(false);expect(r.invalid.ok).toBe(false);
});
test('public read failures remain generic and do not disable local arithmetic',async()=>{
 const r=await trial(`globalThis.fetch=async()=>{throw Error('private transport details')};const{execute_query}=await import(${path('commands/index')});const place=await execute_query({command:'place',args:{query:'Test City'}},{noAi:true});const calc=await execute_query({command:'calculate',args:{expression:'(123+456)*7'}},{noAi:true});console.log(JSON.stringify({place,calc}));`);
 expect(r.place.ok).toBe(false);expect(JSON.stringify(r.place)).not.toContain('private transport');expect(r.calc.text).toBe('(123+456)*7 = 4053');
});
test('country filters remain separate from city names and cannot silently choose another country',async()=>{
 const r=await trial(`let calls=[];globalThis.fetch=async u=>{calls.push(String(u));return Response.json({results:[{id:1,name:'London',country:'Canada',country_code:'CA',latitude:42.98,longitude:-81.23},{id:2,name:'London',country:'United Kingdom',country_code:'GB',latitude:51.5,longitude:-0.12,timezone:'Europe/London'}]});};const{execute_query}=await import(${path('commands/index')});const r=await execute_query({command:'place',args:{query:'London',country:'GB'}},{noAi:true});console.log(JSON.stringify({r,calls}));`);
 expect(r.r.ok).toBe(true);expect(r.r.data.places).toHaveLength(1);expect(r.r.data.places[0].countryCode).toBe('GB');const u=new URL(r.calls[0]);expect(u.searchParams.get('name')).toBe('London');expect(u.searchParams.get('countryCode')).toBe('GB');
});
test('negative date offsets, leap days and spherical boundary distances use deterministic methods',async()=>{
 const {date_add}=await import('../../dist/src/capabilities/general.mjs');
 const {great_circle_km}=await import('../../dist/src/capabilities/geo.mjs');
 const {fixed_query}=await import('../../dist/src/commands/parser.mjs');
 expect(fixed_query('date-add 2024-03-01 -1').args.amount).toBe(-1);
 expect(date_add('2024-03-01',-1,'days','UTC').utc).toBe('2024-02-29T00:00:00.000Z');
 expect(()=>date_add('2025-02-29',1,'days','UTC')).toThrow();expect(()=>date_add('2026-10-29',36601,'days','UTC')).toThrow();
 expect(great_circle_km({latitude:0,longitude:0},{latitude:0,longitude:0})).toBe(0);
 expect(great_circle_km({latitude:0,longitude:0},{latitude:0,longitude:180})).toBeCloseTo(20015.0868,3);
});
