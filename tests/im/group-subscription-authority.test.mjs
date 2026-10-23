import {test,expect} from 'bun:test';
import {spawnSync} from 'node:child_process';import {mkdtemp,rm} from 'node:fs/promises';import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';
const mod=p=>JSON.stringify(resolve('dist/'+p+'.mjs'));
async function trial(code){const dir=await mkdtemp(join(tmpdir(),'tibo-group-authority-'));try{
 const setup=`const {account_key}=await import(${mod('adapters/lark/service')});const {command_context}=await import(${mod('adapters/lark/authority')});const {execute_query,fixed_query}=await import(${mod('src/commands/index')});const {active_recipients}=await import(${mod('src/subscriptions/registry')});const {read_state,write_state}=await import(${mod('src/platform/state')});const {is_admin}=await import(${mod('src/commands/admin')});const {visible_catalog}=await import(${mod('src/commands/catalog')});const ctx={transport:'lark',account:account_key(),scope:'oc_room',actor:'ou_owner',authenticated:true,conversationType:'group'};let role='owner',reads=0;const client={chatInfo:async id=>{reads++;if(role==='error')throw Error('private upstream detail');return{chat_mode:'group',owner_id_type:'open_id',owner_id:role==='owner'?ctx.actor:'ou_else',user_manager_id_list:role==='manager'?[ctx.actor]:[]}}};const execute=async(text,c=ctx)=>{const q=fixed_query(text);return execute_query(q,{context:await command_context(client,q,c)});};`;
 const r=spawnSync(process.execPath,['--eval',setup+code],{env:{...process.env,TIBO_CONFIG_FILE:join(dir,'absent.env'),TIBO_STATE_DIR:dir,TIBO_LARK_DOMAIN:'lark',TIBO_LARK_APP_ID:'fixture',TIBO_LARK_ADMIN_OPEN_IDS:'ou_system',TIBO_LARK_ADMIN_CHAT_IDS:'oc_operations',TIBO_AI_FEATURES:'',DEEPSEEK_API_KEY:''},encoding:'utf8',timeout:8000});expect(r.status,r.stderr).toBe(0);return JSON.parse(r.stdout);
 }finally{await rm(dir,{recursive:true,force:true});}}

for(const role of ['owner','manager'])test(`${role} can request and confirm only their current group without becoming a system administrator`,async()=>{
 const r=await trial(`role='${role}';const p=await execute('subscribe group'),id=p.text.match(/确认ID：([0-9a-f-]+)/)[1],before=await active_recipients('lark',ctx.account);const proof=await command_context(client,fixed_query('subscribe group'),ctx);const system=await execute_query(fixed_query('clear-history'),{context:proof}),cross=await execute_query(fixed_query('subscribe group oc_other'),{context:proof}),help=visible_catalog(proof).map(x=>x.name);const confirmed=await execute('confirm '+id),again=await execute('confirm '+id);console.log(JSON.stringify({p,before,system,cross,help,confirmed,again,reads,systemAdmin:is_admin(proof),after:await active_recipients('lark',ctx.account)}));`);
 expect(r.p.ok).toBe(true);expect(r.before).toEqual([]);expect(r.confirmed.ok).toBe(true);expect(r.again.ok).toBe(false);expect(r.after.map(x=>[x.kind,x.id])).toEqual([['group','oc_room']]);expect(r.system.ok).toBe(false);expect(r.cross.ok).toBe(false);expect(r.systemAdmin).toBe(false);expect(r.help).toContain('confirm');expect(r.help).not.toContain('clear-history');expect(r.reads).toBeGreaterThanOrEqual(3);
});

test('ordinary members, API failures and a revoked administrator cannot activate a group subscription',async()=>{
 const r=await trial(`const p=await execute('subscribe group'),id=p.text.match(/确认ID：([0-9a-f-]+)/)[1];role='member';const revoked=await execute('confirm '+id),member=await execute('subscribe group');role='error';const unavailable=await execute('subscribe group'),failedConfirm=await execute('confirm '+id);console.log(JSON.stringify({revoked,member,unavailable,failedConfirm,active:await active_recipients('lark',ctx.account),ticket:await read_state('confirm-'+id)}));`);
 expect(r.revoked.ok).toBe(false);expect(r.member.ok).toBe(false);expect(r.unavailable.text).toContain('未能核实');expect(r.failedConfirm.ok).toBe(false);expect(r.active).toEqual([]);expect(r.ticket.state).toBe('pending');expect(JSON.stringify(r)).not.toContain('private upstream detail');
});

