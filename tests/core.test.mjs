import {test,expect} from 'bun:test';
import {conditional,intervals,banked_lags} from '../dist/src/history.mjs';
import {target_time,normalize_events,analyze_signals,completed_QMARK_} from '../dist/src/signals.mjs';
import {judge,observe,reset_status,validate_snapshot} from '../dist/src/engine.mjs';
import {render_report} from '../dist/src/report.mjs';
import {parse_archive,parse_primary} from '../dist/src/sources.mjs';
import {at,event,post,snapshot} from './fixture.mjs';
const day=86400000;

test('strict conditional survival and inclusive +24/+48 endpoints',()=>{
 const rows=[1,2,3,4,5].map(n=>({duration:n*day,start:at(1)}));
 expect(conditional(rows,2*day)).toMatchObject({n:3,a:1,b:2});
 expect(conditional(rows,5*day)).toMatchObject({n:0,p24:null,p48:null});
 expect(conditional(rows,0,'2026-10-01T00:00:00Z').n).toBe(0);
});
test('banked never moves the global clock; observations do not trigger suppression',()=>{
 const s=snapshot({events:[event(1),event(3),event(10),event(24),event(25,{global:false,banked:true,observed:true})]});
 const r=judge(s); expect(r.signals.lastGlobal.at).toBe(at(24)); expect(r.history.elapsedDays).toBe(1);
 expect(r.forecast.reasons.join('')).not.toContain('温和降低');
});
test('archived banked text overrides mislabeled global record',()=>{
 const s=snapshot({events:[event(1),event(3),event(24),event(25)],posts:[post(25,'A banked reset has been added to all paid accounts.',{id:'event-25'})]});
 const r=observe(s);expect(r.signals.lastGlobal.at).toBe(at(24));expect(r.signals.lastBanked.verifiedBanked).toBe(true);
});
test('future promise does not count as completed global',()=>{
 const s=snapshot({events:[event(1),event(3),event(24),event(25)],posts:[post(25,'Global reset landing tomorrow 10am PST for all paid accounts.',{id:'event-25'})]});
 expect(observe(s).signals.lastGlobal.at).toBe(at(24));
});
test('Pacific tomorrow uses San Francisco date and explicit PST is UTC-8',()=>{
 expect(target_time(post(25,'Global reset landing tomorrow 10am PST for all paid accounts.',{at:'2026-10-02T02:14:51Z'}))).toBe('2026-10-02T18:00:00.000Z');
 expect(target_time(post(25,'Global reset landing tomorrow 10am PDT for all paid accounts.',{at:'2026-10-02T02:14:51Z'}))).toBe('2026-10-02T17:00:00.000Z');
 expect(target_time(post(25,'Global reset landing tomorrow 10am PT for all paid accounts.',{at:'2026-10-02T02:14:51Z'}))).toBe('2026-10-02T17:00:00.000Z');
});
test('unparseable time, missing object and negation cannot become a timed promise',()=>{
 for(const text of ['reset next week','Global reset landing tomorrow 10am PST.','I cannot give a reset tomorrow 10am PST for all accounts.']){
  const s=snapshot({posts:[post(25,text)]}); const r=judge(s);expect(r.signals.promise).toBeNull();expect(r.forecast.confidence).toBe('低');
 }
});
test('fresh explicit primary promise is a strong signal separate from historical probability',()=>{
 const s=snapshot({now:'2026-09-25T01:00:00Z',posts:[post(25,'Global reset landing tomorrow 10am PST for all paid accounts.')]});
 const r=judge(s);expect(r.forecast.signalStrength).toBe('强');expect(r.forecast.p24).toBe(judge(snapshot({now:s.now})).forecast.p24);expect(r.forecast.confidence).toBe('低');
});
test('fulfilled banked promise has zero ongoing promise weight',()=>{
 const s=snapshot({events:[event(1),event(3),event(24),event(25,{global:false,banked:true,fulfilledPromiseId:'post-24'})],posts:[post(24,'Global reset landing tomorrow 10am PST for all paid accounts.',{at:'2026-09-24T12:00:00Z'}),post(25,'A banked reset has been added.',{id:'event-25'})]});
 const r=observe(s);expect(r.signals.promise.fulfilled).toBe(true);
});
test('new global consumes old signals',()=>{
 const s=snapshot({posts:[post(23,'Global reset landing tomorrow 10am PST for all paid accounts.'),post(24,'Reset all propagated.',{id:'event-24'})]});
 const r=judge(s);expect(r.signals.promise.fulfilled).toBe(true);expect(r.forecast.p24).toBeLessThan(90);
});
test('future records excluded, duplicate timestamps counted once',()=>{
 const e=normalize_events(snapshot({events:[event(1),event(3),event(24),event(24,{id:'duplicate'}),event(26)]}));expect(e).toHaveLength(3);
});
test('conditional intervals derive from globals only, not hardcoded lag samples',()=>{
 const rows=[event(1),event(2,{global:false,banked:true}),event(3),event(6)];
 expect(intervals(rows).map(x=>x.duration/day)).toEqual([2,3]);expect(banked_lags(rows)).toEqual([day]);
});
test('empty and invalid evidence fail rather than fabricate a report',()=>{
 expect(()=>judge(snapshot({events:[]}))).toThrow();expect(()=>validate_snapshot(snapshot({now:'invalid'}))).toThrow();
 expect(judge(snapshot({now:'2028-01-01T00:00:00Z'})).forecast.p24).toBeGreaterThan(0);
});
test('own report keeps evidence and model fields, percent constraints and UTC formatting',()=>{
 const r=judge(snapshot());const report=render_report(r);const fields=report.split('\n').filter(x=>x.startsWith('•')).map(x=>x.split('：')[0]);
 expect(fields).toEqual(['• 24h 内 global 重置概率','• 48h 内 global 重置概率（含 24h）','• 置信度','• Tibo 最新一条','• 上次 global','• 近期 global 间隔（天）','• 条件样本','• 最近一次 banked','• 事故','• 催化','• 24h','• 48h','• 信号判断','• 模型验证','• 关键数据点','• 变化趋势','• 下次跟进']);
 expect(report).toContain('UTC 09-24 00:00');expect(report).not.toContain('09-24T');expect(report).not.toContain('http');expect(r.forecast.p48).toBeGreaterThanOrEqual(r.forecast.p24);
});
test('completion detection rejects negation and banked',()=>{
 expect(completed_QMARK_('Reset all propagated. Enjoy.')).toBe(true);expect(completed_QMARK_("We have not reset accounts.")).toBe(false);expect(completed_QMARK_('We have reset banked cards.')).toBe(false);
});
test('archive parser verifies full history count and never executes embedded scripts',()=>{
 const article=(id,date,kind)=>`<article class="cr-event" id="${id}"><time datetime="${date}"></time><div class="cr-event-labels">${kind}</div><h3>Recorded</h3></article>`;
 const html=`<body>2 matching announcements${article('a',at(1),'Global reset')}${article('b',at(3),'Banked reset')}<script>throw new Error('never execute')</script></body>`;
 expect(parse_archive(html,at(25)).events).toHaveLength(2);expect(()=>parse_archive(html.replace('2 matching','3 matching'),at(25))).toThrow('不完整');
});
test('empty login pages never count as a fetched primary feed',()=>{
 expect(()=>parse_primary('<html>Log in</html>',at(25))).toThrow();
});
test('unrelated banked grant cannot consume an explicitly global promise',()=>{
 const r=observe(snapshot({events:[event(1),event(3),event(24),event(25,{global:false,banked:true})],posts:[post(24,'Global reset landing tomorrow 10am PST for all paid accounts.',{at:'2026-09-24T12:00:00Z'}),post(25,'A banked reset has been added.',{id:'event-25'})]}));
 expect(r.signals.promise.fulfilled).toBe(false);
});
test('accident compensation hint is not suppressed by a recent banked grant',()=>{
 const r=judge(snapshot({events:[event(1),event(3),event(6),event(24),event(25,{global:false,banked:true})],posts:[post(25,'A banked reset has been added.',{id:'event-25'}),post(25,'Apologies for the outage, we will reset usage for all paid accounts.',{id:'incident',at:'2026-09-25T00:00:01Z'})],now:'2026-09-25T01:00:00Z'}));
 expect(r.signals.compensation).not.toBeNull();expect(r.forecast.signal).toBe('事故补偿暗示');expect(r.forecast.p24).toBe(judge({...r.snapshot,posts:[]}).forecast.p24);
});
test('status remains usable with no global history or no probability denominator',async()=>{
 const {observe,reset_status}=await import('../dist/src/engine.mjs');
 expect(reset_status(observe(snapshot({events:[]}))).state).toBe('unknown');
 expect(reset_status(observe(snapshot({events:[event(24)]}))).latestGlobal.at).toBe(at(24));
});
test('external prediction values never affect our probability',()=>{
 const s=snapshot({sources:[{name:'prediction',body:'99%'}]});
 expect(judge(s).forecast.p24).toBe(judge(snapshot()).forecast.p24);
});
test('global+banked co-delivery is excluded from standalone banked lag samples',()=>{
 expect(banked_lags([event(1,{banked:true}),event(2,{global:false,banked:true}),event(3)])).toEqual([day]);
});
test('missed timed promise is not converted into a second compensation catalyst',()=>{
 const r=judge(snapshot({now:'2026-09-25T03:00:00Z',posts:[post(24,'Global reset landing today 10am PST for all paid accounts. Apologies for the outage.',{at:'2026-09-24T12:00:00Z'})]}));
 expect(r.forecast.signalStrength).toBe('弱');expect(r.signals.compensation).toBeNull();
});
