import {test, expect} from 'bun:test';
import {reply_emojis, supported_emoji_QMARK_} from '../../dist/adapters/lark/emojis.mjs';
import {markdown_post, send_report} from '../../dist/adapters/lark/messages.mjs';
import {selected_emoji, native_emoji_QMARK_, expression_text, expression_prose, prompt_emoji_choices} from '../../dist/src/ai/expression.mjs';
import {validate_oracle} from '../../dist/src/prayer/oracle.mjs';
import {body_text} from '../../dist/adapters/lark/thread.mjs';

test('quoted post expressions retain their actual native meanings alongside prose', () => {
  const message = nodes => ({msg_type: 'post', body: {content: JSON.stringify({en_us: {title: '原回复', content: [nodes]}})}});
  expect(body_text(message([{tag: 'md', text: '正文'}, {tag: 'emotion', emoji_type: 'THINKING'},
    {tag: 'emotion', emoji_type: 'FutureExpression'}]))).toBe('原回复\n正文\n[表情：思考]\n[表情：FutureExpression]');
  expect(body_text(message([{tag: 'emotion', emoji_type: '<invalid>'}, {tag: 'text', text: '保留正文'}]))).toBe('原回复\n\n保留正文');
});

test('native expression IDs require the supplied catalog; Unicode remains portable and original prose stays intact', () => {
  expect(new Set(reply_emojis.map(x => x.id)).size).toBe(reply_emojis.length);
  expect(reply_emojis.length).toBeLessThanOrEqual(32);
  for (const id of ['FullMoonFace', 'NOSEPICK', 'WINK']) {
    expect(selected_emoji(id, reply_emojis)).toBe(id);
    expect(selected_emoji(id, [])).toBeNull();
    expect(native_emoji_QMARK_(id, reply_emojis)).toBe(true);
  }
  expect(selected_emoji('[满月脸]', reply_emojis)).toBeNull();
  expect(selected_emoji('UNKNOWN', reply_emojis)).toBeNull();
  expect(selected_emoji('🌝', [])).toBe('🌝');
  expect(expression_text('原文 [满月脸]', 'NOSEPICK')).toBe('原文 [满月脸]');
  const body = {text: '我偏OpenAI，Claude这次又把回调绕远了。', emoji: 'NOSEPICK', citation: null};
  expect(validate_oracle(body, 'brand', [], reply_emojis).emoji).toBe('NOSEPICK');
  expect(validate_oracle(body, 'brand', []).emoji).toBeNull();
});

test('post keeps a complete Markdown paragraph and one optional native emotion paragraph', () => {
  const markdown = '**标题**\n正文 [链接](https://example.com) 与 `代码`。';
  for (const id of ['NOSEPICK', 'FullMoonFace']) {
    const rows = JSON.parse(markdown_post(markdown, id)).zh_cn.content;
    expect(rows).toEqual([[{tag: 'md', text: markdown}], [{tag: 'emotion', emoji_type: id}]]);
  }
  for (const id of [null, '', 'UNKNOWN', '[抠鼻]']) {
    expect(supported_emoji_QMARK_(id)).toBe(false);
    expect(JSON.parse(markdown_post(markdown, id)).zh_cn.content).toEqual([[{tag: 'md', text: markdown}]]);
  }
});

test('native placeholder encoding is removed from generated prose while literal quotes, links, code and unrelated brackets remain unchanged', () => {
  expect(expression_prose('这句话[满月脸]。再说一句[抠鼻]。', reply_emojis)).toBe('这句话。再说一句。');
  expect(expression_prose('这句话[满月脸]。', [])).toBe('这句话[满月脸]。');
  const literals = ['`[满月脸]`', '```text\n[抠鼻]\n```', '~~~text\n[满月脸]\n~~~',
    '> 引用 [满月脸]', '“原文[满月脸]”', '「[抠鼻]」', '"[满月脸]"',
    '[满月脸](https://example.com)', '[满月脸][source]', '[普通说明]'];
  for (const literal of literals) expect(expression_prose(literal, reply_emojis)).toBe(literal);
});

test('native normalization preserves every supported model choice without user-tone restrictions', () => {
  for (const id of reply_emojis.map(row => row.id)) {
    expect(selected_emoji(id, reply_emojis)).toBe(id);
  }
  expect(selected_emoji('😏', reply_emojis)).toBe('SMIRK');
  expect(selected_emoji('🙏🏽', reply_emojis)).toBe('THANKS');
  expect(selected_emoji('🤖', reply_emojis)).toBeNull();
  expect(selected_emoji('😏', [])).toBe('😏');
  expect(prompt_emoji_choices(reply_emojis).every(row => Object.keys(row).join(',') === 'id,label')).toBe(true);
});

test('native prose has no extra Unicode decoration or orphaned grapheme pieces, and literal material remains exact', () => {
  const prose = '你好😏 [坏笑] 今天继续👩🏽‍💻！🙏🏽🇨🇳1️⃣';
  expect(expression_prose(prose, reply_emojis)).toBe('你好  今天继续！');
  expect(expression_prose('👋 😄  你好', reply_emojis)).toBe('你好');
  expect(expression_prose(prose, [])).toBe(prose);
  for (const literal of ['`😏 [坏笑]`', '```text\n😏👩🏽‍💻[坏笑]\n```', '> 😏[坏笑]', '“😏[坏笑]”', '[😏](https://example.com)']) {
    expect(expression_prose(literal, reply_emojis)).toBe(literal);
  }
});

test('native topic decoration uses the existing reply and idempotency envelope without a separate send', async () => {
  const sent = [];
  const client = {reply: async (id, body) => {sent.push({id, body}); return {code: 0, data: {message_id: 'om_result'}};},
    send: async () => {throw Error('must remain in topic');}};
  expect(await send_report(client, 'oc_room', 'stable-key', '**回复**', null,
    {messageId: 'om_source', threadId: 'omt_topic'}, 'FullMoonFace')).toBe('om_result');
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({id: 'om_source', body: {uuid: 'stable-key', reply_in_thread: true, msg_type: 'post'}});
  expect(JSON.parse(sent[0].body.content).zh_cn.content[1]).toEqual([{tag: 'emotion', emoji_type: 'FullMoonFace'}]);
});
