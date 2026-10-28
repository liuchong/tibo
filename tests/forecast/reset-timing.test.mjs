import {test,expect} from 'bun:test';
import {local_row,validate_rows,feature_contract} from '../../dist/src/evidence/post-features.mjs';
import {feature_state,values_at} from '../../dist/src/forecast/features.mjs';
import {adjusted_risk} from '../../dist/src/forecast/feature-model.mjs';
import {timing_assessment} from '../../dist/src/forecast/reset-timing.mjs';
import {post_context} from '../../dist/src/evidence/post-context.mjs';
import {judge} from '../../dist/src/app/engine.mjs';
import {render_report} from '../../dist/src/presentation/report.mjs';
import {snapshot,post} from '../helpers/fixture.mjs';
import {target_time,target_precision} from '../../dist/src/forecast/signals.mjs';
const p=text=>post(25,text,{id:'2109812360596865224',at:'2026-09-25T01:00:00Z'});
function result(text){const s=snapshot({now:'2026-09-25T02:00:00Z',posts:[...snapshot().posts,p(text)]}),r=judge(s);r.structuredFeatures=feature_state(r,{rows:s.posts.map(local_row),aiRows:0,ruleRows:s.posts.length});return r;}
test('midnight promises use the end of the posting day in the stated Pacific zone',()=>{
 for(const [text,expected] of [
  ['Lands by midnight PST.','2026-10-28T08:00:00.000Z'],
  ['Lands by midnight PDT.','2026-10-28T07:00:00.000Z'],
  ['Lands by midnight PT.','2026-10-28T07:00:00.000Z'],
  ['Lands by tomorrow midnight PST.','2026-10-29T08:00:00.000Z']
 ]){
  expect(target_time({at:'2026-10-28T02:43:38.218Z',text})).toBe(expected);
  expect(target_precision(text)).toBe('deadline');
 }
});
test('expectation, intention, possibility and commitment are separate; a precise time does not erase uncertainty',()=>{
 for(const [text,stance] of [['Global reset should land within 6 hours.','expectation'],['I hope for a global reset tomorrow.','intention'],['Global reset might land soon.','possibility']]){
  const r=result(text),c=r.structuredFeatures.claims.at(-1);expect(c).toMatchObject({kind:'hint',timing:{stance},status:'active'});
  expect(r.signals.promise).toBeNull();expect(c.targetAt).toBeNull();
 }
 const uncertain=result('Global reset will probably land tomorrow 10am PST for all accounts.');
 expect(uncertain.signals.promise).toBeNull();expect(uncertain.structuredFeatures.claims.at(-1).timing.stance).toBe('expectation');
 expect(result('Global reset landing by EOD PST time.').signals.promise).toBeDefined();
});
test('numeric time windows align risk segments; vague dates and inferred quantities or zones stay unknown',()=>{
 const r=result('Global reset should land within 6 hours.'),c=r.structuredFeatures.claims.at(-1);
 expect(c.expectedWindow).toMatchObject({from:'2026-09-25T01:00:00Z',through:'2026-09-25T07:00:00.000Z',resolution:'relative-window'});
 expect(r.structuredFeatures.values.timingExpectation).toBe(1);
 expect(values_at(r.structuredFeatures,'2026-09-25T08:00:00Z').timingExpectation).toBe(0);
 const vague=result('I hope for a global reset tomorrow.');expect(vague.structuredFeatures.values.timingExpectation).toBeNull();
 const x=p('Global reset might land in a few hours.');const parsed=validate_rows({rows:[{postId:x.id,claims:[{kind:'hint',subject:'codex-usage',scope:'global',statement:'future',quote:x.text,timeText:'in a few hours',contextMissing:false,timing:{stance:'possibility',window:'within-hours',amount:3,zone:'PST'}}]}]},[x]);
 expect(parsed.rows[0].claims[0].timing).toMatchObject({amount:null,zone:'unknown'});
 expect(result('Global reset should land in 6 hours.').structuredFeatures.claims.at(-1).expectedWindow.through).toBe('2026-09-25T07:00:00.000Z');
 expect(result('I hope for a global reset tomorrow UTC.').structuredFeatures.claims.at(-1).expectedWindow).toMatchObject({from:'2026-09-26T00:00:00.000Z',through:'2026-09-27T00:00:00.000Z',resolution:'calendar-window'});
 const lands=post(25,'Lands tomorrow before 10am PST.',{id:'2113162413008884099',at:'2026-10-22T06:55:54.577Z',resetContextVerified:true,resetContextScope:'global',resetContextText:'Day 17/ Bet you thought we forgot, but no, it’s reset day today.'});
 expect(local_row(lands).claims[0]).toMatchObject({kind:'promise',scope:'global',timeText:'tomorrow before 10am PST',timing:{stance:'commitment',window:'tomorrow',zone:'PST'}});
});
test('a direct announcement stays a commitment even when cached AI describes it as an expectation',()=>{
 const x=p('Global reset landing by EOD PST time. Enjoy');
 const ai=validate_rows({rows:[{postId:x.id,claims:[{kind:'hint',subject:'codex-usage',scope:'global',statement:'future',quote:x.text,timeText:'by EOD PST time',contextMissing:false,timing:{stance:'expectation',window:'today',amount:null,zone:'PST'}}]}]},[x]);
 expect(ai.rows[0].claims[0]).toMatchObject({kind:'promise',timing:{stance:'commitment'}});
 const s=snapshot({now:'2026-09-25T02:00:00Z',posts:[...snapshot().posts,x]}),r=judge(s);
 r.structuredFeatures=feature_state(r,{rows:ai.rows,aiRows:1,ruleRows:0});
 expect(r.structuredFeatures.values.timingExpectation).toBeNull();
 const text=render_report(r);expect(text).toContain('预告重置');expect(text).not.toContain('表达重置时间预期');
});
test('semantic reference uses only a provided verified earlier parent, never quoted or unrelated text',()=>{
 const parent=post(25,'Global reset is coming.',{id:'parent'}),child=p('Could be before lunch.');child.parentId=parent.id;
 const selected=post_context([parent,child], '2026-09-25T02:00:00Z').posts.find(x=>x.id===child.id);
 const claim={kind:'hint',subject:'codex-usage',scope:'global',statement:'future',quote:child.text,timeText:'before lunch',contextMissing:false,timing:{stance:'possibility',window:'unspecified',amount:null,zone:'unknown'}};
 expect(validate_rows({rows:[{postId:child.id,claims:[claim]}]},[selected]).rows[0].claims[0]).toMatchObject({scope:'global',contextMissing:false});
 for(const bad of [{...child,parentText:parent.text},{...child,quoteText:parent.text},{...selected,parentAuthor:'other',parentText:'New model features.'}])
  expect(()=>validate_rows({rows:[{postId:child.id,claims:[claim]}]},[bad])).toThrow();
 expect(post_context([{...parent,at:'2026-09-25T03:00:00Z'},child], '2026-09-25T04:00:00Z').posts.find(x=>x.id===child.id).parentText).toBe('');
});
test('negation, conditional alternatives, consumed signals and expired windows do not become active timing boosts',()=>{
 const neg=result("I don't expect a global reset today.");expect(neg.signals.promise).toBeNull();
 expect(neg.structuredFeatures.claims.at(-1)).toMatchObject({kind:'negation',status:'negated'});
 expect(timing_assessment(neg.structuredFeatures,{}).available).toBe(false);
 const conditional=result('Either an improvement or a global reset tomorrow.');expect(conditional.structuredFeatures.values.timingExpectation).toBeNull();
 const past=result('Global reset should land within 6 hours.');past.snapshot.now='2026-09-25T08:00:00Z';
 const f=feature_state(past,{rows:past.snapshot.posts.map(local_row),aiRows:0,ruleRows:2});expect(f.claims.at(-1).status).toBe('expectation-passed');
});
test('timing expectations enter reports and observations without invented numerical adjustments',()=>{
 const r=result('Global reset should land within 6 hours.');r.forecast.timingAssessment=timing_assessment(r.structuredFeatures,{reason:'no-validated-model'});
 const text=render_report(r);expect(text).toContain('时间预期');expect(text).toContain('within 6 hours');expect(text).toContain('未作固定加分');
 const baseline=judge({...r.snapshot,posts:r.snapshot.posts.slice(0,-1)});expect(r.forecast.p24).toBe(baseline.forecast.p24);
 expect(adjusted_risk([0,2,4,6,8,10,12,14,16],r.structuredFeatures,null,r.snapshot.now)).toMatchObject({applied:false,p24:8,p48:16});
});
test('only validated timing coefficients can change risk, and only in the expected window',()=>{
 const r=result('Global reset should land within 6 hours.'),f=r.structuredFeatures;
 const model={id:'timing-fixture',contract:feature_contract,status:'validated',profile:'rules-1',sourceGrade:'primary',trainedThrough:'2026-08-01T00:00:00Z',coefficients:{timingExpectation:.5},
  support:{auditedCoverage:true,cycles:30,completePositiveAndNegativeWindows:true,features:{timingExpectation:{presentCycles:10,absentCycles:20}}},
  validation:{from:'2026-08-04T00:00:00Z',through:'2026-09-01T00:00:00Z',cycles:10,wholeCycleSplit:true,episodeDisjoint:true,stableAcrossTime:true,clusterUncertaintyPassed:true,h24:{brierImprovement:.02,logLossImprovement:.02},h48:{brierImprovement:.02,logLossImprovement:.02}}};
 const curve=[0,2,4,6,8,10,12,14,16],adjusted=adjusted_risk(curve,f,model,r.snapshot.now);
 expect(adjusted).toMatchObject({applied:true,timingUsed:true});expect(adjusted.p24).toBeGreaterThan(8);
 expect(adjusted_risk(curve,f,model,'2026-09-25T08:00:00Z')).toMatchObject({p24:8,p48:16});
 model.support.features.timingExpectation.presentCycles=9;expect(adjusted_risk(curve,f,model,r.snapshot.now).applied).toBe(false);
 expect(timing_assessment(f,adjusted).applied).toBe(true);
});
test('explicit longer-range context is retained until its lifetime but ends after a global completion',()=>{
 const old=p('We hope for a global reset within the next 5 days.');
 const selected=post_context([old], '2026-09-28T01:00:00Z');expect(selected.posts).toHaveLength(1);
 expect(selected.selection[0].reason).toBe('retained-timing-context');
 expect(post_context([old], '2026-10-01T01:00:00Z').posts).toHaveLength(0);
 expect(post_context([old], '2026-09-28T01:00:00Z',{id:'done',at:'2026-09-26T00:00:00Z'}).posts).toHaveLength(0);
});
