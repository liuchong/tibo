import {test,expect} from 'bun:test';
import {spawnSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
const mod=name=>JSON.stringify(resolve('dist/src/'+name+'.mjs'));
async function trial(code,budget='980000',features='answer,read,router'){
 const dir=await mkdtemp(join(tmpdir(),'tibo-archives-'));
 try{
  const r=spawnSync(process.execPath,['--eval',code],{env:{...process.env,TIBO_CONFIG_FILE:join(dir,'absent.env'),
   TIBO_STATE_DIR:dir,TIBO_CHAT_CONTEXT_TOKENS:budget,TIBO_AI_FEATURES:features,DEEPSEEK_API_KEY:'archive-test-key',
   TIBO_LARK_APP_ID:'testapp',TIBO_LARK_DOMAIN:'lark',TIBO_LARK_CHAT_IDS:'all'},encoding:'utf8',timeout:20000,maxBuffer:2000000});
  expect(r.status,r.stderr).toBe(0);return JSON.parse(r.stdout);
 }finally{await rm(dir,{recursive:true,force:true});}
}
const ctx={transport:'plain-chat',account:'application',scope:'room',authenticated:true};

test('oversized single input uses at most three summaries, preserves the entire file and retrieves its tail in the one read batch',async()=>{
 const d=await trial(String.raw`const requests=[];globalThis.fetch=async(u,o)=>{const b=JSON.parse(o.body);requests.push(b);let v;
 if(b.max_tokens===2048)v={summary:'查尾部的最终标记，材料是一篇很长的公共文章。'};
 else if(b.max_tokens===600){const p=JSON.parse(b.messages.at(-1).content);v={topic:'查尾部',scope:{subject:'general',source:'current',quote:'查尾部'},queries:[{command:'context-read',args:{fileId:p.contextFiles[0].fileId,literal:'TAIL-CHECK42',limit:1000}}]};}
 else{const p=JSON.parse(b.messages.at(-1).content);v={text:p.builtinFacts.reads[0].text};}
 return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(v)}}]});};
 const {prepare_chat}=await import(${mod('chat/memory')});const {read_archive}=await import(${mod('chat/archive')});
 const {execute_query}=await import(${mod('commands/index')});const text='查尾部。'+'素材'.repeat(700000)+'TAIL-CHECK42:完整原文末尾';
 const p=await prepare_chat(text,null,null);const file=p.thread.contextFiles[0];const raw=await read_archive(p.thread.archiveOwner,p.thread.contextFiles,{command:'context-read',args:{fileId:file.fileId,literal:'TAIL-CHECK42',limit:1000}});
 const result=await execute_query({command:'ask',args:{question:text}},{chatPreparation:p});const {readdir}=await import('node:fs/promises');
 console.log(JSON.stringify({result,raw,length:text.length,file,summaries:requests.filter(b=>b.max_tokens===2048).length,
 sizes:requests.map(b=>new TextEncoder().encode(JSON.stringify(b.messages)).length),tools:requests.some(b=>b.tools),conversationFiles:(await readdir(process.env.TIBO_STATE_DIR)).filter(f=>f.startsWith('conversation-'))}));`);
 expect(d.length).toBeGreaterThan(1000000);expect(d.summaries).toBe(3);expect(d.file.characters).toBe(d.length);
 expect(d.result.ok).toBe(true);expect(d.result.text).toContain('TAIL-CHECK42');expect(d.raw.text).toContain('完整原文末尾');
 expect(d.sizes.every(n=>n<1000000)).toBe(true);expect(d.tools).toBe(false);expect(d.conversationFiles).toEqual([]);
},20000);

test('archive reads are scoped, survive restart and cannot select paths or another conversation owner',async()=>{
 const d=await trial(String.raw`const {archive_text,read_archive,validate_archive_query}=await import(${mod('chat/archive')});
 const {conversation_key,read_session,compact_session,import_turns}=await import(${mod('chat/store')});const c=${JSON.stringify(ctx)};const key=conversation_key(c,'topic');
 const original='first line\n'+'public detail '.repeat(5000)+'LAST-LINE';await import_turns(key,[{id:'source',role:'user',content:original}],1);await compact_session(key,1,'保留主题');
 const state=await read_session(key);const file=state.archives[0];const pages=[];let offset=0;do{const r=await read_archive(key,state.archives,{command:'context-read',args:{fileId:file.fileId,offset,limit:24000}});pages.push(r.text);offset=r.nextOffset;}while(offset!==null);
 let denied=0;for(const q of [{command:'context-read',args:{fileId:'../secrets'}},{command:'context-read',args:{fileId:file.fileId,path:'secrets'}},{command:'context-read',args:{fileId:'ctx-'+'0'.repeat(32)}}]){try{validate_archive_query(q,state.archives)}catch{denied++}}
 try{await read_archive(conversation_key({...c,scope:'elsewhere'},'topic'),state.archives,{command:'context-read',args:{fileId:file.fileId}})}catch{denied++}
 const restored=JSON.parse(pages.join(''));console.log(JSON.stringify({denied,exact:restored[0].content===original,parts:pages.length,file,state}));`);
 expect(d.denied).toBe(4);expect(d.exact).toBe(true);expect(d.parts).toBeGreaterThan(1);expect(d.state.turns).toEqual([]);
 expect(d.state.seen).toEqual(['source']);expect(d.file.fileId).toMatch(/^ctx-[a-f0-9]{32}$/);
});

test('summary validation failure retains full original, marks unknown coverage and continues with file-backed input',async()=>{
 const d=await trial(String.raw`let summaries=0,answers=0;globalThis.fetch=async(u,o)=>{const b=JSON.parse(o.body);if(b.max_tokens===2048){summaries++;return Response.json({choices:[{finish_reason:'stop',message:{content:'{}'}}]});}answers++;return Response.json({choices:[{finish_reason:'stop',message:{content:'{"text":"原文已保留，尚未完整摘要的部分需要按需查询。"}'}}]});};
 const {prepare_chat}=await import(${mod('chat/memory')});const {read_archive}=await import(${mod('chat/archive')});const {chat_text}=await import(${mod('presentation/chat')});
 const original='说明这些公共材料。'+'文本'.repeat(30000)+'EXACT-END';const p=await prepare_chat(original,null,null);const f=p.thread.contextFiles[0];
 const tail=await read_archive(p.thread.archiveOwner,p.thread.contextFiles,{command:'context-read',args:{fileId:f.fileId,literal:'EXACT-END'}});
 const r=await chat_text(p.question,'zh',{},null,p.thread);console.log(JSON.stringify({summaries,answers,state:r.state,question:p.question,tail,complete:f.characters===original.length}));`,'32768','answer');
 expect(d.summaries).toBe(1);expect(d.answers).toBe(1);expect(d.state).toBe('ok');expect(d.complete).toBe(true);
 expect(d.question).toContain('未完整摘要');expect(d.tail.text).toBe('EXACT-END');
});

test('long multiline Lark messages are accepted by the durable inbox and retain newlines through the full request',async()=>{
 const d=await trial(String.raw`const prompts=[];globalThis.fetch=async(u,o)=>{const b=JSON.parse(o.body);prompts.push(b);const v=b.max_tokens===280?{command:'ask',args:{},language:'en'}:b.max_tokens===600?{topic:'Explain the supplied article',queries:[]}:{text:'I read the final supplied paragraph.'};return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(v)}}]});};
 const {create_inbox}=await import(${JSON.stringify(resolve('dist/adapters/lark/inbox.mjs'))});const {account_key,message_candidate}=await import(${JSON.stringify(resolve('dist/adapters/lark/service.mjs'))});
 const text='Explain this public article.\n'+('A line of material.\n'.repeat(1200))+'FINAL-PARAGRAPH';
 const event={sender:{sender_type:'user',sender_id:{open_id:'ou_person'}},message:{chat_type:'p2p',chat_id:'oc_private',message_type:'text',content:JSON.stringify({text})}};
 const candidate=message_candidate(event,[],null);let sends=0;const inbox=await create_inbox({send:async()=>({code:0,data:{message_id:'om_answer'+(++sends)}})},[]);
 await inbox.accept({group:'oc_private',key:'om_source',messageId:'om_source',command:candidate.command,triggerKind:'direct',triggerLevel:1,
 context:{transport:'lark',account:account_key(),scope:'oc_private',actor:'ou_person',authenticated:true,conversationType:'p2p'}});
 const end=Date.now()+5000;while(inbox.status().pending){if(Date.now()>end)throw Error('queue timeout');await new Promise(r=>setTimeout(r,5))}await inbox.stop();
 console.log(JSON.stringify({sends,kind:candidate.kind,length:text.length,exact:candidate.command===text,questions:prompts.map(b=>JSON.parse(b.messages.at(-1).content).question===text),pending:inbox.status().pending}));`);
 expect(d.length).toBeGreaterThan(16000);expect(d.sends).toBe(1);expect(d.exact).toBe(true);expect(d.questions).toEqual([true,true,true]);expect(d.pending).toBe(0);
});

test('Unicode chunking keeps surrogate pairs and every character, including text beyond summary call limits',async()=>{
 const d=await trial(String.raw`const {chunk_messages}=await import(${mod('chat/packing')});const text='🙂漢字'.repeat(300000);const chunks=chunk_messages([{role:'user',content:text}]);const rows=chunks.flat();console.log(JSON.stringify({exact:rows.map(r=>r.content).join('')===text,wellFormed:rows.every(r=>r.content.isWellFormed()),chunks:chunks.length,max:Math.max(...chunks.map(c=>c.reduce((n,r)=>n+new TextEncoder().encode(r.content).length,0)))}));`);
 expect(d.exact).toBe(true);expect(d.wellFormed).toBe(true);expect(d.chunks).toBeGreaterThan(1);expect(d.max).toBeLessThan(980000);
});

test('a short followup can retrieve a huge direct quote from its prepared archive without malformed roles or a second plan',async()=>{
 const d=await trial(String.raw`let summaries=0,plans=0;globalThis.fetch=async(u,o)=>{const b=JSON.parse(o.body);const p=JSON.parse(b.messages.at(-1).content);let v;
 if(b.max_tokens===2048){summaries++;v={summary:'引用内容是一篇公开技术文章，精确末尾需查询原文。'};}
 else if(b.max_tokens===600){plans++;v={topic:'引用末尾',scope:{subject:'general',source:'quoted',quote:''},queries:[{command:'context-read',args:{fileId:p.contextFiles[0].fileId,literal:'QUOTE-END-49',limit:100}}]};}
 else v={text:p.builtinFacts.reads[0].text};return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(v)}}]});};
 const {execute_query}=await import(${mod('commands/index')});const r=await execute_query({command:'ask',args:{question:'请精确读出引用文章末尾标记。'}},{threadConversation:{state:'ready',messages:[],quotedMessage:{role:'assistant',content:'public text '.repeat(5000)+'QUOTE-END-49'}}});console.log(JSON.stringify({r,summaries,plans}));`,'32768');
 expect(d.r.ok).toBe(true);expect(d.r.text).toContain('QUOTE-END-49');expect(d.summaries).toBe(1);expect(d.plans).toBe(1);
});
