import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_EMOTION_STYLES, combineSpeechStyle } from '../src/emotion-styles.js';
import {
  applySettings, collectSettings, getPersonaData, updatePersonaData, resetToDefaults,
} from '../src/personaManager.js';
import { GeminiTtsClient } from '../src/gemini-tts.js';
import { TTSPipeline } from '../src/tts-pipeline.js';

test('旧設定は感情の初期値を補い、キャラクター別の変更と空欄を保存・復元する', () => {
  resetToDefaults();
  applySettings({ sex: { female: { geminiStyle: 'かわいく' } } });
  assert.deepEqual(getPersonaData('female').geminiEmotionStyles, DEFAULT_EMOTION_STYLES);
  updatePersonaData('female', { geminiEmotionStyles: { happy: 'はしゃいで', sad: '' } });
  updatePersonaData('male', { geminiEmotionStyles: { happy: '静かに喜んで' } });
  const saved = collectSettings();
  resetToDefaults();
  applySettings(JSON.parse(JSON.stringify(saved)));
  assert.equal(getPersonaData('female').geminiEmotionStyles.happy, 'はしゃいで');
  assert.equal(getPersonaData('female').geminiEmotionStyles.sad, '');
  assert.equal(getPersonaData('female').geminiEmotionStyles.angry, DEFAULT_EMOTION_STYLES.angry);
  assert.equal(getPersonaData('male').geminiEmotionStyles.happy, '静かに喜んで');
  saved.sex.female.geminiEmotionStyles.happy = '別の値';
  assert.equal(getPersonaData('female').geminiEmotionStyles.happy, 'はしゃいで');
  resetToDefaults();
});

test('通常・空欄は基本の話し方を維持し、不明なタグは通常に戻す', () => {
  assert.equal(combineSpeechStyle('かわいく', 'neutral', DEFAULT_EMOTION_STYLES), 'かわいく');
  assert.equal(combineSpeechStyle('かわいく', 'sad', { sad: '' }), 'かわいく');
  assert.equal(combineSpeechStyle('', 'happy', DEFAULT_EMOTION_STYLES), DEFAULT_EMOTION_STYLES.happy);
  assert.equal(combineSpeechStyle('かわいく', 'unknown', DEFAULT_EMOTION_STYLES), 'かわいく');
});

for (const streaming of [false, true]) {
  test(`${streaming ? 'ストリーミング' : 'WAV'}合成に感情と基本の話し方を渡し、次の返答は通常から始まる`, async t => {
    const requests = [];
    t.mock.method(globalThis, 'fetch', async (_url, options) => {
      requests.push(JSON.parse(options.body));
      if (streaming) {
        const event = { event_type: 'step.delta', delta: { type: 'audio', data: 'AAA=' } };
        return new Response(`data: ${JSON.stringify(event)}\n\n`, { status: 200 });
      }
      return new Response(JSON.stringify({ output_audio: { data: 'AAA=' } }), { status: 200 });
    });
    const client = new GeminiTtsClient();
    Object.assign(client, { apiKey: 'test-key', voiceId: 'Kore', style: 'かわいく' });
    const styles = { ...DEFAULT_EMOTION_STYLES };
    const speech = { getTtsClient: () => client, stopSpeaking() {}, ...(streaming ? { _streamAudioCtx: {} } : {}) };
    const makePipeline = () => {
      const pipeline = new TTSPipeline(speech, { emotionStyles: styles });
      pipeline._playBuffer = async () => {};
      pipeline._playPcmStream = async stream => { for await (const _chunk of stream) {} };
      return pipeline;
    };
    const first = makePipeline();
    first.setEmotion('happy');
    first.push('やったね。');
    // 設定変更は生成中の返答の演技に混ざらない。
    styles.happy = '違う演技';
    client.style = '違う基本の話し方';
    first.push('うれしいね。');
    await first.done();
    const second = makePipeline();
    second.push('次の返事です。');
    await second.done();
    assert.deepEqual(requests.map(body => body.input[0].content[0].annotations[0].style), [
      `かわいく\n${DEFAULT_EMOTION_STYLES.happy}`,
      `かわいく\n${DEFAULT_EMOTION_STYLES.happy}`,
      '違う基本の話し方',
    ]);
    assert.equal(client.style, '違う基本の話し方');
  });
}
