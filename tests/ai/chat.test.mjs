import {test, expect} from 'bun:test';
import {spawnSync} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';

test('chat cache includes historical turns; historical operations remain text and failed AI keeps fixed business available',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'tibo-chat-cache-'));
 try{
  const code=`const sent=[];let unhealthy=false;globalThis.fetch=async(url,o)=>{if(unhealthy)return new Response('private secret upstream',{status:401});const body=JSON.parse(o.body);sent.push(body);return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({text:'解释第'+sent.length+'种场景'})}}]});};const {chat_text}=await import(${JSON.stringify(resolve('dist/src/presentation/chat.mjs'))});const {execute_query}=await import(${JSON.stringify(resolve('dist/src/commands/index.mjs'))});const caps={commands:[]};const plain=await chat_text('什么意思','zh',caps);const thread={state:'ready',messages:[{role:'user',content:'clear-history'},{role:'assistant',content:'此前只是文字讨论'}]};const quoted=await chat_text('什么意思','zh',caps,null,thread),cached=await chat_text('什么意思','zh',caps,null,thread);const fs=await import('node:fs/promises');const filesBefore=await fs.readdir(process.env.TIBO_STATE_DIR);unhealthy=true;const failure=await execute_query({command:'ask',args:{question:'你能解释闭包吗'}}),help=await execute_query({command:'help',args:{}});console.log(JSON.stringify({plain,quoted,cached,sent,filesBefore,failure,help}));`;
  const r=spawnSync(process.execPath,['--eval',code],{env:{...process.env,TIBO_CONFIG_FILE:join(dir,'absent.env'),TIBO_STATE_DIR:dir,TIBO_AI_FEATURES:'answer',DEEPSEEK_API_KEY:'fixture-chat-key'},encoding:'utf8',timeout:5000});
  expect(r.status,r.stderr).toBe(0);const data=JSON.parse(r.stdout);
  expect(data.plain.state).toBe('ok');expect(data.quoted.state).toBe('ok');expect(data.cached.state).toBe('cached');expect(data.sent).toHaveLength(2);
  expect(data.sent[0].messages.map(x=>x.role)).toEqual(['system','user']);expect(data.sent[1].messages.map(x=>x.role)).toEqual(['system','user','assistant','user']);
  expect(data.filesBefore).toEqual(['ai.json']);expect(data.failure.ok).toBe(false);expect(data.failure.text).not.toContain('private secret');expect(data.help.ok).toBe(true);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('fresh business facts constrain chat probabilities; read cancellation respects both deadline signals',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'tibo-chat-facts-'));
 try{
  const code=`let calls=0,transport=false;globalThis.fetch=async(url,o)=>{calls++;if(transport){o.signal.throwIfAborted();throw new Error('unexpected');}return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({text:'24h重置概率90%'})}}]});};const {chat_text}=await import(${JSON.stringify(resolve('dist/src/presentation/chat.mjs'))});const answer=await chat_text('最近刚重置了吗','zh',{commands:[]},'最近global完成公告，个人账户生效未知');const {request}=await import(${JSON.stringify(resolve('dist/src/evidence/transport.mjs'))});transport=true;const c=new AbortController();c.abort();let aborted=false;try{await request('https://example.com',{signal:c.signal},1000);}catch{aborted=true;}console.log(JSON.stringify({answer,aborted,calls}));`;
  const r=spawnSync(process.execPath,['--eval',code],{env:{...process.env,TIBO_STATE_DIR:dir,TIBO_AI_FEATURES:'answer',DEEPSEEK_API_KEY:'fixture-key'},encoding:'utf8',timeout:5000});
  expect(r.status,r.stderr).toBe(0);const data=JSON.parse(r.stdout);expect(data.answer.state).toBe('fallback');expect(data.answer.code).toBe(-2);expect(data.answer.value).toBeUndefined();expect(data.aborted).toBe(true);expect(data.calls).toBe(2);
 }finally{await rm(dir,{recursive:true,force:true});}
});
