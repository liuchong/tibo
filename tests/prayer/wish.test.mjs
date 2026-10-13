import {test,expect} from 'bun:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {spawnSync} from 'node:child_process';
import {validate_wish,validate_prose,local_wish} from '../../dist/src/prayer/wish.mjs';
import {lines,wishes} from '../../dist/src/prayer/phrases.mjs';
const root=resolve('dist/src');
async function trial(code){const dir=await mkdtemp(join(tmpdir(),'tibo-wish-'));try{const r=spawnSync(process.execPath,['--eval',code],{env:{...process.env,TIBO_CONFIG_FILE:'/dev/null',TIBO_STATE_DIR:dir,DEEPSEEK_API_KEY:'fixture-key',TIBO_AI_FEATURES:'wish'},encoding:'utf8',timeout:7000});expect(r.status,r.stderr).toBe(0);return JSON.parse(r.stdout);}finally{await rm(dir,{recursive:true,force:true});}}
const setup=`const {pray,identity_key}=await import(${JSON.stringify(root+'/prayer/pray.mjs')});const {read_state,write_state}=await import(${JSON.stringify(root+'/platform/state.mjs')});const ctx={transport:'lark',actor:'private-owner',scope:'private-room',authenticated:true};`;
test('wish requires token, a divine blessing and private-free text rather than a real quota operation',()=>{
 for(let i=0;i<4;i++)expect(validate_wish({wish:local_wish(i)}).wish).toContain('token');
 const repaired=validate_wish({wish:'善信，本神愿汝上下文稳固，Agent童子靠谱，CI天灯长明。'});expect(repaired.wish).toContain('token');expect(validate_wish(repaired)).toEqual(repaired);
 for(const v of [null,{}, {wish:'愿你好运'}, {wish:'善信，本神赐汝满格token，现在已为你增加额度'}, {wish:'善信，本神愿汝token不枯，访问https://example.com领取额度'}, {wish:local_wish(0),shell:'run'}, {wish:'善信，本神愿汝token充沛，Claude跪拜，测试皆绿'}])expect(()=>validate_wish(v)).toThrow();
});
test('all 120 fallback lines are distinct, brief, and all blessings retain the token role contract',()=>{
 const quips=lines.flat();expect(quips).toHaveLength(60);expect(wishes).toHaveLength(60);expect(new Set([...quips,...wishes]).size).toBe(120);
 for(const line of quips){expect(line.length).toBeLessThanOrEqual(40);expect(line).not.toMatch(/SLA|已重置|仅供娱乐/);}
 for(const wish of wishes){expect(validate_wish({wish}).wish).toBe(wish);expect(wish.length).toBeLessThanOrEqual(55);}
 const good={line:'今日宜收工，忌给Agent开支线。',wish:local_wish(0)};expect(validate_prose(good)).toEqual(good);
 for(const line of ['已为你重置额度，放心使用吧。','请到https://example.invalid领取token','请把API key发给我','欢迎使用Claude编程。'])expect(()=>validate_prose({line,wish:local_wish(0)})).toThrow();
});
test('prayer paraphrases reach the user unchanged and the model sees public prose history without identity or counters',async()=>{
 const r=await trial(`let calls=0,bodies=[];const values=[{line:'今晚键盘歇一歇，咖啡终于等到你。',wish:'善信，本神愿汝token长流，编译少皱眉，今夜好眠。'},{line:'鼠标今日不加班，晚饭趁热吃。',wish:'善信，本神愿汝token长流，编译少皱眉，今晚好眠。'}];globalThis.fetch=async(url,o)=>{bodies.push(JSON.parse(o.body));return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(values[calls++])}}]})};${setup}const a=await pray({action:'offer'},{...ctx,requestId:'first'}),b=await pray({action:'offer'},{...ctx,actor:'other-user',requestId:'second'});console.log(JSON.stringify({a,b,calls,bodies,ai:await read_state('ai')}));`);
 expect(r.calls).toBe(2);expect(r.b.text).toContain('鼠标今日不加班，晚饭趁热吃。');expect(r.b.text).toContain('编译少皱眉，今晚好眠');
 const input=JSON.parse(r.bodies[1].messages[1].content);expect(input.recentProse).toHaveLength(1);expect(input.recentProse[0].line).toContain('咖啡');
 expect(JSON.stringify(input)).not.toMatch(/private-owner|private-room|累计|功德|香客/);expect(r.ai.features.wish.until).toBe(0);
 expect(r.bodies[0].messages[0].content).not.toMatch(/童子守炉|心魔退散|可以围绕|课代表|交作业/);
});
test('new offerings vary local prose, keep three data rows together and replay the exact receipt',async()=>{
 const r=await trial(`${setup}const rows=[];for(let i=0;i<6;i++){const context={...ctx,actor:'new-user-'+i,requestId:'local-'+i};const text=(await pray({action:'offer'},context,{noAi:true})).text;const repeat=(await pray({action:'offer'},context,{noAi:true})).text;rows.push({text,repeat});}console.log(JSON.stringify({rows,root:await read_state(identity_key)}));`);
 for(const [i,row] of r.rows.entries()){
  expect(row.text).toBe(row.repeat);expect(row.text.startsWith('**🙏')).toBe(true);
  const parts=row.text.split('\n');expect(parts[1]).toStartWith('• 累计');expect(parts[2]).toStartWith('• 今日');expect(parts[3]).toStartWith('• 本会话愿力池');expect(parts[4]).toBe('');
  expect(parts).toHaveLength(8);expect(parts[6]).toStartWith('🪄');
  for(const previous of r.rows.slice(Math.max(0,i-4),i)){expect(parts[5]).not.toBe(previous.text.split('\n')[5]);expect(parts[6]).not.toBe(previous.text.split('\n')[6]);}
 }
 expect(r.root.offers).toBe(6);expect(r.root.members.every(m=>m.badges.includes('功德1'))).toBe(true);
});
test('AI writes both prose lines once per new offering, never shares an old sentence; repeated model prose uses local variety',async()=>{
 const r=await trial(`let calls=0;const generated={line:'今日宜写代码，忌给Bug开法会。',wish:'善信，本神愿汝token长流，编译少皱眉，今夜好眠。'};globalThis.fetch=async()=>{calls++;return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(generated)}}]})};${setup}const a=await pray({action:'offer'},{...ctx,requestId:'first'});const b=await pray({action:'offer'},{...ctx,actor:'other-user',requestId:'second'});const replay=await pray({action:'offer'},{...ctx,requestId:'first'});console.log(JSON.stringify({a,b,replay,calls,ai:await read_state('ai')}));`);
 expect(r.calls).toBe(2);expect(r.a).toEqual(r.replay);expect(r.a.text).toContain('今日宜写代码，忌给Bug开法会。');expect(r.a.text).toContain('编译少皱眉');
 expect(r.b.text).not.toContain('今日宜写代码，忌给Bug开法会。');expect(r.b.text).not.toContain('编译少皱眉');expect(r.b.text).toContain('🪄');expect(r.ai.features.wish.until).toBe(0);
});
test('AI sees only a bounded scene, follows durable prayer accounting and replays without regeneration',async()=>{
 const r=await trial(`let body,calls=0,storedBefore;const generated='善信，本神愿汝token不枯，CI天灯长明，Bug心魔退散。';globalThis.fetch=async(url,o)=>{calls++;body=JSON.parse(o.body);storedBefore=await read_state(identity_key);if(storedBefore.offers!==1)throw Error('not committed');if(await Bun.file(process.env.TIBO_STATE_DIR+'/'+identity_key+'.json.lock/owner.json').exists())throw Error('identity lock held');return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({wish:generated})}}]}))};${setup}const first=await pray({action:'offer'},{...ctx,requestId:'same-event'},{prayerMaterial:'Rust借用检查不过，希望CI全绿，邮箱me@example.com'});const repeat=await pray({action:'offer'},{...ctx,requestId:'same-event'});await pray({action:'me'},ctx);await pray({action:'board'},ctx);await pray({action:'stats'},ctx);console.log(JSON.stringify({first,repeat,calls,body,storedBefore,after:await read_state(identity_key)}));`);
 expect(r.calls).toBe(1);expect(r.first).toEqual(r.repeat);expect(r.first.text).toContain('CI天灯');expect(Object.keys(r.first).sort()).toEqual(['ok','text']);
 const input=JSON.parse(r.body.messages[1].content);expect(input.scene).toBe('first');expect(input.material).toContain('Rust借用检查');expect(input.material).not.toContain('me@example.com');expect(Object.keys(input).sort()).toEqual(['material','recentProse','scene','variant']);expect(JSON.stringify(r.body)).not.toMatch(/private-owner|private-room|fixture-key/);expect(r.body.max_tokens).toBe(160);expect(r.body.temperature).toBe(1.2);
 expect(r.storedBefore.offers).toBe(1);expect(r.storedBefore.scopes[0].state.receipts[0].text).toContain('token');expect(r.after.offers).toBe(1);expect(r.after.scopes[0].state.receipts[0].text).toBe(r.first.text);
});
test('disabled, no-ai and provider cooling keep local blessings with zero network calls',async()=>{
 const r=await trial(`let calls=0;globalThis.fetch=async()=>{calls++;throw Error('must not fetch')};${setup}const {config}=await import(${JSON.stringify(root+'/ai/runtime.mjs')});const {execute_query,resolve_query}=await import(${JSON.stringify(root+'/commands/index.mjs')});const a=await execute_query(await resolve_query('pray --no-ai',{}, {humanInput:true}),{humanInput:true,noAi:true,context:ctx});process.env.TIBO_AI_FEATURES='';const b=await pray({action:'offer'},{...ctx,requestId:'disabled'});process.env.TIBO_AI_FEATURES='wish';await write_state('ai',{identity:config().identity,provider:{until:Date.now()+60000},features:{},cache:[]});const c=await pray({action:'offer'},{...ctx,requestId:'blocked'});console.log(JSON.stringify({calls,a,b,c,count:(await read_state(identity_key)).offers}));`);
 expect(r.calls).toBe(0);expect(r.count).toBe(3);for(const v of [r.a,r.b,r.c]){expect(v.ok).toBe(true);expect(v.text).toContain('token');expect(v.text).not.toContain('出了问题');}
});
test('slow AI aborts within the prayer budget, leaves a durable fallback and never counts a replay again',async()=>{
 const r=await trial(`let calls=0;globalThis.fetch=async(url,o)=>{calls++;return new Promise((resolve,reject)=>o.signal.addEventListener('abort',()=>reject(o.signal.reason),{once:true}))};${setup}const started=Date.now();const a=await pray({action:'offer'},{...ctx,requestId:'timeout'});const elapsed=Date.now()-started;const b=await pray({action:'offer'},{...ctx,requestId:'timeout'});console.log(JSON.stringify({a,b,calls,elapsed,root:await read_state(identity_key)}));`);
 expect(r.calls).toBe(1);expect(r.elapsed).toBeLessThan(2300);expect(r.a).toEqual(r.b);expect(r.a.text).toContain('token');expect(r.root.offers).toBe(1);expect(r.root.merit).toBe(1);
});
test('invalid wish output cools only its own task and preserves prayer accounting',async()=>{
 const r=await trial(`let calls=0,answerMode=false;globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:answerMode?'{"text":"still works"}':'{"wish":"已重置token额度"}'}}]}))};${setup}for(let i=0;i<3;i++)await pray({action:'offer'},{...ctx,requestId:'bad-'+i});const {ai_status,ai_call}=await import(${JSON.stringify(root+'/ai/runtime.mjs')});const status=await ai_status();const badCalls=calls;answerMode=true;process.env.TIBO_AI_FEATURES='wish,answer';const other=await ai_call('answer',{instruction:'answer',evidence:{}},v=>v);console.log(JSON.stringify({calls:badCalls,status,other,root:await read_state(identity_key)}));`);
 expect(r.calls).toBe(2);expect(r.status.circuit.features.wish.until).toBeGreaterThan(Date.now());expect(r.status.circuit.provider.until).toBe(0);expect(r.other.state).toBe('ok');expect(r.root.offers).toBe(3);for(const receipt of r.root.scopes[0].state.receipts)expect(receipt.text).toContain('🪄');
});
