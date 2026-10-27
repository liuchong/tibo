import {test, expect} from 'bun:test';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';

test('generated prose keeps optional Unicode expressions through native HTTP sends and topic replies', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tibo-expression-'));
  const posts = [], prompts = [];
  const replies = ['我选ChatGPT来拆支付链路，Claude这次绕远了。', '我偏ChatGPT，Claude这回的回调比剧情还曲折 😏。', 'Webhook由服务端主动推送事件。🌝'];
  const server = Bun.serve({hostname: '127.0.0.1', port: 0, async fetch(req) {
    const path = new URL(req.url).pathname;
    if (path.includes('tenant_access_token')) return Response.json({code: 0, tenant_access_token: 'fixture-token', expire: 7200});
    if (path === '/chat/completions') {
      const body = await req.json(); prompts.push(body);
      const text = replies[prompts.length - 1];
      const content = body.response_format ? JSON.stringify({text: text.replace(' 😏。', '。'),
        emoji: prompts.length === 2 ? '😏' : null, citation: null, angle: text.slice(0, 8)}) : text;
      return Response.json({choices: [{finish_reason: 'stop', message: {content}}]});
    }
    posts.push({path, body: await req.json()});
    return Response.json({code: 0, data: {message_id: 'om_result' + posts.length, chat_id: 'oc_room', thread_id: 'omt_topic'}});
  }});
  try {
    const code = `
      const nativeFetch=globalThis.fetch;
      globalThis.fetch=(url,options)=>{const u=new URL(url);if(!['api.deepseek.com','open.feishu.cn'].includes(u.hostname))throw Error('unexpected host');return nativeFetch(${JSON.stringify(server.url.origin)}+u.pathname+u.search,options)};
      const {oracle_reply}=await import(${JSON.stringify(resolve('dist/src/prayer/oracle.mjs'))});
      const {chat_text}=await import(${JSON.stringify(resolve('dist/src/presentation/chat.mjs'))});
      const {write_state}=await import(${JSON.stringify(resolve('dist/src/platform/state.mjs'))});
      const {create_client}=await import(${JSON.stringify(resolve('dist/adapters/lark/api.mjs'))});
      const {send_report}=await import(${JSON.stringify(resolve('dist/adapters/lark/messages.mjs'))});
      await write_state('oracle-news',{until:Date.now()+60000,at:new Date().toISOString(),searchEnabled:false,documents:[]});
      const client=create_client('fixture-app','fixture-secret','feishu');
      const a=await oracle_reply('Claude又绕晕支付链路了[满月脸]','zh');
      await send_report(client,'oc_room','one',a.text);
      const b=await oracle_reply('Claude能理顺支付回调吗[抠鼻]','zh');
      await send_report(client,'oc_room','two',b.text,null,{messageId:'om_source',threadId:'omt_topic'});
      const c=await chat_text('解释Webhook[抠鼻]','zh',[]);
      await send_report(client,'oc_room','three',c.value.text);
    `;
    const child = Bun.spawn([process.execPath, '--eval', code], {env: {...process.env,
      TIBO_CONFIG_FILE: join(dir, 'absent.env'), TIBO_STATE_DIR: dir,
      DEEPSEEK_API_KEY: 'fixture-key', TIBO_AI_FEATURES: 'oracle,answer'}, stdout: 'pipe', stderr: 'pipe'});
    const [exit, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    expect(exit, stderr).toBe(0);
    const expected = [replies[0], '我偏ChatGPT，Claude这回的回调比剧情还曲折。 😏', replies[2]];
    expect(posts.map(p => JSON.parse(p.body.content).zh_cn.content[0][0])).toEqual(expected.map(text => ({tag: 'md', text})));
    expect(posts[1].path).toEndWith('/om_source/reply');
    expect(posts[1].body.reply_in_thread).toBe(true);
    expect(prompts).toHaveLength(3);
    expect(prompts.every(p => p.messages[0].content.includes('表情只是可选的语气点缀'))).toBe(true);
    expect(JSON.stringify(posts)).not.toMatch(/\[满月脸\]|\[抠鼻\]/);
  } finally {
    server.stop(true);
    await rm(dir, {recursive: true, force: true});
  }
}, 10000);

