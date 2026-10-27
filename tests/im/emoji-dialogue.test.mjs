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
