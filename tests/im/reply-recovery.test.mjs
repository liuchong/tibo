import {test, expect} from 'bun:test';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';

test('quoted native expression reaches AI; a transient reply recovers with identical UUID and failures retain bounded diagnostics and output', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tibo-reply-recovery-'));
  const sends = [], prompts = [];
  const parent = {message_id: 'om_parent', chat_id: 'oc_room', msg_type: 'post', create_time: '1000',
    sender: {sender_type: 'app', id_type: 'app_id', id: 'fixture-app'},
    body: {content: JSON.stringify({content: [[{tag: 'text', text: '我擅长把问题讲清楚。'}], [{tag: 'emotion', emoji_type: 'THINKING'}]]})}};
  const current = {message_id: 'om_current', chat_id: 'oc_room', msg_type: 'text', create_time: '2000', root_id: 'om_parent', parent_id: 'om_parent',
    sender: {sender_type: 'user', id_type: 'open_id', id: 'ou_person'}, body: {content: JSON.stringify({text: '你连表情都只会复制？[抠鼻]'})}};
  const server = Bun.serve({hostname: '127.0.0.1', port: 0, async fetch(req) {
    const url = new URL(req.url), path = url.pathname;
    if (path.includes('tenant_access_token')) return Response.json({code: 0, tenant_access_token: 'private-token', expire: 7200});
    if (req.method === 'GET') return Response.json({code: 0, data: {items: path.endsWith('om_parent') ? [parent] : path.endsWith('om_current') ? [current] : [parent, current], has_more: false}});
    const body = await req.json();
    if (path === '/chat/completions') {
      prompts.push(body);
      return Response.json({choices: [{finish_reason: 'stop', message: {content: JSON.stringify({text: '上一条用了思考表情，表情应当服务我自己的回应。', emoji: null})}}]});
    }
    sends.push({path, body});
    if (path.endsWith('/om_reject/reply')) return Response.json({code: 230001, msg: 'private supplier error'}, {status: 400, headers: {'x-tt-logid': 'trace_rejected'}});
    if (path.endsWith('/om_unknown/reply') || sends.filter(s => s.path === path).length === 1) return new Response('private gateway error', {status: 503, headers: {'x-tt-logid': 'trace_gateway'}});
    return Response.json({code: 0, data: {message_id: 'om_delivered', chat_id: 'oc_room'}});
  }});
  try {
    const code = `
      const realFetch=globalThis.fetch;
      globalThis.fetch=(url,o)=>{const u=new URL(url);if(!['open.feishu.cn','api.deepseek.com'].includes(u.hostname))throw Error('unexpected host');return realFetch(${JSON.stringify(server.url.origin)}+u.pathname+u.search,o)};
      const {create_client}=await import(${JSON.stringify(resolve('dist/adapters/lark/api.mjs'))});
      const {deliver,delivery_key}=await import(${JSON.stringify(resolve('dist/adapters/lark/service.mjs'))});
      const {read_state}=await import(${JSON.stringify(resolve('dist/src/platform/state.mjs'))});
      const client=create_client('fixture-app','private-secret','feishu');
      const context={authenticated:true,transport:'lark',account:'fixture-account',scope:'oc_room',actor:'ou_person',conversationType:'p2p'};
      const query={command:'ask',args:{question:'你连表情都只会复制？[抠鼻]'}};
      await deliver(client,'oc_room','om_current','ask question',null,context,null,{group:'oc_room',context,key:'om_current',messageId:'om_current',reference:{parentId:'om_parent',rootId:'om_parent'},internalQuery:query});
      const records={sent:await read_state(delivery_key('oc_room','om_current'))};
      for(const id of ['om_reject','om_unknown']){
        try{await deliver(client,'oc_room',id,null,null,context,{text:'保留这段已经生成的正文'},{replyTarget:{messageId:id}});}catch{}
        records[id]=await read_state(delivery_key('oc_room',id));
      }
      console.log(JSON.stringify(records));
    `;
    const child = Bun.spawn([process.execPath, '--eval', code], {env: {...process.env, TIBO_CONFIG_FILE: join(dir, 'absent.env'),
      TIBO_STATE_DIR: dir, TIBO_LARK_APP_ID: 'fixture-app', TIBO_AI_FEATURES: 'answer', DEEPSEEK_API_KEY: 'private-ai-key'}, stdout: 'pipe', stderr: 'pipe'});
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(exit, stderr).toBe(0);
    const records = JSON.parse(stdout);
    expect(prompts, JSON.stringify(records)).toHaveLength(1);
    expect(JSON.parse(prompts[0].messages.at(-1).content).quotedMessage.content).toContain('[表情：思考]');
    expect(records.sent.state).toBe('sent'); expect(records.sent.chatCommitted).toBe(true);
    for (const [id, count] of [['om_current', 2], ['om_reject', 1], ['om_unknown', 3]]) {
      const attempts = sends.filter(s => s.path.endsWith('/' + id + '/reply'));
      expect(attempts).toHaveLength(count);
      expect(new Set(attempts.map(s => JSON.stringify(s.body))).size).toBe(1);
      expect(attempts[0].body.uuid).toHaveLength(40);
    }
    expect(records.om_reject).toMatchObject({state: 'rejected', larkCode: 230001,
      deliveryDiagnostic: {operation: 'reply', kind: 'http-rejected', httpStatus: 400, requestId: 'trace_rejected', attempts: 1}});
    expect(records.om_unknown).toMatchObject({state: 'uncertain', outgoing: {text: '保留这段已经生成的正文'},
      replyTarget: {messageId: 'om_unknown'}, deliveryDiagnostic: {httpStatus: 503, attempts: 3}});
    expect(JSON.stringify(records) + stderr).not.toMatch(/private supplier|private gateway|private-secret|private-token|private-ai-key/);
  } finally {server.stop(true); await rm(dir, {recursive: true, force: true});}
}, 10000);

