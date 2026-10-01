const API_ROOT = 'https://generativelanguage.googleapis.com/v1beta';
export const GEMINI_TTS_MODELS = ['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts'];

function decodeAudio(data) {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function apiRequest(path, apiKey, body, signal) {
  if (!apiKey?.trim()) throw new Error('Gemini APIキーを入力してください。');
  const response = await fetch(`${API_ROOT}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey.trim() },
    body: JSON.stringify(body),
    signal,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = result.error?.message || response.statusText;
    throw new Error(`Gemini API (${response.status}): ${detail}`);
  }
  return result;
}

export async function designGeminiVoice({ apiKey, name, description, signal }) {
  if (!name?.trim() || !description?.trim()) throw new Error('声の名前と説明を入力してください。');
  const result = await apiRequest('/voices', apiKey, {
    store: true,
    voice: {
      type: 'prompted',
      display_name: name.trim(),
      gender: 'female',
      language_code: 'ja-JP',
      region_code: 'JP',
      accent: 'Standard Japanese',
      prompted: { input: description.trim() },
    },
  }, signal);
  if (!result.id?.startsWith('voice_')) throw new Error('Voice IDを取得できませんでした。');
  return {
    id: result.id,
    name: name.trim(),
    description: description.trim(),
  };
}

export async function synthesizeGeminiSpeech({ apiKey, model, voiceId, text, style = '', signal }) {
  const body = speechRequestBody({ model, voiceId, text, style });
  const result = await apiRequest('/interactions', apiKey, body, signal);
  const audio = result.steps?.flatMap(step => step.content || []).find(item => item.type === 'audio' && item.data)
    || result.output_audio;
  if (!audio?.data) throw new Error('音声データを取得できませんでした。');
  return decodeAudio(audio.data);
}

function speechRequestBody({ model, voiceId, text, style, stream = false }) {
  if (!GEMINI_TTS_MODELS.includes(model)) throw new Error('対応していないTTSモデルです。');
  if (!/^(voice_[A-Za-z0-9_-]+|[A-Za-z]+)$/.test(voiceId || '')) throw new Error('Voice IDを確認してください。');
  if (!text?.trim()) throw new Error('読み上げる文章を入力してください。');
  const content = { type: 'text', text: text.trim() };
  if (style.trim()) content.annotations = [{ type: 'speech_metadata', style: style.trim() }];
  return {
    model,
    input: [{ type: 'user_input', content: [content] }],
    response_format: stream
      ? { type: 'audio', mime_type: 'audio/l16', sample_rate: 24000 }
      : { type: 'audio', mime_type: 'audio/wav' },
    generation_config: { speech_config: [{ voice: voiceId, language: 'ja-JP' }] },
    ...(stream ? { stream: true } : {}),
  };
}

export function streamGeminiSpeech({ apiKey, model, voiceId, text, style = '', signal }) {
  if (!apiKey?.trim()) throw new Error('Gemini APIキーを入力してください。');
  const body = speechRequestBody({ model, voiceId, text, style, stream: true });
  // fetch はここで開始し、前の文を再生している間にも後続の合成を進める。
  const responsePromise = fetch(`${API_ROOT}/interactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream', 'x-goog-api-key': apiKey.trim() },
    body: JSON.stringify(body),
    signal,
  });
  // 後続の文は再生順まで読み始めないため、先に失敗しても未処理の拒否にしない。
  responsePromise.catch(() => {});

  return (async function* () {
    const response = await responsePromise;
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(`Gemini API (${response.status}): ${result.error?.message || response.statusText}`);
    }
    if (!response.body) throw new Error('音声ストリームを取得できませんでした。');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    let receivedAudio = false;
    try {
      while (true) {
        const { done, value } = await reader.read();
        pending += decoder.decode(value || new Uint8Array(), { stream: !done });
        pending = pending.replace(/\r\n/g, '\n');
        let boundary;
        while ((boundary = pending.indexOf('\n\n')) >= 0) {
          const frame = pending.slice(0, boundary);
          pending = pending.slice(boundary + 2);
          const payload = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
          if (!payload || payload === '[DONE]') continue;
          const event = JSON.parse(payload);
          if (event.event_type === 'error') throw new Error(`Gemini TTS: ${event.error?.message || '音声生成に失敗しました。'}`);
          if (event.event_type === 'step.delta' && event.delta?.type === 'audio' && event.delta.data) {
            receivedAudio = true;
            yield decodeAudio(event.delta.data);
          }
        }
        if (done) break;
      }
      if (!receivedAudio) throw new Error('音声データを取得できませんでした。');
    } finally {
      reader.releaseLock();
    }
  })();
}

export class GeminiTtsClient {
  constructor() {
    this.apiKey = '';
    this.model = GEMINI_TTS_MODELS[0];
    this.voiceId = '';
    this.style = '';
    this.mimeType = 'audio/wav';
  }

  isAvailable() { return !!(this.apiKey && this.voiceId); }

  synthesize(text, { signal, style = this.style } = {}) {
    return synthesizeGeminiSpeech({
      apiKey: this.apiKey, model: this.model, voiceId: this.voiceId,
      style, text, signal,
    });
  }

  synthesizeStream(text, { signal, style = this.style } = {}) {
    return streamGeminiSpeech({
      apiKey: this.apiKey, model: this.model, voiceId: this.voiceId,
      style, text, signal,
    });
  }
}
