import test from 'node:test';
import assert from 'node:assert/strict';
import { provideGeminiApiKey, resolveGeminiApiKey } from '../src/gemini-key-bridge.js';

test('音声ラボは開いているAI-LiveTalkから共通APIキーを受け取る', async () => {
  class Channel {
    static instances = new Set();
    constructor(name) { this.name = name; Channel.instances.add(this); }
    postMessage(data) {
      for (const peer of Channel.instances) {
        if (peer !== this && peer.name === this.name) {
          queueMicrotask(() => peer.onmessage?.({ data }));
        }
      }
    }
    close() { Channel.instances.delete(this); }
  }
  let currentKey = 'first-key';
  const stop = provideGeminiApiKey(() => currentKey, Channel);
  try {
    assert.equal(await resolveGeminiApiKey({ Channel, timeoutMs: 20 }), 'first-key');
    currentKey = 'updated-key';
    assert.equal(await resolveGeminiApiKey({ Channel, timeoutMs: 20 }), 'updated-key');
  } finally { stop(); }
  assert.equal(Channel.instances.size, 0);
});