test('message transport never retries without a valid UUID and keeps unparseable responses unconfirmed', async () => {
  let attempts = 0;
  const server = Bun.serve({hostname: '127.0.0.1', port: 0, fetch(req) {
    if (new URL(req.url).pathname.includes('tenant_access_token')) return Response.json({code: 0, tenant_access_token: 'fixture-token', expire: 7200});
    attempts++;
    return new Response('private upstream body', {status: attempts === 1 ? 503 : 200});
  }});
  try {
    const code = `
      const nativeFetch=globalThis.fetch;
      globalThis.fetch=(url,o)=>nativeFetch(${JSON.stringify(server.url.origin)}+new URL(url).pathname,o);
      const {create_client}=await import(${JSON.stringify(resolve('dist/adapters/lark/api.mjs'))});
      const client=create_client('fixture-app','fixture-secret','feishu'),results=[];
      for(const body of [{content:'one'},{uuid:'stable-uuid',content:'two'}]){
        try{await client.send(body);}catch(e){results.push({diagnostic:e.deliveryDiagnostic,rejected:!!e.definitiveRejection});}
      }
      console.log(JSON.stringify(results));
    `;
    const child = Bun.spawn([process.execPath, '--eval', code], {stdout: 'pipe', stderr: 'pipe'});
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(exit, stderr).toBe(0);
    expect(attempts).toBe(2);
    expect(JSON.parse(stdout)).toEqual([
      {diagnostic: {operation: 'send', httpStatus: 503, kind: 'response-unconfirmed', attempts: 1}, rejected: false},
      {diagnostic: {operation: 'send', httpStatus: 200, kind: 'response-unconfirmed', attempts: 1}, rejected: false}
    ]);
    expect(stdout + stderr).not.toContain('private upstream body');
  } finally {server.stop(true);}
});
