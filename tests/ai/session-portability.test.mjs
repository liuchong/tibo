import {test,expect} from 'bun:test';
import {spawnSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';

test('shared core orders opaque sessions, isolates transports and lets other dialogues progress without platform modules',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'tibo-session-portability-'));
 try{
  const code=`
const {with_session}=await import(${JSON.stringify(resolve('dist/src/chat/session.mjs'))});
const {conversation_key,read_session,import_turns,commit_turn}=await import(${JSON.stringify(resolve('dist/src/chat/store.mjs'))});
const ctx={transport:'generic-chat',account:'application',scope:'room',authenticated:true},other={...ctx,transport:'second-chat'};
const events=[];let release;const gate=new Promise(r=>release=r);
async function append(context,root,name,blocked=false){
 const key=conversation_key(context,root);const state=await read_session(key);
 events.push(name+':start');if(blocked)await gate;
 await commit_turn({key,revision:state.revision,sourceId:name+'#request',user:{role:'user',content:name+' question'},assistant:name+' answer'},name+'#sent');
 events.push(name+':end');return name;
}
const a=with_session(ctx,async()=>{await new Promise(r=>setTimeout(r,20));return 'conversation/free.id';},()=>append(ctx,'conversation/free.id','a',true));
const b=with_session(ctx,async()=> 'conversation/free.id',()=>append(ctx,'conversation/free.id','b'));
const c=with_session(ctx,async()=> 'another.topic',()=>append(ctx,'another.topic','c'));
const d=with_session(other,async()=> 'conversation/free.id',()=>append(other,'conversation/free.id','d'));
await Promise.all([c,d]);const before=events.slice();release();const results=await Promise.all([a,b]);
const state=await read_session(conversation_key(ctx,'conversation/free.id')),separate=await read_session(conversation_key(other,'conversation/free.id'));
await import_turns(conversation_key(ctx,'conversation/free.id'),[{id:'source/plain',role:'user',content:'Imported generic text',page_token:'ignored',root_id:'ignored'}],123);
const imported=await read_session(conversation_key(ctx,'conversation/free.id'));
console.log(JSON.stringify({before,events,results,state,separate,imported}));
`;
  const r=spawnSync(process.execPath,['--eval',code],{env:{...process.env,TIBO_CONFIG_FILE:join(dir,'absent.env'),TIBO_STATE_DIR:dir},
   encoding:'utf8',timeout:5000});
  expect(r.status,r.stderr).toBe(0);const d=JSON.parse(r.stdout);
  expect(d.before).toContain('c:end');expect(d.before).toContain('d:end');expect(d.before).not.toContain('a:end');expect(d.before).not.toContain('b:start');
  expect(d.events.indexOf('a:end')).toBeLessThan(d.events.indexOf('b:start'));expect(d.results).toEqual(['a','b']);
  expect(d.state.turns.map(x=>x.content)).toEqual(['a question','a answer','b question','b answer']);
  expect(d.separate.turns.map(x=>x.content)).toEqual(['d question','d answer']);
  expect(d.imported.turns.at(-1)).toEqual({role:'user',content:'Imported generic text'});expect(d.imported.through).toBe(123);
  expect(JSON.stringify(d.imported)).not.toContain('page_token');expect(JSON.stringify(d.imported)).not.toContain('root_id');
 }finally{await rm(dir,{recursive:true,force:true});}
});
