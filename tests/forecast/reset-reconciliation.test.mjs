import{test,expect}from'bun:test';import{mkdir,mkdtemp,rm}from'node:fs/promises';import{resolve,join}from'node:path';
import{reconcile_reset_facts}from'../../dist/src/evidence/reconcile.mjs';import{read_state,write_state}from'../../dist/src/platform/state.mjs';
import{available_judgment}from'../../dist/src/app/engine.mjs';import{dimension_input}from'../../dist/src/evidence/dimensions.mjs';
import{makeSnapshot,done,title,claim}from'../helpers/reset-semantic.mjs';
const root=resolve('.tibo/tests/semantic');await mkdir(root,{recursive:true});
const batch=()=>({analysisState:'ready',revision:'test-evidence',claims:[{...claim(done),at:done.at,provenance:'primary',semanticValidated:true,semanticAgreed:true,votes:2}]});
test('T07/T08 semantic completion persists idempotently, resets the clock and consumes prior promises',async()=>{
 const directory=await mkdtemp(join(root,'ledger-'));try{
 const s=makeSnapshot();await write_state('ledger',s,directory);const before=available_judgment(s);
 const [a,b]=await Promise.all([reconcile_reset_facts(s,batch(),{directory,persist:true}),reconcile_reset_facts(s,batch(),{directory,persist:true})]);
 const ledger=await read_state('ledger',directory);expect(ledger.events.filter(e=>e.id===done.id)).toHaveLength(1);expect(ledger.pendingConfirmations.filter(e=>e.id===done.id)).toHaveLength(1);
 const after=available_judgment({...ledger,sources:[],unknowns:[]});expect(after.signals.lastGlobal).toMatchObject({id:done.id,at:done.at,verified:true});expect(after.signals.promise.fulfilled).toBe(true);
 expect(after.forecast.p24).toBeLessThan(before.forecast.p24);expect(dimension_input(after).windows[0].throughEpochMs).toBe(Date.parse(done.at));expect(ledger.posts).toHaveLength(s.posts.length);
 const stale=await reconcile_reset_facts(s,{...batch(),claims:[{...batch().claims[0],quote:'forged'}]},{directory,persist:true});expect(stale.changed).toBe(false);
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('T07 deadline expiry alone never changes confirmed history or invents delivery',()=>{
 const s=makeSnapshot();s.posts=s.posts.filter(p=>p.id!==done.id);const r=available_judgment(s);expect(r.events.some(e=>e.presumed)).toBe(false);expect(r.signals.lastGlobal.id).not.toBe(title.id);expect(r.forecast.p24).toBeNumber();
});
test('T09 durable confirmation inbox is drained once across restart and suppresses stale warnings',async()=>{
 const directory=await mkdtemp(join(root,'outbox-')),old=process.env.TIBO_STATE_DIR;process.env.TIBO_STATE_DIR=directory;
 try{await reconcile_reset_facts(makeSnapshot(),batch(),{persist:true});const{drain_confirmations,pending_alerts}=await import('../../dist/src/subscriptions/alerts.mjs');await drain_confirmations();await drain_confirmations();expect((await pending_alerts()).filter(a=>a.kind==='confirmed')).toHaveLength(1);expect((await read_state('ledger')).pendingConfirmations).toHaveLength(0);}finally{if(old===undefined)delete process.env.TIBO_STATE_DIR;else process.env.TIBO_STATE_DIR=old;await rm(directory,{recursive:true,force:true});}
});

test('semantic confirmation of a global event is not vetoed by an unrelated automatic-refresh phrase',async()=>{
 const s=makeSnapshot();s.posts=s.posts.map(p=>p.id===done.id?{...p,text:'This was not the automatic refresh. The promised quota has arrived for everyone.'}:p);
 const c={...batch().claims[0],quote:s.posts.find(p=>p.id===done.id).text};const r=await reconcile_reset_facts(s,{...batch(),claims:[c]});
 expect(available_judgment({...r.snapshot,sources:[],unknowns:[]}).signals.lastGlobal.id).toBe(done.id);
});
