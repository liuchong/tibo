import {test,expect} from 'bun:test';
import {judge,available_judgment} from '../../dist/src/app/engine.mjs';
import {render_report} from '../../dist/src/presentation/report.mjs';
import {public_forecast} from '../../dist/src/presentation/business.mjs';
import {report_evidence} from '../../dist/src/presentation/forecast-evidence.mjs';
import {snapshot,post,event} from '../helpers/fixture.mjs';
const globalId='2107676072871600470',planId='2106845241357824205';
function input(){return snapshot({now:'2026-10-07T13:07:12Z',events:[...snapshot().events,event(24,{id:globalId,at:'2026-10-07T03:35:09Z'})],posts:[
 post(24,'Reset all propagated. Enjoy.',{id:globalId,at:'2026-10-07T03:35:09Z',provenance:'archive'}),
 post(24,'Over the next 28 days, each day we’ll either ship one thing that is a clear improvement or ship a full reset.',{id:planId,at:'2026-10-04T20:33:43Z'}),
 post(24,'Also! Good evening!!',{id:'2107676653895967106',at:'2026-10-07T03:37:27Z'})]});}
function docs(result,documents){result.ai={documents,features:{brief:{state:'ok',value:{summary:'Not a forecast fact'}},forecast:{state:'blocked',reason:'private-failure'}}};return result;}
const incident={id:'incident-real',type:'incident',at:'2026-10-07T12:00:00Z',text:'Codex service error rates are elevated. We are investigating.',url:'https://status.openai.com/incidents/real',status:'investigating',provenance:'official-status'};
test('actual-clock concise output is identical across native and business rendering, including fixed-slot title override',()=>{
 const r=judge(input()),text=render_report(r);expect(public_forecast(r,'both')).toBe(text);
 expect(text).toContain('北京时间 10-07 21:07');expect(text).toContain('距今 9.5 小时');expect(text).toContain('本次重置已处理');expect(text).not.toContain('Good evening');
 expect(text.split('**参考消息**')[1].split('**判断理由**')[0].match(/^• /gm)).toHaveLength(2);
 expect(text.split('**判断理由**')[1].match(/^• /gm)).toHaveLength(2);
 expect(public_forecast(r,'both','2026-10-07T13:00:00Z')).toContain('北京时间 10-07 21:00');
 expect(public_forecast(r,'48')).not.toContain('• 24h：');expect(public_forecast(r,'24')).not.toContain('• 48h：');
});
test('supporting evidence must have recent dated original material; duplicates, snippets, unknown people, irrelevant and consumed incidents are omitted',()=>{
 const r=docs(judge(input()),[incident,incident,
 {...incident,id:'stale',at:'2026-10-06T01:00:00Z',url:'https://status.openai.com/incidents/stale',status:'resolved'},
 {...incident,id:'future',at:'2026-10-08T01:00:00Z',url:'https://status.openai.com/incidents/future'},
 {...incident,id:'undated',at:null,url:'https://status.openai.com/incidents/undated'},
 {...incident,id:'snippet',provenance:'search-snippet',url:'https://status.openai.com/incidents/snippet'},
 {...incident,id:'unrelated',text:'ChatGPT service is recovering.',url:'https://status.openai.com/incidents/unrelated'},
 {id:'unknown',type:'post',at:incident.at,author:'random',text:'Codex reset all accounts!',url:'https://x.com/random/status/2107676653895967106',provenance:'official-post'},
 {id:'static-doc',type:'page',at:null,text:'Codex usage limits reset weekly.',url:'https://help.openai.com/en/articles/123',provenance:'official-page'}]);
 const rows=report_evidence(r);expect(rows.map(x=>x.author)).toEqual(['Tibo','Tibo','OpenAI']);expect(rows.at(-1).url).toBe(incident.url);
 const text=render_report(r);expect(text).not.toMatch(/AI任务|Not a forecast fact|private-failure|stale|future|undated|snippet|static-doc|random/);expect(text).toContain('事故仍在处理中');
});
test('authenticated official account originals can supplement Tibo; unrelated personal observations cannot',()=>{
 const r=docs(judge(input()),[{id:'public-post-2107676653895967106',type:'post',at:'2026-10-07T12:00:00Z',author:'openaidevs',text:'Codex usage rate limits will change for eligible accounts.',url:'https://x.com/openaidevs/status/2107676653895967106',provenance:'official-post'}]);
 expect(render_report(r)).toContain('@openaidevs');expect(report_evidence(r).length).toBeLessThanOrEqual(4);
});
test('history insufficiency and unknown clock retain all sections without invented numbers or operational status',()=>{
 const r=available_judgment(snapshot({events:[],posts:[]})),text=render_report(r);
 expect(text).toContain('• 24h：暂无法估计');expect(text).toContain('• 48h：暂无法估计（含24h）');expect(text).toContain('上次重置：未核实');expect(text).toContain('未见可用的相关原始消息');expect(text).not.toMatch(/\d+%|AI任务|采集|7天/);
});
test('banked timed promises and expired global promises cannot read like a fresh global commitment',()=>{
 const s=input();s.posts.push(post(24,'A banked reset card landing tomorrow 10am PST for all paid accounts.',{id:'2107676653895967107',at:'2026-10-07T12:00:00Z'}));
 expect(render_report(judge(s))).toContain('手动额度卡');expect(render_report(judge(s))).not.toContain('已有带时间的重置预告');
 s.posts.at(-1).text='Global reset landing today 1am PST for all paid accounts.';
 expect(render_report(judge(s))).toContain('预告时间已过');
});
test('only a used bounded AI reason with selected validated citations can enter the fixed reasons; arbitrary brief remains hidden',()=>{
 const r=judge(input());r.forecast.mode='ai-blend';r.ai={weight:.2,features:{forecast:{value:{reason:'计划仍留有重置机会，但没有新的具体日期承诺。',citations:[{postId:planId}]}},brief:{value:{summary:'EXTRA_BLOCK'}}}};
 expect(render_report(r)).toContain(r.ai.features.forecast.value.reason);expect(render_report(r)).not.toContain('EXTRA_BLOCK');
 r.ai.features.forecast.value.citations=[{postId:'invented'}];expect(render_report(r)).not.toContain(r.ai.features.forecast.value.reason);
});