test('group confirmation cannot cross actor, group, account, transport or expiry, nor confirm a system action',async()=>{
 const r=await trial(`const p=await execute('subscribe group'),id=p.text.match(/确认ID：([0-9a-f-]+)/)[1],denied=[];for(const c of [{...ctx,actor:'ou_else'},{...ctx,scope:'oc_other'},{...ctx,account:'another-app'},{...ctx,transport:'another-im'},{...ctx,conversationType:'p2p'}])denied.push(await execute('confirm '+id,c));await write_state('confirm-system',{state:'pending'});const t=await read_state('confirm-'+id);t.action='clear-history';await write_state('confirm-'+id,t);denied.push(await execute('confirm '+id));t.action='subscribe-group';t.expiresAt=Date.now()-1;await write_state('confirm-'+id,t);denied.push(await execute('confirm '+id));console.log(JSON.stringify({denied,active:await active_recipients('lark',ctx.account)}));`);
 expect(r.denied.every(x=>!x.ok)).toBe(true);expect(r.active).toEqual([]);
});

test('cancellation and unsubscribe use separate confirmations and account-level registry semantics',async()=>{
 const r=await trial(`let p=await execute('subscribe group'),id=p.text.match(/确认ID：([0-9a-f-]+)/)[1];const cancelled=await execute('cancel '+id),replay=await execute('confirm '+id);p=await execute('subscribe group');await execute('confirm '+p.text.match(/确认ID：([0-9a-f-]+)/)[1]);p=await execute('unsubscribe group');const before=await active_recipients('lark',ctx.account);await execute('confirm '+p.text.match(/确认ID：([0-9a-f-]+)/)[1]);console.log(JSON.stringify({cancelled,replay,before,after:await active_recipients('lark',ctx.account)}));`);
 expect(r.cancelled.ok).toBe(true);expect(r.replay.ok).toBe(false);expect(r.before).toHaveLength(1);expect(r.after).toEqual([]);
});

test('Tibo administrator can subscribe and manage current ordinary group even when not group owner, without unlocking global destructive commands in that group',async()=>{
 const r=await trial(`role='member';const botAdmin={...ctx,actor:'ou_system'};const p=await execute('subscribe group alerts',botAdmin),id=p.text.match(/确认ID：([0-9a-f-]+)/)[1];const proof=await command_context(client,fixed_query('subscribe group alerts'),botAdmin);const system=await execute_query(fixed_query('clear-history'),{context:proof});const cross=await execute_query(fixed_query('subscribe group oc_other'),{context:proof});const help=visible_catalog(proof).map(x=>x.name);const confirmed=await execute('confirm '+id,botAdmin);const status=await execute('subscription group',botAdmin);const afterAll=await active_recipients('lark',ctx.account);const afterDaily=await active_recipients('lark',ctx.account,'daily');const afterPromise=await active_recipients('lark',ctx.account,'promise');console.log(JSON.stringify({p,system,cross,help,confirmed,status,reads,systemAdmin:is_admin(proof),afterAll,afterDaily,afterPromise}));`);
 expect(r.p.ok).toBe(true);expect(r.confirmed.ok).toBe(true);expect(r.reads).toBe(0);
 expect(r.system.ok).toBe(false);expect(r.cross.ok).toBe(false);expect(r.systemAdmin).toBe(false);
 expect(r.help).toContain('confirm');expect(r.help).not.toContain('clear-history');
 expect(r.afterAll).toHaveLength(1);expect(r.afterAll[0].items).toEqual(['promise','probability','confirmed']);
 expect(r.afterDaily).toEqual([]);expect(r.afterPromise).toHaveLength(1);
 expect(r.status.text).toContain('仅重置预警');
});
