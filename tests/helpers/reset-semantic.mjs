import {snapshot} from './fixture.mjs';
export const post=(id,at,text,extra={})=>({id,at,text,author:'thsottiaux',provenance:'primary',truncated:false,url:`https://x.com/thsottiaux/status/${id}`,...extra});
export const plan=post('2106845241357824205','2026-10-04T20:33:00Z','Over the next 28 days, each day we’ll either ship one clear improvement or ship a full reset.');
export const title=post('2114200152701575656','2026-10-25T03:39:31.000Z','Day 20/ Rest and reset');
export const deadline=post('2114200291319124163','2026-10-25T03:40:04.049Z','By midnight PST',{parentId:title.id,parentRelationProvenance:'official-page-data'});
export const done=post('2114237083652882932','2026-10-25T06:06:16.025Z','It is all propagated. Enjoy some mad codexing tomorrow. Fun week ahead too.');
export const makeSnapshot=(extra={})=>snapshot({now:'2026-10-25T13:00:00Z',posts:[...snapshot().posts,plan,title,deadline,done],...extra});
export const claim=(p,kind='completion',extra={})=>({postId:p.id,kind,subject:'codex-usage',scope:'global',statement:kind==='completion'?'completed':'future',quote:p.text,objectText:"Codex usage limits",objectBasis:"context",timeText:null,timing:null,contextMissing:false,contextPostIds:[title.id,deadline.id].filter(id=>id!==p.id),...extra});
export function response(input,kind='completion') {return {dimensions:input.windows.map(w=>({name:w.name,support:0,opposition:0,commitment:0,imminence:0,citations:[]})),rows:[{postId:done.id,claims:[claim(done,kind)]}]};}
