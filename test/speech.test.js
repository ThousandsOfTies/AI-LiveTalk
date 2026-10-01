import test from 'node:test';
import assert from 'node:assert/strict';
import { SpeechManager } from '../src/speech.js';

test('Gemini音声入力は共通APIキーで録音を文字起こしする', async () => {
  const originals = {
    navigator: globalThis.navigator,
    window: globalThis.window,
    MediaRecorder: globalThis.MediaRecorder,
    FileReader: globalThis.FileReader,
    fetch: globalThis.fetch,
  };
  let stopped = false;
  let request;
  class Recorder {
    static isTypeSupported(type) { return type === 'audio/webm;codecs=opus'; }
    constructor() { this.state = 'inactive'; }
    start() { this.state = 'recording'; }
    stop() {
      this.state = 'inactive';
      this.ondataavailable({ data: new Blob(['recorded audio']) });
      this.onstop();
    }
  }
  class Reader {
    readAsDataURL(blob) {
      blob.arrayBuffer().then(buffer => {
        this.result = 'data:audio/webm;base64,' + Buffer.from(buffer).toString('base64');
        this.onload();
      });
    }
  }
  try {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { mediaDevices: { getUserMedia: async () => ({
        getTracks: () => [{ stop() { stopped = true; } }],
      }) } },
    });
    globalThis.window = { MediaRecorder: Recorder };
    globalThis.MediaRecorder = Recorder;
    globalThis.FileReader = Reader;
    globalThis.fetch = async (url, options) => {
      request = { url, options };
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: 'こんにちは' }] } }] }) };
    };

    const speech = new SpeechManager();
    speech.updateGeminiSettings('shared-key', 'gemini-3.8-flash-lite-tts', 'voice_test');
    assert.equal(speech.getTtsClient().apiKey, 'shared-key');
    const transcript = new Promise(resolve => { speech.onTranscript = resolve; });
    await speech.startListening();
    assert.equal(speech.isListening, true);
    speech.stopListening();
    assert.equal(await transcript, 'こんにちは');
    assert.equal(stopped, true);
    assert.match(request.url, /gemini-3\.5-flash-lite:generateContent$/);
    assert.equal(request.options.headers['x-goog-api-key'], 'shared-key');
    assert.deepEqual(Object.keys(speech.getSettings()).sort(), ['gemini_tts_model', 'stt_model']);
  } finally {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: originals.navigator });
    globalThis.window = originals.window;
    globalThis.MediaRecorder = originals.MediaRecorder;
    globalThis.FileReader = originals.FileReader;
    globalThis.fetch = originals.fetch;
  }
});
