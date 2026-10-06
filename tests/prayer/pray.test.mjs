import {test,expect} from 'bun:test';
import {mkdtemp,rm,readdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {pray,scope_key,identity_key} from '../../dist/src/prayer/pray.mjs';
import {fixed_query,execute_query,resolve_query} from '../../dist/src/commands/index.mjs';
import {read_state,write_state} from '../../dist/src/platform/state.mjs';
test('pray shares genuine personal identity across conversations, cooldown, dedup, tiers, calendar streak and anonymous leaderboard',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'tibo-pray-')),old=process.env.TIBO_STATE_DIR,nativeNow=Date.now;process.env.TIBO_STATE_DIR=dir;
 let now=Date.parse('2026-10-04T15:59:00Z');Date.now=()=>now;
 const ctx={transport:'future-im',actor:'private-user-A',scope:'room-one',authenticated:true};
 const conversation=async()=> (await read_state(identity_key)).scopes.find(x=>x.key===scope_key(ctx)).state;
 const offer=async(request)=>pray({action:'offer'},{...ctx,requestId:request});
 try{
  expect(fixed_query('🙏🏽 🙏')).toEqual({command:'pray',args:{action:'offer',limit:10}});
  expect(fixed_query('pray board 2').args).toEqual({action:'board',limit:2});
  const first=await offer('one');expect(first.text).toContain('第一炷');
  expect((await offer('one')).text).toBe(first.text);
  expect((await offer('two')).text).toContain('冷却');
  let state=await conversation();expect(state.offers).toBe(2);expect(state.merit).toBe(1);
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
  let collective='';for(let i=0;i<4;i++){now+=16000;collective+=(await offer('pool-'+i)).text;}
  expect(collective).toContain('集体愿力10');
  expect((await pray({action:'me'},{...ctx,scope:'room-two'})).text).toBe((await pray({action:'me'},ctx)).text);
  expect((await pray({action:'stats'},{...ctx,scope:'room-two'})).text).toContain('累计🙏：0');
  expect((await pray({action:'me'},{...ctx,transport:'another-im'})).text).toContain('还没有');
  state=await conversation();const before=state.offers;
  await pray({action:'me'},ctx);await pray({action:'board'},ctx);await pray({action:'stats'},ctx);
  expect((await conversation()).offers).toBe(before);
  now=Date.parse('2026-10-08T16:01:00Z');await offer('gap');expect((await pray({action:'me'},ctx)).text).toContain('连续打卡：1天；最长：3天');
  // Exercise a high milestone with preserved historical counters.
  const root=await read_state(identity_key);const m=root.members[0];m.merit=232;m.offers=240;root.merit=232+root.members[1].merit;root.offers=240+root.members[1].offers;
  await write_state(identity_key,root);now+=16000;
  expect((await offer('233')).text).toContain('233 笑到功德溢出');
  const files=await readdir(dir);expect(files.every(x=>x.startsWith('pray-'))).toBe(true);
  const raw=await readFile(join(dir,identity_key+'.json'),'utf8');expect(raw).not.toMatch(/private-user|room-one/);
  expect((await execute_query({command:'pray',args:{action:'offer'}})).ok).toBe(false);
  expect((await pray({action:'offer'},{...ctx,authenticated:false})).ok).toBe(false);
 }finally{Date.now=nativeNow;if(old===undefined)delete process.env.TIBO_STATE_DIR;else process.env.TIBO_STATE_DIR=old;await rm(dir,{recursive:true,force:true});}
});
test('emoji and fixed pray work with semantic AI disabled',async()=>{
 const old=process.env.TIBO_AI_FEATURES;process.env.TIBO_AI_FEATURES='';
 try{expect((await resolve_query('🙏')).command).toBe('pray');expect((await resolve_query('[双手合十]')).command).toBe('pray');expect((await resolve_query('pray me')).args.action).toBe('me');}
 finally{if(old===undefined)delete process.env.TIBO_AI_FEATURES;else process.env.TIBO_AI_FEATURES=old;}
});

