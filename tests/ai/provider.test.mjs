import {test, expect} from 'bun:test';
import {mkdtemp, rm} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';

async function trial(code) {
  const dir=await mkdtemp(join(tmpdir(),'tibo-provider-'));
  try {
    const env={...process.env,TIBO_CONFIG_FILE:join(dir,'absent.env'),TIBO_STATE_DIR:dir,TIBO_AI_FEATURES:'signals,answer',DEEPSEEK_API_KEY:'legacy-fixture'};
    for(const key of ['TIBO_AI_PROVIDER','TIBO_AI_MODEL','TIBO_AI_API_KEY'])delete env[key];
    const result=Bun.spawn([process.execPath,'--eval',code],{env,stdout:'pipe',stderr:'pipe'});
    const [exit,out,err]=await Promise.all([result.exited,new Response(result.stdout).text(),new Response(result.stderr).text()]);
    expect(exit,err).toBe(0);expect(err).toBe('');return JSON.parse(out);
  } finally {await rm(dir,{recursive:true,force:true});}
}
const runtime=JSON.stringify(resolve('dist/src/ai/runtime.mjs'));

test('provider switch selects the official transport and model, isolates auth circuits, and preserves the output contracts',async()=>{
  const r=await trial(`
    const requests=[];globalThis.fetch=async(url,o)=>{
      const b=JSON.parse(o.body);requests.push({url,model:b.model,temp:b.temperature,json:b.response_format?.type??null,tools:!!b.tools,keyMatches:o.headers.Authorization==='Bearer generic-fixture',client:o.headers['User-Agent']});
      if(requests.length===1)return new Response('private upstream error',{status:401});
      return Response.json({choices:[{finish_reason:'stop',message:{content:b.response_format?JSON.stringify({ok:true}):'正常聊天回复'}}]});
    };
    const {ai_call}=await import(${runtime});const p={instruction:'Return JSON {ok:true}',evidence:{question:'业务内容'}};
    const a=await ai_call('signals',p,v=>v),blocked=await ai_call('signals',p,v=>v);
    process.env.TIBO_AI_PROVIDER='kimi';process.env.TIBO_AI_MODEL='kimi-for-coding';process.env.TIBO_AI_API_KEY='generic-fixture';
    const b=await ai_call('signals',p,v=>v),cached=await ai_call('signals',p,v=>v);
    const chat=await ai_call('answer',{task:'chat-answer',instruction:'自然回复',evidence:{question:'你好'}},v=>v);
    process.env.TIBO_AI_MODEL='another-model';const changed=await ai_call('signals',p,v=>v);
    console.log(JSON.stringify({states:[a.state,blocked.state,b.state,cached.state,chat.state,changed.state],text:chat.value.text,requests}));
  `);
  expect(r.states).toEqual(['fallback','blocked','ok','cached','ok','ok']);
  expect(r.requests).toHaveLength(4);
  expect(r.requests[0]).toMatchObject({url:'https://api.deepseek.com/chat/completions',model:'deepseek-flash',temp:0,json:'json_object',tools:false});
  expect(r.requests[1]).toMatchObject({url:'https://api.kimi.com/coding/v1/chat/completions',model:'kimi-for-coding',temp:0.6,json:'json_object',tools:false,keyMatches:true,client:'tibo/0.1.0'});
  expect(r.requests[2].json).toBeNull();expect(r.text).toBe('正常聊天回复');
  expect(r.requests[3].model).toBe('another-model');
});

test('Kimi cannot reuse the old provider key; explicit empty keys and invalid configuration make no calls',async()=>{
  const r=await trial(`
    let calls=0;globalThis.fetch=async()=>{calls++;throw Error('must not send');};
    const {config,ai_call}=await import(${runtime});const p={instruction:'JSON',evidence:{}};
    process.env.TIBO_AI_PROVIDER='kimi';const a=await ai_call('signals',p,v=>v);
    process.env.TIBO_AI_PROVIDER='deepseek';process.env.TIBO_AI_API_KEY='';const b=await ai_call('signals',p,v=>v);
    process.env.TIBO_AI_API_KEY='generic-fixture';process.env.TIBO_AI_PROVIDER='unrecognized';const c=await ai_call('signals',p,v=>v);
    process.env.TIBO_AI_PROVIDER='kimi';process.env.TIBO_AI_MODEL='invalid model';const d=await ai_call('signals',p,v=>v);
    process.env.TIBO_AI_MODEL='kimi-for-coding';const valid=config().valid;
    console.log(JSON.stringify({states:[a.state,b.state,c.state,d.state],calls,valid}));
  `);
  expect(r.states).toEqual(['disabled','disabled','fallback','fallback']);expect(r.calls).toBe(0);expect(r.valid).toBe(true);
});

test('generic credentials and private model values are scrubbed while ordinary public provider discussions remain readable',async()=>{
  const r=await trial(`
    process.env.TIBO_AI_API_KEY='generic-fixture';process.env.TIBO_AI_MODEL='private-model';
    const {public_text}=await import(${JSON.stringify(resolve('dist/src/platform/privacy.mjs'))});
    const {parse_config}=await import(${JSON.stringify(resolve('dist/src/platform/config.mjs'))});
    const privateText=public_text('generic-fixture private-model kimi-for-coding sk-kimi-123456789abcdef');
    const config=parse_config('TIBO_AI_PROVIDER=kimi\\nTIBO_AI_MODEL=kimi-for-coding\\nTIBO_AI_API_KEY=fixture\\n');
    console.log(JSON.stringify({privateText,publicText:public_text('Kimi 和 ChatGPT 的公开发布有什么区别？'),keys:Object.keys(config)}));
  `);
  expect(r.privateText).not.toMatch(/generic-fixture|private-model|kimi-for-coding|sk-kimi/);
  expect(r.publicText).toContain('Kimi 和 ChatGPT');
  expect(r.keys).toEqual(['TIBO_AI_PROVIDER','TIBO_AI_MODEL','TIBO_AI_API_KEY']);
});
