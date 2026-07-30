import test from 'node:test';
import assert from 'node:assert/strict';
import { TTSPipeline } from '../src/tts-pipeline.js';

test('停止時に進行中の音声合成リクエストもabortする', async () => {
  let receivedSignal;
  const speech = {
    _useAivis: true,
    _useCloud: false,
    _aivis: {
      synthesize(_text, { signal }) {
        receivedSignal = signal;
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
        });
      },
    },
    stopSpeaking() {},
  };

  const pipeline = new TTSPipeline(speech);
  pipeline.push('停止対象です。');
  pipeline.stop();

  assert.equal(receivedSignal.aborted, true);
  await pipeline.done();
  await new Promise(resolve => setTimeout(resolve, 0));
});