test('legacy room and DM profiles migrate once; shared cooldown and cross-room identity retain local pools and receipts',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'tibo-pray-migrate-')),old=process.env.TIBO_STATE_DIR,nativeNow=Date.now;process.env.TIBO_STATE_DIR=dir;
 let now=Date.parse('2026-10-05T12:00:00Z');Date.now=()=>now;
 const ctx={transport:'lark',actor:'ou_owner',scope:'oc_group',authenticated:true};
 const {createHash}=await import('node:crypto');const id=createHash('sha256').update('lark:ou_owner').digest('hex');
 const legacy=(offers,merit)=>({schemaVersion:1,offers,merit,receipts:[],festivals:[],members:[{id,alias:'香客001',offers,merit,daily:offers,lastDay:'2026-10-05',streak:2,bestStreak:3,badges:['功德1'],firstAt:'2026-10-04T12:00:00.000Z',lastAt:'2026-10-05T11:00:00.000Z',creditedAt:now-3600000}]});
 try{
  const dm={...ctx,scope:'oc_dm'};await write_state(scope_key(ctx),legacy(3,2));await write_state(scope_key(dm),legacy(2,1));
  const before=await readFile(join(dir,scope_key(ctx)+'.json'),'utf8');
  const merged=(await pray({action:'me'},dm)).text;expect(merged).toContain('累计🙏：5；功德：3');expect(merged).toContain('今日🙏：5');expect(merged).toContain('在线上香员');
  expect((await pray({action:'me'},ctx)).text).toBe(merged);
  expect((await pray({action:'stats'},ctx)).text).toContain('累计🙏：3；累计功德：2');
  const receipt=await pray({action:'offer'},{...ctx,requestId:'group-one'});expect(receipt.text).toContain('累计🙏 6｜功德 4');
  expect((await pray({action:'offer'},{...ctx,requestId:'group-one'})).text).toBe(receipt.text);
  const next=await pray({action:'offer'},{...dm,requestId:'dm-one'});expect(next.text).toContain('累计🙏 7｜功德 4');expect(next.text).toContain('冷却');
  expect((await pray({action:'me'},ctx)).text).toBe((await pray({action:'me'},dm)).text);
  expect((await pray({action:'me'},{...ctx,scope:'oc_another'})).text).toBe((await pray({action:'me'},dm)).text);
  expect((await pray({action:'stats'},dm)).text).toContain('累计🙏：3；累计功德：1');
  expect((await pray({action:'board'},ctx)).text).toContain('功德 3｜🙏 4');
  expect((await pray({action:'me'},{...dm,actor:'ou_another'})).text).toContain('还没有');
  expect(await readFile(join(dir,scope_key(ctx)+'.json'),'utf8')).toBe(before);
  expect((await read_state(identity_key)).members).toHaveLength(1);
  // Reading again never imports old snapshots a second time.
  expect((await pray({action:'me'},ctx)).text).toContain('累计🙏：7');
 }finally{Date.now=nativeNow;if(old===undefined)delete process.env.TIBO_STATE_DIR;else process.env.TIBO_STATE_DIR=old;await rm(dir,{recursive:true,force:true});}
});
test('corrupt legacy profile fails migration without replacing old files or publishing partial v2 state',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'tibo-pray-corrupt-')),old=process.env.TIBO_STATE_DIR;process.env.TIBO_STATE_DIR=dir;
 const ctx={transport:'future-im',actor:'a',scope:'room',authenticated:true};
 try{await write_state(scope_key(ctx),{schemaVersion:1,members:[]});await expect(pray({action:'me'},ctx)).rejects.toThrow('档案不可读');expect(await read_state(identity_key)).toBeNull();expect((await read_state(scope_key(ctx))).schemaVersion).toBe(1);}
 finally{if(old===undefined)delete process.env.TIBO_STATE_DIR;else process.env.TIBO_STATE_DIR=old;await rm(dir,{recursive:true,force:true});}
});
