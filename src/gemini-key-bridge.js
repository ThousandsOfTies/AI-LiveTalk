import { LocalStorage } from './local-storage.js';

const CHANNEL_NAME = 'ai-livetalk-gemini-key';

/** 開いているAI-LiveTalkから、同一オリジンの音声ラボへ共通キーを渡す。 */
export function provideGeminiApiKey(getKey, Channel = globalThis.BroadcastChannel) {
  if (!Channel) return () => {};
  const channel = new Channel(CHANNEL_NAME);
  channel.onmessage = ({ data }) => {
    if (data?.type !== 'key-request' || typeof data.requestId !== 'string') return;
    channel.postMessage({
      type: 'key-response',
      requestId: data.requestId,
      apiKey: getKey()?.trim() || '',
    });
  };
  return () => channel.close();
}

function requestOpenAppKey(Channel, timeoutMs) {
  if (!Channel) return Promise.resolve('');
  return new Promise(resolve => {
    const channel = new Channel(CHANNEL_NAME);
    const requestId = globalThis.crypto?.randomUUID?.() || String(Math.random());
    let finished = false;
    const finish = key => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      channel.close();
      resolve(key);
    };
    const timer = setTimeout(() => finish(''), timeoutMs);
    channel.onmessage = ({ data }) => {
      if (data?.type === 'key-response' && data.requestId === requestId) {
        finish(data.apiKey?.trim() || '');
      }
    };
    channel.postMessage({ type: 'key-request', requestId });
  });
}

/** アプリが開いていない場合も、端末に保存した設定から読み込める。 */
export async function resolveGeminiApiKey({ Channel = globalThis.BroadcastChannel, timeoutMs = 350 } = {}) {
  const openAppKey = await requestOpenAppKey(Channel, timeoutMs);
  if (openAppKey) return openAppKey;
  try {
    const storage = new LocalStorage();
    await storage.init();
    const settings = await storage.loadSettings();
    return settings?.llm_api_key?.trim() || '';
  } catch {
    return '';
  }
}
