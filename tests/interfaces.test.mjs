import {test,expect} from 'bun:test';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {spawnSync} from 'node:child_process';import {snapshot} from './fixture.mjs';

test('Bun MCP subprocess negotiates protocol, lists tools, calls all tools, and keeps stdout clean',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'tibo-mcp-'));const file=join(dir,'snapshot.json');await writeFile(file,JSON.stringify(snapshot()));
 const transport=new StdioClientTransport({command:process.execPath,args:[resolve('bin/tibo.mjs'),'mcp'],env:{...process.env,TIBO_SNAPSHOT:file,TIBO_STATE_DIR:join(dir,'state')},stderr:'pipe'});
 const client=new Client({name:'tibo-test',version:'1'},{capabilities:{}});
 try{
  await client.connect(transport);expect((await client.listTools()).tools.map(x=>x.name)).toEqual(['codex_reset_forecast','codex_reset_status','codex_reset_history']);
  const forecast=await client.callTool({name:'codex_reset_forecast',arguments:{}});expect(forecast.isError).not.toBe(true);expect(forecast.content[0].text).toContain('**Codex 重置判断');
  const status=await client.callTool({name:'codex_reset_status',arguments:{since:'2026-09-23T00:00:00Z'}});expect(JSON.parse(status.content[0].text).newSince).toBe('confirmed');
  const history=await client.callTool({name:'codex_reset_history',arguments:{offset:1,limit:2}});expect(JSON.parse(history.content[0].text).events).toHaveLength(2);
  const bad=await client.callTool({name:'codex_reset_status',arguments:{since:'invalid'}});expect(bad.isError).toBe(true);
  const invalid=await client.callTool({name:'codex_reset_history',arguments:{limit:101}});expect(invalid.isError).toBe(true);
 }finally{await client.close();await rm(dir,{recursive:true,force:true});}
},10000);

test('CLI snapshot produces v1.1 and machine-readable status with nonzero error exit',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'tibo-cli-'));const file=join(dir,'snapshot.json');await writeFile(file,JSON.stringify(snapshot()));
 try{
  const run=args=>spawnSync(process.execPath,[resolve('bin/tibo.mjs'),...args],{encoding:'utf8',env:{...process.env,TIBO_STATE_DIR:join(dir,'state')}});
  const f=run(['forecast','--snapshot',file]);expect(f.status).toBe(0);expect(f.stdout).toContain('**结论**');expect(f.stderr).toBe('');
  const s=run(['status','--snapshot',file,'--since','2026-09-23T00:00:00Z']);expect(s.status).toBe(0);expect(JSON.parse(s.stdout).accountApplied).toBe('unknown');
  const bad=run(['status','--snapshot',file,'--since','no-time']);expect(bad.status).toBe(1);expect(bad.stdout).toBe('');
 }finally{await rm(dir,{recursive:true,force:true});}
});
