import {test,expect} from 'bun:test';
import {mkdtemp,writeFile,rm,cp} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';
import {spawn,spawnSync} from 'node:child_process';import {snapshot} from './fixture.mjs';

test('dependency-free MCP subprocess negotiates lifecycle, calls tools, validates RPC and shuts down',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'tibo-mcp-'));const file=join(dir,'snapshot.json');await writeFile(file,JSON.stringify(snapshot()));
 const child=spawn(process.execPath,[resolve('bin/tibo.mjs'),'mcp'],{env:{...process.env,TIBO_SNAPSHOT:file,TIBO_STATE_DIR:join(dir,'state')},stdio:['pipe','pipe','pipe']});
 let buffer='',stderr='',sequence=0;const pending=new Map();const frames=[];
 child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stderr.on('data',text=>stderr+=text);
 child.stdout.on('data',text=>{buffer+=text;let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);const message=JSON.parse(line);frames.push(message);const handler=pending.get(message.id);if(handler){pending.delete(message.id);handler(message);}}});
 const send=message=>child.stdin.write(JSON.stringify(message)+'\n');
 const request=(method,params)=>new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(new Error('MCP response timeout'));},3000);pending.set(id,message=>{clearTimeout(timer);resolve(message);});send({jsonrpc:'2.0',id,method,params});});
 const closed=new Promise(resolve=>child.once('close',resolve));
 try{
  expect((await request('tools/list')).error.code).toBe(-32002);
  expect((await request('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'native-test',version:'1'}})).result.protocolVersion).toBe('2025-11-25');
  send({jsonrpc:'2.0',method:'notifications/initialized'});
  expect((await request('tools/list')).result.tools.map(x=>x.name)).toEqual(['codex_reset_forecast','codex_reset_status','codex_reset_history','tibo_query','tibo_ask']);
  const forecast=(await request('tools/call',{name:'codex_reset_forecast',arguments:{}})).result;
  expect(forecast.isError).not.toBe(true);expect(forecast.content[0].text).toContain('**Codex 重置概率');
  const posts=(await request('tools/call',{name:'tibo_query',arguments:{command:'posts',args:{limit:1}}})).result;
  expect(posts.isError).not.toBe(true);expect(posts.content[0].text).toContain('Tibo X 发言');
  expect((await request('tools/call',{name:'tibo_ask',arguments:{question:'帮助'}})).result.content[0].text).toContain('Tibo 查询命令');
  expect((await request('tools/call',{name:'tibo_query',arguments:{command:'service',args:{}}})).result.isError).toBe(true);
  expect((await request('tools/call',{name:'tibo_query',arguments:{command:'clear-history',args:{}}})).result.isError).toBe(true);
  const status=(await request('tools/call',{name:'codex_reset_status',arguments:{since:'2026-09-23T00:00:00Z'}})).result;
  expect(JSON.parse(status.content[0].text).newSince).toBe('confirmed');
  const history=(await request('tools/call',{name:'codex_reset_history',arguments:{offset:1,limit:2}})).result;
  expect(JSON.parse(history.content[0].text).events).toHaveLength(2);
  expect((await request('tools/call',{name:'codex_reset_status',arguments:{since:'invalid'}})).result.isError).toBe(true);
  expect((await request('tools/call',{name:'codex_reset_history',arguments:{limit:101}})).result.isError).toBe(true);
  expect((await request('tools/call',{name:'absent',arguments:{}})).error.code).toBe(-32602);
  expect((await request('absent')).error.code).toBe(-32601);
  child.stdin.end();expect(await closed).toBe(0);expect(stderr).toBe('');expect(buffer).toBe('');expect(frames.every(x=>x.jsonrpc==='2.0')).toBe(true);
 }finally{child.kill();await closed;await rm(dir,{recursive:true,force:true});}
},10000);

test('CLI and independent Lark entry run with no node_modules directory',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'tibo-cli-'));const file=join(dir,'snapshot.json');await writeFile(file,JSON.stringify(snapshot()));
 await cp(resolve('dist'),join(dir,'dist'),{recursive:true,filter:path=>!path.includes('node_modules')});
 await cp(resolve('bin'),join(dir,'bin'),{recursive:true});await cp(resolve('adapters/lark/start.mjs'),join(dir,'lark.mjs'));
 // Lark launcher has a different relative entry when copied as this test fixture.
 await writeFile(join(dir,'lark.mjs'),"import './dist/adapters/lark/bot.mjs';\n");
 try{
  const env={...process.env,TIBO_STATE_DIR:join(dir,'state'),TIBO_LARK_CHAT_IDS:'',TIBO_LARK_APP_ID:'',TIBO_LARK_APP_SECRET:''};
  const run=args=>spawnSync(process.execPath,[join(dir,'bin/tibo.mjs'),...args],{cwd:dir,encoding:'utf8',env,timeout:5000});
  const f=run(['forecast','--snapshot',file]);expect(f.status).toBe(0);expect(f.stdout).toContain('• 模型验证');expect(f.stderr).toBe('');
  const s=run(['status','--snapshot',file,'--since','2026-09-23T00:00:00Z']);expect(s.status).toBe(0);expect(JSON.parse(s.stdout).accountApplied).toBe('unknown');
  const bad=run(['status','--snapshot',file,'--since','no-time']);expect(bad.status).toBe(1);expect(bad.stdout).toBe('');
  const l=spawnSync(process.execPath,[join(dir,'lark.mjs')],{cwd:dir,encoding:'utf8',env,timeout:5000});expect(l.status).toBe(1);expect(l.stderr).toContain('群ID');
 }finally{await rm(dir,{recursive:true,force:true});}
});
