// Developer-only live acceptance runner. All questions use ordinary read-only
// routing; no model can invoke this runner or select process commands.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {AsyncLocalStorage} from 'node:async_hooks';
const argv=process.argv.slice(2),option=(key,fallback)=>argv.includes(key)?argv[argv.indexOf(key)+1]:fallback;
const ids=option('--case','').split(',').filter(Boolean),limit=Number(option('--limit','16'));
const output=resolve(option('--out','.tibo/qa-trial/latest.json'));
const source=JSON.parse(await readFile(new URL('../examples/qa/cases.json',import.meta.url),'utf8'));
const selected=source.cases.filter(c=>!ids.length||ids.includes(c.id)).slice(0,Math.max(0,Math.min(16,limit)));
const scope=new AsyncLocalStorage(),native=globalThis.fetch;
globalThis.fetch=async(url,options={})=>{
 const row=scope.getStore();if(!row)return native(url,options);
 const signal=options.signal?AbortSignal.any([options.signal,row.controller.signal]):row.controller.signal;
 if(String(url).includes('/chat/completions')){
  const body=JSON.parse(options.body),input=JSON.parse(body.messages.at(-1).content);
  row.modelCalls++;if(input.builtinFacts)row.evidence=input.builtinFacts.reads?.map(r=>({method:r.method,state:r.state,data:r.data}));
 }
 return native(url,{...options,signal});
};
const {load_config}=await import('../dist/src/platform/config.mjs');await load_config();
// The shared egress server outlives individual cases; initialize its callbacks
// outside a case so one completed case cannot cancel another case's DNS reads.
const {egress_proxy}=await import('../dist/src/evidence/web-egress.mjs');await egress_proxy();
const {resolve_query,execute_query}=await import('../dist/src/commands/index.mjs');
await mkdir(dirname(output),{recursive:true,mode:0o700});
const results=[];let next=0;
async function run(c){const started=performance.now(),row={controller:new AbortController(),modelCalls:0},timer=setTimeout(()=>row.controller.abort(),65000);try{return await scope.run(row,async()=>{const options={humanInput:true,persist:false};const q=await resolve_query(c.question,null,options),answer=await execute_query(q,options);return {id:c.id,question:c.question,category:c.category,command:q.command,args:q.args,ok:answer.ok&&!row.controller.signal.aborted,text:answer.text,elapsedMs:Math.round(performance.now()-started),modelCalls:row.modelCalls,evidence:row.evidence??answer.data,review:'pending'};});}catch{return {id:c.id,ok:false,state:row.controller.signal.aborted?'timeout':'failed',elapsedMs:Math.round(performance.now()-started),review:'pending'};}finally{clearTimeout(timer);row.controller.abort();}}
let writing=Promise.resolve();
async function save(){const snapshot=JSON.stringify({schemaVersion:1,at:new Date().toISOString(),results},null,2);writing=writing.then(()=>writeFile(output,snapshot,{mode:0o600}));await writing;}
async function worker(){while(next<selected.length){const c=selected[next++],r=await run(c);results.push(r);await save();console.log(`${r.id}: ${r.ok?'answered':'failed'} (${r.elapsedMs} ms)`);}}
await Promise.all([worker(),worker()]);
await save();
if(results.some(r=>!r.ok))process.exitCode=1;
