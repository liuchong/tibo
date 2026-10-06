import {test,expect} from 'bun:test';import {spawn} from 'node:child_process';import {mkdtemp,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';
test('four real processes share the prayer transaction lock without losing or duplicating 128 offerings',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'tibo-pray-processes-'));const children=[];
 try{
  const results=await Promise.all(Array.from({length:4},(_,i)=>new Promise(resolveResult=>{
   const code=`const {pray}=await import(${JSON.stringify(resolve('dist/src/prayer/pray.mjs'))});const ctx={transport:'fixture-im',actor:'person${i}',scope:'same-room',authenticated:true};for(let n=0;n<32;n++)await pray({action:'offer'},{...ctx,requestId:'event'+n},{noAi:true});`;
   const child=spawn(process.execPath,['--eval',code],{env:{...process.env,TIBO_CONFIG_FILE:'/dev/null',TIBO_STATE_DIR:dir,TIBO_AI_FEATURES:''},stdio:['ignore','ignore','pipe']});children.push(child);let error='';child.stderr.on('data',d=>error+=String(d).slice(0,2000));const timer=setTimeout(()=>child.kill('SIGTERM'),12000);child.once('close',status=>{clearTimeout(timer);resolveResult({status,error});});
  })));
  for(const result of results)expect(result.status,result.error).toBe(0);
  const state=JSON.parse(await readFile(join(dir,'pray-identities.json'),'utf8'));expect(state.offers).toBe(128);expect(state.merit).toBe(4);expect(state.members).toHaveLength(4);expect(state.scopes[0].state.offers).toBe(128);expect(state.scopes[0].state.receipts).toHaveLength(128);for(const member of state.members)expect(member.offers).toBe(32);
 }finally{for(const child of children)if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');await rm(dir,{recursive:true,force:true});}
},20000);
