import {test,expect} from 'bun:test';
import {reset_expectation} from '../../dist/src/forecast/expectation.mjs';
import {expectation_data,expectation_text} from '../../dist/src/presentation/business.mjs';
const now='2026-10-28T05:43:00Z',at='2026-10-28T02:43:00Z';
const promise={postId:'2090000000000000002',at,targetAt:'2026-10-28T08:00:00Z',primary:true,kind:'global',scope:'global',text:'Lands by midnight PST.',timePrecision:'deadline'};
const result=(p=promise,n=now,g={at:'2026-10-25T06:00:00Z',verified:true})=>({snapshot:{now:n},signals:{promise:p,lastGlobal:g}});
test('deadline state uses the observation clock; due time alone never becomes fulfillment',()=>{
 expect(reset_expectation(result())).toMatchObject({state:'pending',remainingSeconds:8220,targetAt:promise.targetAt});
 for(const n of [promise.targetAt,'2026-10-28T09:00:00Z']){const t=reset_expectation(result(promise,n));expect(t.state).toBe('overdue');expect(t.remainingSeconds).toBeNull();}
 expect(reset_expectation(result(null)).state).toBe('unknown');
});
test('consumed, changed and non-global plans cannot supply a pending deadline',()=>{
 expect(reset_expectation(result({...promise,fulfilled:true})).state).toBe('fulfilled');
 expect(reset_expectation(result(promise,now,{at:'2026-10-28T04:00:00Z',verified:true})).state).toBe('fulfilled');
 expect(reset_expectation(result({...promise,withdrawn:true})).state).toBe('withdrawn');
 expect(reset_expectation(result({...promise,delayed:true})).state).toBe('delayed');
 for(const p of [{...promise,kind:'banked'},{...promise,primary:false},{...promise,targetAt:null}])expect(reset_expectation(result(p)).state).toBe('unverified');
});
test('time display follows configuration and preserves target versus deadline meaning',()=>{
 const old=process.env.TIBO_TIMEZONE;try{
  process.env.TIBO_TIMEZONE='Asia/Shanghai';const zh=expectation_data(result());expect(zh.targetLocal).toBe('北京时间 10-28 16:00');expect(expectation_text(zh)).toContain('16:00 前');
  process.env.TIBO_TIMEZONE='UTC';expect(expectation_data(result()).targetLocal).toBe('UTC 10-28 08:00');
  process.env.TIBO_TIMEZONE='America/Los_Angeles';expect(expectation_data(result()).targetLocal).toBe('America/Los_Angeles 10-28 01:00');
  const point=expectation_text(expectation_data(result({...promise,timePrecision:'instant'})));expect(point).toContain('左右');expect(point).not.toContain('前，约剩');
  expect(expectation_text(expectation_data(result({...promise,fulfilled:true})))).toBeNull();
  expect(expectation_text(expectation_data(result(null)))).toBeNull();
  expect(expectation_text(expectation_data(result(promise,'2026-10-28T09:00:00Z')))).toContain('已过期');
 }finally{if(old===undefined)delete process.env.TIBO_TIMEZONE;else process.env.TIBO_TIMEZONE=old;}
});
