import {test,expect} from 'bun:test';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {with_lock,write_state,read_state,state_root} from '../dist/src/state.mjs';
test('state lock excludes a concurrent instance and releases after failure',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'tibo-state-'));const old=process.env.TIBO_STATE_DIR;process.env.TIBO_STATE_DIR=dir;
 try{
  await expect(with_lock('instance',async()=>{await expect(with_lock('instance',async()=>1)).rejects.toThrow('已有实例');throw new Error('stop');})).rejects.toThrow('stop');
  expect(await with_lock('instance',async()=>42)).toBe(42);
  await write_state('record',{now:'2026-10-03T00:00:00Z'});expect((await read_state('record')).now).toBe('2026-10-03T00:00:00Z');
  await expect(read_state('../outside')).rejects.toThrow();
 }finally{if(old===undefined)delete process.env.TIBO_STATE_DIR;else process.env.TIBO_STATE_DIR=old;await rm(dir,{recursive:true,force:true});}
});
