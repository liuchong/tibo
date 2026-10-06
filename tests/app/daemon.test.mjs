import {test,expect} from 'bun:test';import {mkdtemp,writeFile,readFile,rm,mkdir} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {spawnSync} from 'node:child_process';
import {parse_config} from '../../dist/src/platform/config.mjs';import {plist} from '../../dist/src/platform/service.mjs';import {with_lock} from '../../dist/src/platform/state.mjs';import {snapshot} from '../helpers/fixture.mjs';
test('configuration is data, keeps quoted values, and rejects shell or unrelated environment assignments',()=>{
 expect(parse_config('DEEPSEEK_API_KEY="fixture"\nTIBO_AI_FEATURES=\n')).toEqual({DEEPSEEK_API_KEY:'fixture',TIBO_AI_FEATURES:''});
 expect(()=>parse_config('export DEEPSEEK_API_KEY=fixture')).toThrow();expect(()=>parse_config('PATH=bad')).toThrow();
 const p=plist({binary:'/a&b/tibo',state:'/s',config:'/c'});expect(p).toContain('/a&amp;b/tibo');expect(p).toContain('<key>KeepAlive</key><true/>');expect(p).not.toContain('DEEPSEEK_API_KEY');
});
test('owned locks recover a dead PID but do not remove a live or ownerless lock',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'tibo-lock-')),old=process.env.TIBO_STATE_DIR;process.env.TIBO_STATE_DIR=dir;
 try{await mkdir(join(dir,'dead.json.lock'));await writeFile(join(dir,'dead.json.lock/owner.json'),JSON.stringify({pid:2147483647}));expect(await with_lock('dead',async()=>42)).toBe(42);
 await mkdir(join(dir,'live.json.lock'));await writeFile(join(dir,'live.json.lock/owner.json'),JSON.stringify({pid:process.pid}));await expect(with_lock('live',async()=>42)).rejects.toThrow('已有实例');
 await mkdir(join(dir,'unknown.json.lock'));await expect(with_lock('unknown',async()=>42)).rejects.toThrow('无法确认');
 }finally{if(old===undefined)delete process.env.TIBO_STATE_DIR;else process.env.TIBO_STATE_DIR=old;await rm(dir,{recursive:true,force:true});}
});
test('daemon actually produces a core report when every network source fails and exits on SIGTERM',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'tibo-daemon-'));const host=resolve('dist/src/app/daemon.mjs');
 try{await writeFile(join(dir,'ledger.json'),JSON.stringify(snapshot()));
 const code=`globalThis.fetch=async()=>{throw new Error('unavailable')};const {start_daemon}=await import(${JSON.stringify(host)});await start_daemon(true);console.log('finished');`;
 const env={...process.env,TIBO_STATE_DIR:dir,TIBO_AI_FEATURES:'',TIBO_DAEMON_INTERVAL:'60'};
 const once=spawnSync(process.execPath,['--eval',code],{env,encoding:'utf8',timeout:5000});expect(once.status).toBe(0);expect(once.stdout).toContain('finished');expect(JSON.parse(await readFile(join(dir,'daemon.json'),'utf8')).state).toBe('ready');expect(JSON.parse(await readFile(join(dir,'daemon-latest.json'),'utf8')).report).toContain('**Codex 重置判断');
 const signalCode=`globalThis.fetch=async()=>{throw new Error('unavailable')};const {start_daemon}=await import(${JSON.stringify(host)});setTimeout(()=>process.kill(process.pid,'SIGTERM'),200);await start_daemon();console.log('stopped');`;
 const stop=spawnSync(process.execPath,['--eval',signalCode],{env,encoding:'utf8',timeout:5000});expect(stop.status).toBe(0);expect(stop.stdout).toContain('stopped');expect(stop.stderr).toContain('已停止');
 }finally{await rm(dir,{recursive:true,force:true});}
});