test('adapter catalog reaches both AI reply paths and native emotions survive delivery while rewritten pipelines discard old decoration', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tibo-native-expression-'));
  const posts = [], prompts = [];
  const answers = [
    {text: '我偏OpenAI，Claude这次又把回调绕远了[满月脸]。', emoji: 'NOSEPICK', citation: null},
    {text: '这个笑话确实挺冷[抠鼻]。', emoji: 'FullMoonFace'},
    {text: '这是纯文字回复[满月脸]。', emoji: null},
    {text: '正文仍然可用。', emoji: 'NOT_IN_CATALOG'},
    {text: '你好😏[坏笑]！', emoji: 'SMIRK'},
    {text: '你好😉！', emoji: '😉'},
    {text: '收到😏。', emoji: 'SMIRK'},
    {text: '这句话要翻译。', emoji: 'WINK'},
    {text: 'This sentence needs translation.'}
  ];
  const server = Bun.serve({hostname: '127.0.0.1', port: 0, async fetch(req) {
    const path = new URL(req.url).pathname;
    if (path.includes('tenant_access_token')) return Response.json({code: 0, tenant_access_token: 'fixture-token', expire: 7200});
    if (path === '/chat/completions') {
      prompts.push(await req.json());
      return Response.json({choices: [{finish_reason: 'stop', message: {content: JSON.stringify(answers[prompts.length - 1])}}]});
    }
    posts.push(await req.json());
    return Response.json({code: 0, data: {message_id: 'om_native' + posts.length, chat_id: 'oc_room'}});
  }});
  try {
    const code = `
      const nativeFetch=globalThis.fetch;
      globalThis.fetch=(url,options)=>{const u=new URL(url);if(!['api.deepseek.com','open.feishu.cn'].includes(u.hostname))throw Error('unexpected host');return nativeFetch(${JSON.stringify(server.url.origin)}+u.pathname+u.search,options)};
      const {deliver}=await import(${JSON.stringify(resolve('dist/adapters/lark/service.mjs'))});
      const {create_client}=await import(${JSON.stringify(resolve('dist/adapters/lark/api.mjs'))});
      const {write_state}=await import(${JSON.stringify(resolve('dist/src/platform/state.mjs'))});
      await write_state('oracle-news',{until:Date.now()+60000,at:new Date().toISOString(),searchEnabled:false,documents:[]});
      const client=create_client('fixture-app','fixture-secret','feishu');
      const questions=['Claude又绕远了[满月脸]','讲个小笑话[抠鼻]','只用文字解释一下','继续聊聊回调','你好啊？[坏笑]','今天继续聊聊吧[坏笑]','请发一个[坏笑]表情','翻译这句话'];
      for(let i=0;i<questions.length;i++)await deliver(client,'oc_room','om_input'+i,'ask '+JSON.stringify(questions[i]),null,null,null,
        {internalQuery:{command:'ask',args:{question:questions[i]},...(i===7?{pipeline:[{name:'translate',language:'en'}]}:{})}});
    `;
    const child = Bun.spawn([process.execPath, '--eval', code], {env: {...process.env,
      TIBO_CONFIG_FILE: join(dir, 'absent.env'), TIBO_STATE_DIR: dir,
      DEEPSEEK_API_KEY: 'fixture-key', TIBO_AI_FEATURES: 'oracle,answer,translate'}, stdout: 'pipe', stderr: 'pipe'});
    const [exit, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    expect(exit, stderr).toBe(0);
    expect(posts).toHaveLength(8); expect(prompts).toHaveLength(9);
    const contents = posts.map(p => JSON.parse(p.content).zh_cn.content);
    expect(contents[0][1]).toEqual([{tag: 'emotion', emoji_type: 'NOSEPICK'}]);
    expect(contents[1][1]).toEqual([{tag: 'emotion', emoji_type: 'FullMoonFace'}]);
    expect([2,3,7].every(i => contents[i].length === 1 && contents[i][0][0].tag === 'md')).toBe(true);
    expect(contents[4][0][0].text).toBe('**AI回答**\n你好！');
    expect(contents[4][1]).toEqual([{tag: 'emotion', emoji_type: 'SMIRK'}]);
    expect(contents[5][1]).toEqual([{tag: 'emotion', emoji_type: 'WINK'}]);
    expect(contents[6][1]).toEqual([{tag: 'emotion', emoji_type: 'SMIRK'}]);
    expect(contents[7][0][0].text).toBe('This sentence needs translation.');
    expect(JSON.stringify(contents)).not.toMatch(/\[抠鼻\]|\[满月脸\]|\[坏笑\]|NOT_IN_CATALOG|😏|😉/);
    expect(prompts.slice(0, 8).every(p => p.response_format.type === 'json_object')).toBe(true);
    expect(prompts.slice(0, 8).every(p => JSON.parse(p.messages.at(-1).content).replyEmojis.some(x => x.id === 'FullMoonFace'))).toBe(true);
    expect(prompts.slice(0, 8).every(p => JSON.parse(p.messages.at(-1).content).replyEmojis.every(x => Object.keys(x).length === 2))).toBe(true);
  } finally {
    server.stop(true);
    await rm(dir, {recursive: true, force: true});
  }
}, 10000);
