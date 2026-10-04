import test from 'node:test';
import assert from 'node:assert/strict';
import { LLMClient } from '../src/llm-client.js';
import { GeminiTtsClient } from '../src/gemini-tts.js';
import { TTSPipeline } from '../src/tts-pipeline.js';
import { initChatManager, sendMessage } from '../src/chatManager.js';
import { initUiUtils } from '../src/uiUtils.js';
import { updatePersonaData, resetToDefaults } from '../src/personaManager.js';

test('分割・改行を含むLLMのEMOを受け、全6感情の設定をTTSへ送る', async t => {
  const makeElement = () => ({
    value: '', style: {}, disabled: false, children: [],
    scrollHeight: 0, scrollTop: 0, clientHeight: 0,
    classList: { remove() {}, toggle() {} }, addEventListener() {}, focus() {},
    textNode: { textContent: '' }, querySelector() { return this.textNode; },
    appendChild(child) { this.children.push(child); },
  });
  const elements = new Map();
  const documentStub = {
    createElement: makeElement,
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, makeElement());
      return elements.get(id);
    },
  };
  for (const [key, value] of Object.entries({ document: documentStub, getComputedStyle: () => ({ maxHeight: '120' }) })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    });
  }
  // 自発モードの5分タイマーは、この手動会話テストでは起動しない。
  t.mock.method(globalThis, 'setTimeout', () => 0);
  t.mock.method(TTSPipeline.prototype, '_playPcmStream', async function(stream) {
    for await (const _chunk of stream) {}
  });
  resetToDefaults();
  t.after(resetToDefaults);
  const styles = {
    happy: '明るく弾んで', sad: 'しんみりと', angry: '不満げに',
    surprised: '驚いて', relaxed: '穏やかに', neutral: 'いつも通りに',
  };
  updatePersonaData('female', { geminiEmotionStyles: styles });
  const llm = new LLMClient();
  llm.apiKey = 'test-key';
  const tts = new GeminiTtsClient();
  Object.assign(tts, { apiKey: 'test-key', voiceId: 'Kore', style: '親しみやすく' });
  const speech = {
    sttSupported: true, _streamAudioCtx: {}, unlockAudio: async () => {},
    getTtsClient: () => tts, setSpeaking() {}, stopSpeaking() {},
  };
  const emotions = [];
  const viewer = {
    applyEmotion: emotion => emotions.push(emotion), loadVRMA: async () => {},
    startTalking() {}, stopTalking() {}, resetExpressions() {},
  };
  initUiUtils({
    chatMessages: documentStub.getElementById('chat-messages'), statusEl: documentStub.getElementById('status'),
    chatInput: documentStub.getElementById('chat-input'), sendBtn: documentStub.getElementById('send-btn'),
    micBtn: documentStub.getElementById('mic-btn'), driveSync: {}, getAiAvatarUrl: () => null, speech,
  });
  initChatManager({
    viewer, llm, speech, driveSync: {}, lipSync: { start() {}, stop() {} },
    scheduleHistorySave() {}, getVrmaEmotionMap: () => ({ neutral: 'idle' }), resolveVrmaUrl: path => path,
  });
  let emotion;
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url.endsWith('/chat/completions')) {
      const chunks = emotion
        ? ['\n', '[em', `o:${emotion.toUpperCase()}`, ']こんにちは。', 'またね。']
        : ['通常の返事です。'];
      const frames = chunks.map(content => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`);
      return new Response(frames.join('') + 'data: [DONE]\n\n', { status: 200 });
    }
    requests.push(JSON.parse(options.body));
    const event = { event_type: 'step.delta', delta: { type: 'audio', data: 'AAA=' } };
    return new Response(`data: ${JSON.stringify(event)}\n\n`, { status: 200 });
  });
  for (emotion of Object.keys(styles)) {
    const before = requests.length;
    await sendMessage('質問です');
    assert.deepEqual(requests.slice(before).map(body => ({
      text: body.input[0].content[0].text,
      style: body.input[0].content[0].annotations[0].style,
    })), [
      { text: 'こんにちは。', style: `親しみやすく\n${styles[emotion]}` },
      { text: 'またね。', style: `親しみやすく\n${styles[emotion]}` },
    ]);
    assert.equal(llm.history.at(-1).content.trim(), 'こんにちは。またね。');
  }
  assert.deepEqual(emotions, Object.keys(styles));
  // タグがない次の返答へ、直前の感情を持ち越さない。
  emotion = null;
  await sendMessage('次の質問');
  assert.equal(requests.at(-1).input[0].content[0].annotations[0].style, `親しみやすく\n${styles.neutral}`);
  assert.equal(requests.at(-1).input[0].content[0].text, '通常の返事です。');
});
