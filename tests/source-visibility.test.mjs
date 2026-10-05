import {test,expect} from 'bun:test';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {source_free_text} from '../dist/src/privacy.mjs';
import {reference_url} from '../dist/src/reference.mjs';
import {snapshot} from './fixture.mjs';

const hidden=[reference_url,'https://aiidelist.com/codex-reset','https://codex.lunarwerx.com'];
const hosts=hidden.map(x=>new URL(x).hostname);
function clean(text){for(const host of hosts)expect(text.toLowerCase()).not.toContain(host);}

test('display filter hides plain names and links, preserves X evidence and numbers, and keeps nested JSON valid',()=>{
 const original=hidden.map(x=>`[资料](${x}/data) ${x.toUpperCase()} ${new URL(x).hostname}`).join('\n');
 const text=source_free_text(original+'\nUTC 10-05 15:00 17% https://x.com/thsottiaux/status/2106967126250791091');
 clean(text);expect(text).toContain('UTC 10-05 15:00 17%');expect(text).toContain('https://x.com/thsottiaux/status/2106967126250791091');expect(text).not.toContain('](https://');
 const encoded=source_free_text(JSON.stringify({text:JSON.stringify({sourceUrl:hidden[0],body:original})}));
 const data=JSON.parse(JSON.parse(encoded).text);clean(JSON.stringify(data));expect(data.sourceUrl).toBe('[数据源]');
});

test('real CLI help, original pipeline and JSON reports never expose internal discovery names or addresses',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'tibo-display-'));
 try{
  const evidence=snapshot();evidence.posts[0].text+=' '+hidden.join(' ');evidence.posts[0].discoverySourceUrl=hidden[0];
  evidence.events[0].sourceUrl=hidden[1];evidence.sources=[{name:'archive',ok:true,url:hidden[1],body:hidden[2]}];
  const path=join(dir,'snapshot.json');await writeFile(path,JSON.stringify(evidence));
  const env={...process.env,TIBO_CONFIG_FILE:'/dev/null',TIBO_STATE_DIR:dir,TIBO_AI_FEATURES:'',DEEPSEEK_API_KEY:''};
  for(const args of [['help'],['commands'],['posts','--limit','1','--snapshot',path,'|original'],['forecast','--json','--snapshot',path],['history','--snapshot',path]]){
   const r=spawnSync(process.execPath,[resolve('bin/tibo.mjs'),...args],{env,encoding:'utf8',timeout:7000});
   expect({args,status:r.status,stdout:r.stdout,stderr:r.stderr}).toMatchObject({status:0,stderr:''});clean(r.stdout);
   if(args.includes('--json')){const data=JSON.parse(r.stdout);expect(data.forecast.p24).toBeGreaterThan(0);}
  }
  const frames=[{jsonrpc:'2.0',id:1,method:'initialize'},{jsonrpc:'2.0',method:'notifications/initialized'},
   {jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'codex_reset_history',arguments:{}}}];
  const mcp=spawnSync(process.execPath,[resolve('bin/tibo.mjs'),'mcp'],{env:{...env,TIBO_SNAPSHOT:path},encoding:'utf8',input:frames.map(x=>JSON.stringify(x)).join('\n')+'\n',timeout:7000});
  expect(mcp.status).toBe(0);expect(mcp.stderr).toBe('');clean(mcp.stdout);
  const result=mcp.stdout.trim().split('\n').map(x=>JSON.parse(x)).find(x=>x.id===2);expect(result.result.isError).not.toBe(true);
  expect(JSON.parse(result.result.content[0].text).events).toHaveLength(evidence.events.length);
 }finally{await rm(dir,{recursive:true,force:true});}
});
