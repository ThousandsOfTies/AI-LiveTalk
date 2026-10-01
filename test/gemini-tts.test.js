import test from 'node:test';
import assert from 'node:assert/strict';
import { designGeminiVoice, synthesizeGeminiSpeech, streamGeminiSpeech, GeminiTtsClient } from '../src/gemini-tts.js';
import { TTSPipeline } from '../src/tts-pipeline.js';

test('Voice designとTTSがGemini 3.8のREST形式を使う', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  const wav = Buffer.from([82, 73, 70, 70, 1, 2, 3, 4]).toString('base64');
  globalThis.fetch = async (url, options) => {
    requests.push({ url, ...options, body: JSON.parse(options.body) });
    const response = requests.length === 1
      ? { id: 'voice_test123', sample_audio: { data: wav } }
      : { steps: [{ type: 'model_output', content: [{ type: 'audio', data: wav }] }] };
    return new Response(JSON.stringify(response), { status: 200 });
  };
  try {
    const voice = await designGeminiVoice({
      apiKey: 'test-key',
      name: 'テスト声', description: '明るくかわいい日本語の声。',
    });
    assert.equal(voice.id, 'voice_test123');
    assert.equal(requests[0].url, 'https://generativelanguage.googleapis.com/v1beta/voices');
    assert.equal(requests[0].headers['x-goog-api-key'], 'test-key');
    assert.equal(requests[0].body.voice.model, undefined);
    assert.equal(requests[0].body.voice.language_code, 'ja-JP');
    assert.equal(requests[0].body.voice.region_code, 'JP');
    assert.equal(requests[0].body.voice.accent, 'Standard Japanese');
    assert.equal(requests[0].body.voice.prompted.input, '明るくかわいい日本語の声。');

    const audio = await synthesizeGeminiSpeech({
      apiKey: 'test-key', model: 'gemini-3.8-flash-lite-tts', voiceId: voice.id,
      text: 'こんにちは。', style: 'うれしそうに',
    });
    assert.deepEqual([...new Uint8Array(audio)], [82, 73, 70, 70, 1, 2, 3, 4]);
    assert.equal(requests[1].url, 'https://generativelanguage.googleapis.com/v1beta/interactions');
    assert.equal(requests[1].body.model, 'gemini-3.8-flash-lite-tts');
    assert.equal(requests[1].body.input[0].content[0].text, 'こんにちは。');
    assert.equal(requests[1].body.input[0].content[0].annotations[0].style, 'うれしそうに');
    assert.equal(requests[1].body.generation_config.speech_config[0].voice, voice.id);
    assert.equal(requests[1].body.generation_config.speech_config[0].language, 'ja-JP');
    assert.equal(requests[1].body.response_format.mime_type, 'audio/wav');
  } finally { globalThis.fetch = originalFetch; }
});

test('選択したGeminiクライアントをTTSパイプラインが使う', async () => {
  const texts = [];
  const client = new GeminiTtsClient();
  client.synthesize = async text => { texts.push(text); return new ArrayBuffer(1); };
  const speech = { getTtsClient: () => client, stopSpeaking() {} };
  const pipeline = new TTSPipeline(speech);
  pipeline._playBuffer = async () => {};
  pipeline.push('こんにちは。元気ですか？');
  await pipeline.done();
  assert.deepEqual(texts, ['こんにちは。', '元気ですか？']);
});

test('Gemini TTSは最初の句読点を待たず、読める長さの句から合成を始める', async () => {
  const texts = [];
  const client = new GeminiTtsClient();
  client.synthesize = async text => { texts.push(text); return new ArrayBuffer(1); };
  const speech = { getTtsClient: () => client, stopSpeaking() {} };
  const pipeline = new TTSPipeline(speech);
  pipeline._playBuffer = async () => {};

  pipeline.push('今日はお天気がいいから、');
  assert.deepEqual(texts, ['今日はお天気がいいから、']);
  pipeline.push('一緒に散歩しよう。');
  await pipeline.done();
  assert.deepEqual(texts, ['今日はお天気がいいから、', '一緒に散歩しよう。']);
});

