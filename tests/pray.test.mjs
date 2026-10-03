import {test,expect} from 'bun:test';
import {mkdtemp,rm,readdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {pray,scope_key} from '../dist/src/pray.mjs';
import {fixed_query,execute_query,resolve_query} from '../dist/src/commands.mjs';
import {read_state,write_state} from '../dist/src/state.mjs';
test('pray records genuine identity per transport/conversation, cooldown, dedup, tiers, calendar streak and anonymous leaderboard',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'tibo-pray-')),old=process.env.TIBO_STATE_DIR,nativeNow=Date.now;process.env.TIBO_STATE_DIR=dir;
 let now=Date.parse('2026-10-04T15:59:00Z');Date.now=()=>now;
 const ctx={transport:'future-im',actor:'private-user-A',scope:'room-one',authenticated:true};
 const offer=async(request)=>pray({action:'offer'},{...ctx,requestId:request});
 try{
  expect(fixed_query('🙏🏽 🙏')).toEqual({command:'pray',args:{action:'offer',limit:10}});
  expect(fixed_query('pray board 2').args).toEqual({action:'board',limit:2});
  const first=await offer('one');expect(first.text).toContain('第一炷');
  expect((await offer('one')).text).toBe(first.text);
  expect((await offer('two')).text).toContain('冷却');
  let state=await read_state(scope_key(ctx));expect(state.offers).toBe(2);expect(state.merit).toBe(1);
  now+=16000;await offer('three');now+=16000;expect((await offer('four')).text).toContain('三连诚心');
  expect((await pray({action:'me'},ctx)).text).toContain('在线上香员');
  // Day boundaries use Beijing calendar, not a rolling 24-hour counter.
  now=Date.parse('2026-10-04T16:01:00Z');await offer('day-two');
  now=Date.parse('2026-10-05T16:01:00Z');expect((await offer('day-three')).text).toContain('连续3日');
  const profile=await pray({action:'me'},ctx);expect(profile.text).toContain('连续打卡：3天');
  expect(profile.text).not.toContain('private-user-A');
  now+=16000;await pray({action:'offer'},{...ctx,actor:'private-user-B'});
  const board=await pray({action:'board',limit:2},{...ctx,actor:'private-user-B'});
  expect(board.text).toContain('你的名次：2');expect(board.text).toContain('香客002');
  expect(board.text).not.toMatch(/private-user|room-one|future-im/);
  expect((await pray({action:'stats'},ctx)).text).toContain('香客：2人');
  let collective='';for(let i=0;i<4;i++){now+=16000;collective=(await offer('pool-'+i)).text;}
  expect(collective).toContain('集体愿力10');
  expect((await pray({action:'me'},{...ctx,scope:'room-two'})).text).toContain('还没有');
  expect((await pray({action:'me'},{...ctx,transport:'another-im'})).text).toContain('还没有');
  state=await read_state(scope_key(ctx));const before=state.offers;
  await pray({action:'me'},ctx);await pray({action:'board'},ctx);await pray({action:'stats'},ctx);
  expect((await read_state(scope_key(ctx))).offers).toBe(before);
  now=Date.parse('2026-10-08T16:01:00Z');await offer('gap');expect((await pray({action:'me'},ctx)).text).toContain('连续打卡：1天；最长：3天');
  // Exercise a high milestone with preserved historical counters.
  state=await read_state(scope_key(ctx));const m=state.members[0];m.merit=232;m.offers=240;state.merit=232+state.members[1].merit;state.offers=240+state.members[1].offers;
  await write_state(scope_key(ctx),state);now+=16000;
  expect((await offer('233')).text).toContain('233 笑到功德溢出');
  const files=await readdir(dir);expect(files.every(x=>x.startsWith('pray-'))).toBe(true);
  const raw=await readFile(join(dir,scope_key(ctx)+'.json'),'utf8');expect(raw).not.toMatch(/private-user|room-one/);
  expect((await execute_query({command:'pray',args:{action:'offer'}})).ok).toBe(false);
  expect((await pray({action:'offer'},{...ctx,authenticated:false})).ok).toBe(false);
 }finally{Date.now=nativeNow;if(old===undefined)delete process.env.TIBO_STATE_DIR;else process.env.TIBO_STATE_DIR=old;await rm(dir,{recursive:true,force:true});}
});
test('emoji and fixed pray work with semantic AI disabled',async()=>{
 const old=process.env.TIBO_AI_FEATURES;process.env.TIBO_AI_FEATURES='';
 try{expect((await resolve_query('🙏')).command).toBe('pray');expect((await resolve_query('pray me')).args.action).toBe('me');}
 finally{if(old===undefined)delete process.env.TIBO_AI_FEATURES;else process.env.TIBO_AI_FEATURES=old;}
});
