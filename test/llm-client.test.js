import test from 'node:test';
import assert from 'node:assert/strict';
import { LLMClient, normalizeContextTurns } from '../src/llm-client.js';

function sseResponse(chunks) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n\n`));
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  }), { status: 200 });
}

test('コンテキスト往復数を0〜100に正規化する', () => {
  assert.equal(normalizeContextTurns('-1'), 0);
  assert.equal(normalizeContextTurns('12'), 12);
  assert.equal(normalizeContextTurns('999'), 100);
  assert.equal(normalizeContextTurns('invalid'), 20);
});

test('保存済みの廃止モデルを移行して送信・再保存し、現行モデルの指定は維持する', async (t) => {
  let sentBody;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    sentBody = JSON.parse(options.body);
    return sseResponse(['返答']);
  });

  for (const [savedModel, expectedModel] of [
    ['gemini-3.1-flash-lite-preview', 'gemini-3.5-flash-lite'],
    ['gemini-3.8-flash', 'gemini-3.8-flash'],
  ]) {
    const client = new LLMClient();
    client.applySettings({
      llm_model: savedModel,
      llm_api_key: 'saved-key',
      llm_system_prompt: '保存済みの指示',
      llm_max_context_turns: '7',
    });
    for await (const _chunk of client.chat('質問')) {}

    assert.equal(sentBody.model, expectedModel);
    assert.match(sentBody.messages[0].content, /^保存済みの指示/);

    const saved = JSON.parse(JSON.stringify(client.getSettings()));
    assert.equal(saved.llm_model, expectedModel);
    assert.equal(saved.llm_api_key, 'saved-key');
    assert.equal(saved.llm_max_context_turns, '7');
    const reloaded = new LLMClient();
    reloaded.applySettings(saved);
    assert.deepEqual(reloaded.getSettings(), saved);
  }
});

test('指定した直近の往復だけを送信し、完了後に履歴を確定する', async (t) => {
  const client = new LLMClient();
  client.maxContextTurns = 1;
  client.history = [
    { role: 'user', content: '古い質問' },
    { role: 'assistant', content: '古い回答' },
    { role: 'user', content: '直近の質問' },
    { role: 'assistant', content: '直近の回答' },
  ];

  let sentBody;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    sentBody = JSON.parse(options.body);
    return sseResponse(['[EMO:happy]', '新しい回答']);
  });

  let response = '';
  for await (const chunk of client.chat('新しい質問')) response += chunk;

  assert.equal(response, '新しい回答');
  assert.equal(sentBody.model, 'gemini-3.5-flash-lite');
  assert.deepEqual(sentBody.messages.slice(1, -1), client.history.slice(2, 4));
  assert.deepEqual(client.history.slice(-2), [
    { role: 'user', content: '新しい質問' },
    { role: 'assistant', content: '新しい回答' },
  ]);
});

test('中断時はfetchをabortし、未完了の往復を履歴へ残さない', async (t) => {
  const client = new LLMClient();
  t.mock.method(globalThis, 'fetch', (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  }));

  const iterator = client.chat('中断する質問');
  const pending = iterator.next();
  client.abortActiveRequest();

  await assert.rejects(pending, { name: 'AbortError' });
  assert.deepEqual(client.history, []);
});