test('二句目も文末を待たずに合成を始める', async () => {
  const texts = [];
  const client = new GeminiTtsClient();
  client.synthesize = async text => { texts.push(text); return new ArrayBuffer(1); };
  const speech = { getTtsClient: () => client, stopSpeaking() {} };
  const pipeline = new TTSPipeline(speech);
  pipeline._playBuffer = async () => {};
  pipeline.push('今日はお天気がいいから、');
  pipeline.push('次の予定を考えようかな、');
  assert.deepEqual(texts, ['今日はお天気がいいから、', '次の予定を考えようかな、']);
  pipeline.push('散歩にしよう。');
  await pipeline.done();
  assert.deepEqual(texts, ['今日はお天気がいいから、', '次の予定を考えようかな、', '散歩にしよう。']);
});

test('Gemini TTSの音声ストリームを届いた順に取り出す', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const frames = [
    { event_type: 'step.delta', delta: { type: 'audio', data: Buffer.from([1, 2]).toString('base64') } },
    { event_type: 'step.delta', delta: { type: 'audio', data: Buffer.from([3, 4]).toString('base64') } },
  ];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return new Response(new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        for (const frame of frames) controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
        controller.close();
      },
    }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  };
  try {
    const chunks = [];
    for await (const chunk of streamGeminiSpeech({
      apiKey: 'test-key', model: 'gemini-3.8-flash-lite-tts',
      voiceId: 'voice_test123', text: 'こんにちは。',
    })) chunks.push([...new Uint8Array(chunk)]);
    assert.deepEqual(chunks, [[1, 2], [3, 4]]);
    assert.equal(calls[0].body.stream, true);
    assert.equal(calls[0].body.response_format.mime_type, 'audio/l16');
    assert.equal(calls[0].body.generation_config.speech_config[0].language, 'ja-JP');
  } finally { globalThis.fetch = originalFetch; }
});

test('後続の発話もストリーミング音声を使う', async () => {
  const calls = [];
  const client = new GeminiTtsClient();
  client.synthesizeStream = text => {
    calls.push(`stream:${text}`);
    return (async function* () { yield new ArrayBuffer(2); })();
  };
  client.synthesize = async text => { calls.push(`wav:${text}`); return new ArrayBuffer(2); };
  const speech = {
    _streamAudioCtx: {},
    getTtsClient: () => client, stopSpeaking() {},
  };
  const pipeline = new TTSPipeline(speech);
  pipeline._playPcmStream = async stream => { for await (const chunk of stream) assert.equal(chunk.byteLength, 2); };
  pipeline._playBuffer = async () => {};
  pipeline.push('こんにちは。次はどうしよう？');
  await pipeline.done();
  assert.deepEqual(calls, ['stream:こんにちは。', 'stream:次はどうしよう？']);
});

test('PCMストリームを順番に再生し、最初の音で発話開始を知らせる', async () => {
  const starts = [];
  const context = {
    currentTime: 1,
    destination: {},
    resume: async () => {},
    createBuffer: (_channels, count, rate) => ({
      duration: count / rate,
      getChannelData: () => new Float32Array(count),
    }),
    createBufferSource: () => ({
      connect() {},
      start(time) { starts.push(time); queueMicrotask(() => this.onended?.()); },
      stop() { this.onended?.(); },
    }),
  };
  const speech = { _streamAudioCtx: context, getTtsClient: () => new GeminiTtsClient(), stopSpeaking() {} };
  const pipeline = new TTSPipeline(speech);
  let started = 0;
  pipeline.onSpeechStart = () => { started++; };
  const chunks = (async function* () {
    yield Uint8Array.from([0, 0, 255, 127]).buffer;
    yield Uint8Array.from([0, 128, 0, 0]).buffer;
  })();
  await pipeline._playPcmStream(chunks);
  assert.equal(started, 1);
  assert.equal(starts.length, 2);
  assert.ok(starts[1] > starts[0]);
});
