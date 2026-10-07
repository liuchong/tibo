import {test,expect} from 'bun:test';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {completed_QMARK_ as completed,routine_reset_QMARK_ as routine_reset} from '../../dist/src/evidence/reset-text.mjs';
import {expanded_body} from '../../dist/src/evidence/post-body.mjs';
import {merge_posts,events_from_posts} from '../../dist/src/evidence/sources.mjs';
import {reset_cycle,cycle_text} from '../../dist/src/forecast/cycle.mjs';
import {saved_receipt,audit_rows,cases} from '../../dist/src/forecast/journal.mjs';
import {resolve_predictions} from '../../dist/src/forecast/experience.mjs';
import {judge} from '../../dist/src/app/engine.mjs';
import {active_programme} from '../../dist/src/evidence/post-context.mjs';
import {execute_query} from '../../dist/src/commands/index.mjs';
import {snapshot,post,event} from '../helpers/fixture.mjs';
const at='2026-10-07T03:35:09.157Z',now='2026-10-07T04:00:00Z',id='2107676072871600470';
const excerpt={id,at,text:'We shipped four things, but the vote is clear. Therefore ... the reset has been… https://t.co/example',author:'thsottiaux',provenance:'primary',truncated:true};
const full='We shipped four things, but the vote is clear. Therefore ... the reset has been processed. Enjoy!';
const body={tweet:{id,author:{screen_name:'thsottiaux'},text:full}};
test('processed completion is recognized; future, negated, conditional, banked and automatic weekly resets are excluded',()=>{
 expect(completed(full)).toBe(true);
 for(const t of ['The reset has not been processed.','The reset will be processed tomorrow.','If the reset has been processed, enjoy!','A banked reset has been processed.','My automatic weekly reset has been processed.','Your weekly usage has been reset automatically.'])expect(completed(t)).toBe(false);
 expect(completed('We have reset weekly limits for all paid accounts.')).toBe(true);
 expect(routine_reset('Your next automatic reset is in seven days.')).toBe(true);
});
test('long-note expansion verifies author, ID and official prefix; archive grade persists and truncated copies cannot erase it',()=>{
 const p=expanded_body(excerpt,body);expect(p).toMatchObject({text:full,provenance:'archive',truncated:false,expandedFromPrimary:true,primaryExcerpt:excerpt.text});
 expect(()=>expanded_body(excerpt,{tweet:{...body.tweet,id:'wrong'}})).toThrow();
 expect(()=>expanded_body(excerpt,{tweet:{...body.tweet,author:{screen_name:'wrong'}}})).toThrow();
 expect(()=>expanded_body(excerpt,{tweet:{...body.tweet,text:'Unrelated complete text that must never replace this verified excerpt.'}})).toThrow();
 expect(merge_posts([p],[excerpt])[0].text).toBe(full);
 expect(merge_posts([p],[{...excerpt,provenance:'archive'}])[0].text).toBe(full);
 expect(events_from_posts([p])[0]).toMatchObject({global:true,provenance:'archive',at});
});
test('optional expansion outage keeps original; full or unrelated short posts never need the extra fetch',async()=>{
 const code=`let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('unavailable')};const {expand_post}=await import(${JSON.stringify(resolve('dist/src/evidence/post-body.mjs'))});const a=await expand_post(${JSON.stringify(excerpt)}),b=await expand_post(${JSON.stringify({...excerpt,truncated:false})});console.log(JSON.stringify({a,b,calls}));`;
 const r=spawnSync(process.execPath,['--eval',code],{encoding:'utf8',timeout:5000});expect(r.status).toBe(0);const v=JSON.parse(r.stdout);expect(v.a).toEqual(excerpt);expect(v.b.truncated).toBe(false);expect(v.calls).toBe(1);
});
test('known completion restarts clock, retains precise time, consumes old hints and ignores routine events even when mislabeled global',()=>{
 const p=expanded_body(excerpt,body),s=snapshot({now,posts:[...snapshot().posts,p],events:[...snapshot().events,...events_from_posts([p])]});
 const r=judge(s);expect(r.signals.lastGlobal.at).toBe(at);expect(r.cycle).toMatchObject({justReset:true,announcementVerified:true,sevenDayReferenceAt:'2026-10-14T03:35:09.157Z',accountNextAutomaticAt:null,automaticWeeklyCountsAsGlobal:false});expect(r.forecast.policyVersion).toBe('5');expect(r.forecast.information.clockReliable).toBe(true);
 const automatic=post(25,'Your weekly usage has been reset automatically.',{id:'routine',at:'2026-10-07T03:45:00Z'});
 const other=judge({...s,posts:[...s.posts,automatic],events:[...s.events,{...event(25),id:'routine',at:automatic.at}]});
 expect(other.signals.lastGlobal.at).toBe(at);expect(other.forecast.p24).toBe(r.forecast.p24);expect(other.history.count).toBe(r.history.count);
 expect(cycle_text(r.cycle)).toContain('不算强行 global');
 const passed=reset_cycle(r.signals.lastGlobal,'2026-10-15T00:00:00Z');expect(passed.referenceRemainingDays).toBe(0);expect(passed.referencePassed).toBe(true);expect(passed.justReset).toBe(false);
 const stale=reset_cycle({...r.signals.lastGlobal,verified:false},now);expect(stale.justReset).toBe(false);expect(stale.sevenDayReferenceAt).toBeNull();
 expect(judge({...s,now:'2026-10-14T03:35:09.157Z'}).forecast.p48).toBeLessThan(100);
});
test('tomorrow for Day 3 is future context, not an observed third update day',()=>{
 const plan=post(24,'Over the next 28 days, each day we will either ship an improvement or ship a full reset.');
 const p=active_programme([plan,post(25,'Day 2.1/ Four updates.'),post(25,'You get both. See you tomorrow for Day 3!')],'2026-09-26T00:00:00Z');expect(p.observedDays).toEqual([2]);
});
test('only consistent actually saved receipts migrate; original 11/25 survive; one event gives one anecdote, not independent scores',()=>{
 const report={now:'2026-10-07T01:00:00.010Z',p24:11,p48:25},diagnostics={at:report.now,forecast:{p24:11,p48:25,signal:'条件性重置计划'}};
 const receipt=saved_receipt(report,{now:report.now},diagnostics);expect(receipt).toMatchObject({p24:11,p48:25,origin:'saved-report'});
 expect(saved_receipt(report,{now:'wrong'},diagnostics)).toBeNull();expect(saved_receipt(report,{now:report.now},{...diagnostics,forecast:{p24:12,p48:25}})).toBeNull();
 const e={id,at,global:true,verified:true,observed:false};
 const rows=audit_rows([receipt,{...receipt,at:'2026-10-07T02:00:00Z'}],[e],now,false);
 expect(rows[0].audit.h24).toMatchObject({outcome:1,eventId:id,brier:0.7921});expect(rows[0].audit.h48.brier).toBe(0.5625);expect(cases(rows)).toHaveLength(1);
 expect(resolve_predictions([{...receipt,outcome:null}],[e],now)[0].outcome).toBeNull();
 expect(audit_rows([receipt],[{...e,verified:false}],now,true)[0].audit.h24.outcome).toBeNull();
 expect(audit_rows([receipt],[],'2026-10-09T01:10:00.010Z',false)[0].audit.h48.outcome).toBeNull();
 expect(audit_rows([receipt],[],'2026-10-09T01:10:00.010Z',true)[0].audit.h48.outcome).toBe(0);
 expect(resolve_predictions([{...receipt,outcome:null}],[{...e,verified:false}],'2026-10-09T01:10:00.010Z')[0].outcome).toBeNull();
});
test('fixed status and explicit ask fallback have cycle evidence without AI or personal account access',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'tibo-cycle-')),file=join(dir,'snapshot.json');
 const p=expanded_body(excerpt,body);await writeFile(file,JSON.stringify(snapshot({now,posts:[...snapshot().posts,p],events:[...snapshot().events,...events_from_posts([p])]})));
 try{for(const q of [{command:'status',args:{}},{command:'ask',args:{question:'刚重置过吗？还剩几天7天自动刷新？'}}]){const r=await execute_query(q,{snapshotPath:file,noAi:true,persist:false});expect(r.ok).toBe(true);expect(r.text).toContain('03:35');expect(r.text).toContain('刚重置过');expect(r.text).toContain('仅为参考');expect(r.text).not.toContain('官方全文已核实');}}finally{await rm(dir,{recursive:true,force:true});}
});
test('journal is idempotent and separate from nonoverlapping learning',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'tibo-journal-'));
 const code=`const {write_state,read_state}=await import(${JSON.stringify(resolve('dist/src/platform/state.mjs'))});const {update_journal}=await import(${JSON.stringify(resolve('dist/src/forecast/journal.mjs'))});
 const report={now:'2026-10-07T01:00:00.010Z',p24:11,p48:25};await write_state('report-schedule',report);await write_state('evidence-schedule',{now:report.now});await write_state('diagnostics-schedule',{at:report.now,forecast:{p24:11,p48:25}});
 const result={snapshot:{now:'${now}'},events:[{id:'${id}',at:'${at}',global:true,verified:true}],forecast:{p24:9,p48:18,information:{historyFresh:true}}};await update_journal(result,'cli',true);await update_journal(result,'cli',true);console.log(JSON.stringify({journal:await read_state('forecast-journal'),experience:await read_state('experience')}));`;
 try{const r=spawnSync(process.execPath,['--eval',code],{env:{...process.env,TIBO_STATE_DIR:dir},encoding:'utf8',timeout:5000});expect(r.status).toBe(0);const value=JSON.parse(r.stdout);expect(value.journal.reports).toHaveLength(2);expect(value.journal.reports[0].p48).toBe(25);expect(value.experience).toBeNull();}finally{await rm(dir,{recursive:true,force:true});}
});
test('offline and supplied snapshot reports never write or settle actual forecast receipts',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'tibo-journal-offline-')),file=join(dir,'snapshot.json');await writeFile(file,JSON.stringify(snapshot()));
 const code=`const {write_state,read_state}=await import(${JSON.stringify(resolve('dist/src/platform/state.mjs'))});const {run_report}=await import(${JSON.stringify(resolve('dist/src/app/engine.mjs'))});const s=JSON.parse(await Bun.file(${JSON.stringify(file)}).text());await write_state('ledger',s);await write_state('forecast-journal',{reports:[{at:'2026-09-01T00:00:00Z',p24:11,p48:25,audit:{}}]});const before=await read_state('forecast-journal');await run_report({offline:true,noAi:true,persist:false});await run_report({snapshotPath:${JSON.stringify(file)},noAi:true,persist:false});console.log(JSON.stringify({before,after:await read_state('forecast-journal'),experience:await read_state('experience')}));`;
 try{const r=spawnSync(process.execPath,['--eval',code],{env:{...process.env,TIBO_CONFIG_FILE:'/dev/null',TIBO_STATE_DIR:dir,TIBO_AI_FEATURES:''},encoding:'utf8',timeout:5000});expect(r.status).toBe(0);const v=JSON.parse(r.stdout);expect(v.after).toEqual(v.before);expect(v.experience).toBeNull();}finally{await rm(dir,{recursive:true,force:true});}
});
