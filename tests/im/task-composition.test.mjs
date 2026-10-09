import {test,expect} from 'bun:test';
import {parallel_tasks,sequence_tasks,run_tasks} from '../../dist/src/im/tasks.mjs';
import {reset_invocation_QMARK_} from '../../dist/src/im/plan.mjs';
import {message_intents} from '../../dist/src/im/intents.mjs';

test('nested parallel and sequence groups propagate results and deliver without a group barrier',async()=>{
 let release;const gate=new Promise(r=>release=r),seen=[];
 const work=run_tasks(parallel_tasks([
  sequence_tasks([async()=>{seen.push('projection');return 'sent'},parallel_tasks([
   async previous=>{expect(previous).toBe('sent');seen.push('forecast-start');await gate;seen.push('forecast-sent');return 24},
   sequence_tasks([async()=>{seen.push('extra-start');return 'extra'},async value=>{seen.push(value+'-sent');return true}])
  ]),async values=>{expect(values[0].value).toBe(24);seen.push('chain-done')}]),
  async()=>{seen.push('prayer-sent');return true}
 ]));
 for(let i=0;i<100&&!seen.includes('extra-sent');i++)await new Promise(r=>setTimeout(r,1));
 expect(seen).toContain('prayer-sent');expect(seen).toContain('extra-sent');expect(seen).not.toContain('chain-done');
 release();await work;expect(seen.indexOf('projection')).toBeLessThan(seen.indexOf('forecast-start'));expect(seen.at(-1)).toBe('chain-done');
});
test('failure stops its dependent chain while parallel siblings settle and complete',async()=>{
 const seen=[];
 await expect(run_tasks(parallel_tasks([sequence_tasks([async()=>{throw Error('send failed')},async()=>seen.push('forbidden')]),async()=>{await new Promise(r=>setTimeout(r,5));seen.push('prayer-sent')}]))).rejects.toThrow('send failed');
 expect(seen).toEqual(['prayer-sent']);
 expect(await run_tasks(sequence_tasks([async()=>false,async()=>seen.push('forbidden')]))).toBe(false);
 expect(seen).toEqual(['prayer-sent']);
});
test('only a reset invocation receives the forecast continuation; business and admin commands do not',()=>{
 for(const text of ['请给我一次重置吧！','伟大的重置之神啊，请赐予我一次重置吧！','ask "请给我重置token额度"','Please reset my quota'])expect(reset_invocation_QMARK_(text)).toBe(true);
 for(const text of ['请帮我重置路由器','请重置密码','Please reset my router','forecast','重置概率','什么时候重置','Claude编程好用吗','reset-ai','clear-history','confirm bad','pray','help |ask 请重置','ask "重置历史"'])expect(reset_invocation_QMARK_(text)).toBe(false);
});
test('plain unmentioned reset petitions with either prayer representation directly trigger their companion',()=>{
 for(const text of ['请给我一次重置吧！🙏','求重置🙏','请给我重置吧[双手合十]','Please reset 🙏']){
  const candidate=message_intents(text,false,false);expect(candidate.kind).toBe('prayer');expect(candidate.companion.level).toBe(1);
  expect(reset_invocation_QMARK_(candidate.companion.command)).toBe(true);
 }
 for(const text of ['请帮我重置路由器🙏','请重置密码[双手合十]','Please reset my router 🙏'])expect(message_intents(text,false,false).companion).toBeUndefined();
});
