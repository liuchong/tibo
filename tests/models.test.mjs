import {test,expect} from 'bun:test';
import {ensemble,candidates,replay,eligible} from '../dist/src/models.mjs';
import {resolve_predictions,accuracy} from '../dist/src/experience.mjs';
const day=86400000;
function intervals(gaps){let at=Date.parse('2025-01-01T00:00:00Z');return gaps.map(days=>{const start=new Date(at).toISOString();at+=days*day;return {start,end:new Date(at).toISOString(),duration:days*day,observed:false};});}
test('rate models are memoryless; empty survival sample shrinks to recent rate',()=>{
 const rows=intervals([2,3,4,5]);const now=rows.at(-1).end;
 const a=candidates(rows,0,now),b=candidates(rows,200*day,now);
 expect(a[0].p24).toBe(b[0].p24);expect(b[2].p24).toBeCloseTo(b[0].p24);
 for(const model of b){expect(model.p24).toBeGreaterThan(0);expect(model.p48).toBeGreaterThanOrEqual(model.p24);}
});
test('observed-only endpoints are excluded without inventing a bridging interval',()=>{
 const rows=intervals([2,3,4,5]);rows[1].observed=true;
 expect(eligible(rows).map(x=>x.duration/day)).toEqual([2,4,5]);
 expect(ensemble(rows,0,rows.at(-1).end).excludedIntervals).toBe(1);
});
test('walk-forward replay matches an independent prior-only reference',()=>{
 const rows=intervals([2,3,4,5,3,4,5,6,7,8,2,3,4,7,4,5]);const actual=replay(rows);let n=0;const score=[0,0,0,0];
 for(let i=8;i<rows.length;i++)for(let elapsed=0;elapsed<rows[i].duration;elapsed+=day){const at=Date.parse(rows[i].start)+elapsed;if(at+2*day>Date.parse(rows.at(-1).end))continue;
  const predictions=candidates(rows.slice(0,i),elapsed,new Date(at).toISOString());n++;
  predictions.forEach((p,j)=>score[j]+=(p.p24/100-Number(rows[i].duration<=elapsed+day))**2);
 }
 expect(actual.n).toBe(n);actual.scores.forEach((s,i)=>expect(s.brier24).toBeCloseTo(score[i]/n));
 const result=ensemble(rows,day,rows.at(-1).end);expect(result.adaptive).toBe(true);
 expect(result.candidates.reduce((n,x)=>n+x.weight,0)).toBeCloseTo(1);
 expect(result.candidates[actual.scores.findIndex(s=>s.brier24===Math.min(...actual.scores.map(x=>x.brier24)))].weight).toBeGreaterThan(0);
});
test('small replay uses equal weights and too little history refuses numeric invention',()=>{
 const rows=intervals([3,4,5]);const r=ensemble(rows,day,rows.at(-1).end);expect(r.adaptive).toBe(false);r.candidates.forEach(p=>expect(p.weight).toBeCloseTo(1/4));
 expect(()=>ensemble(rows.slice(0,2),0,rows.at(-1).end)).toThrow('至少');
});
test('prospective model experience changes weights only after 30 resolved windows',()=>{
 const rows=intervals([3,4,5]);const stats=n=>({resolved:n,models:[{name:'recent-rate',n,brier24:0.01,brier48:0.01},{name:'decayed-rate',n,brier24:0.4,brier48:0.4},{name:'conditional',n,brier24:0.2,brier48:0.2}]});
 const insufficient=ensemble(rows,0,rows.at(-1).end,stats(29));expect(insufficient.adaptive).toBe(false);insufficient.candidates.forEach(p=>expect(p.weight).toBeCloseTo(1/4));
 const learned=ensemble(rows,0,rows.at(-1).end,stats(30));expect(learned.adaptive).toBe(true);expect(learned.candidates[0].weight).toBeGreaterThan(learned.candidates[1].weight);expect(learned.prospectiveSamples).toBe(30);
});
test('prospective outcomes wait for strict windows plus ingestion grace, never backfill',()=>{
 const rows=[{at:'2026-09-01T00:00:00Z',p24:25,p48:50,outcome:null}];const events=[{at:'2026-09-03T00:00:00Z',global:true}];
 expect(resolve_predictions(rows,events,'2026-09-03T00:09:59Z')[0].outcome).toBeNull();
 const resolved=resolve_predictions(rows,events,'2026-09-03T00:10:00Z');expect(resolved[0].outcome).toMatchObject({y24:0,y48:1,basis:'observed-ledger'});
 expect(rows[0].outcome).toBeNull();expect(accuracy(resolved)).toMatchObject({resolved:1,brier24:0.0625,brier48:0.25,completeCoverage:false});
});
