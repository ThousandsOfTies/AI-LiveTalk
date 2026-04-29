/**
 * AivisSpeech エンジン / Aivis Cloud API クライアント
 *
 * - AivisSpeechClient: ローカル VOICEVOX 互換 REST API (http://127.0.0.1:10101)
 * - AivisCloudClient:  Aivis Cloud API SaaS (https://api.aivis-project.com)
 *
 * 共通の AudioContext 管理は BaseAudioClient にまとめています。
 *
 * ★ synthesize() は生の ArrayBuffer を返します。
 *    TTSPipeline は HTML5 <audio> 要素で再生するため AudioContext を使いません。
 *    speak() (直接再生) だけが AudioContext を使います。
 */

// ---- モジュール共通: AudioContext / GainNode の集中管理 ----

const _gainNodes     = new Set();
const _audioContexts = new Set();

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      for (const ctx of _audioContexts) {
        if (ctx.state === 'suspended') {
          ctx.resume().catch(e => console.warn('[AudioContext] resume failed:', e));
        }
      }
    }
  });
}

function _syncDeviceVolume() {
  if (typeof document === 'undefined') return;
  if (document.querySelector('[data-ailivetalk-vol]')) return;

  const el = document.createElement('video');
  el.dataset.ailivetalkVol = '1';
  el.setAttribute('playsinline', 'true');
  el.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0.001;pointer-events:none;';
  document.body.appendChild(el);

  el.addEventListener('volumechange', () => {
    for (const node of _gainNodes) node.gain.value = el.volume;
  });
}

// ---- 共通基底クラス ----

class BaseAudioClient {
  constructor() {
    this._audioCtx      = null;
    this._gainNode      = null;
    this._currentSource = null;
  }

  _createAudioCtx() {
    if (this._gainNode) { _gainNodes.delete(this._gainNode); this._gainNode = null; }
    if (this._audioCtx) { _audioContexts.delete(this._audioCtx); }

    const ctx      = new AudioContext();
    this._gainNode = ctx.createGain();
    this._gainNode.connect(ctx.destination);
    _gainNodes.add(this._gainNode);
    _audioContexts.add(ctx);
    _syncDeviceVolume();
    return ctx;
  }

  async _getAudioCtx() {
    if (!this._audioCtx || this._audioCtx.state === 'closed') {
      this._audioCtx = this._createAudioCtx();
    }
    if (this._audioCtx.state === 'suspended') {
      await this._audioCtx.resume().catch(() => {});
      if (this._audioCtx.state === 'suspended') {
        this._audioCtx = this._createAudioCtx();
      }
    }
    return this._audioCtx;
  }

  stop() {
    if (this._currentSource) {
      try { this._currentSource.stop(); } catch { /* 既に停止済み */ }
      this._currentSource = null;
    }
  }
}

// ---- AivisSpeech ローカルクライアント ----

export class AivisSpeechClient extends BaseAudioClient {
  constructor(baseUrl = 'http://localhost:10101', speakerId = 888753760) {
    super();
    this.baseUrl   = baseUrl.replace(/\/$/, '');
    this.speakerId = speakerId;
    /** TTSPipeline が HTML5 Audio で再生するときの MIME タイプ */
    this.mimeType  = 'audio/wav';
  }

  async isAvailable() {
    try {
      const res = await fetch(`${this.baseUrl}/version`, { signal: AbortSignal.timeout(2000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * テキストを音声合成して生の ArrayBuffer (WAV) を返す。
   * TTSPipeline はこれを HTML5 <audio> で再生する。
   */
  async synthesize(text) {
    const queryRes = await fetch(
      `${this.baseUrl}/audio_query?text=${encodeURIComponent(text)}&speaker=${this.speakerId}`,
      { method: 'POST' }
    );
    if (!queryRes.ok) throw new Error(`audio_query エラー: ${queryRes.status}`);
    const query = await queryRes.json();

    const synthRes = await fetch(
      `${this.baseUrl}/synthesis?speaker=${this.speakerId}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(query),
      }
    );
    if (!synthRes.ok) throw new Error(`synthesis エラー: ${synthRes.status}`);
    return synthRes.arrayBuffer();
  }

  /** テキストを読み上げる (AudioContext 経由・PC 向け直接再生) */
  async speak(text, { onStart, onEnd } = {}) {
    this.stop();
    const arrayBuffer = await this.synthesize(text);
    const audioCtx    = await this._getAudioCtx();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

    return new Promise((resolve) => {
      const source = audioCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this._gainNode);
      this._currentSource = source;

      source.onended = () => {
        this._currentSource = null;
        onEnd?.();
        resolve();
      };
      onStart?.();
      source.start(0);
    });
  }
}

// ---- Aivis Cloud API クライアント ----

export class AivisCloudClient extends BaseAudioClient {
  constructor(apiKey = '', modelUuid = '', styleId = null) {
    super();
    this.apiKey    = apiKey;
    this.modelUuid = modelUuid;
    this.styleId   = styleId;
    /** TTSPipeline が HTML5 Audio で再生するときの MIME タイプ */
    this.mimeType  = 'audio/mpeg';
  }

  isAvailable() {
    return !!this.apiKey;
  }

  /**
   * テキストを音声合成して生の ArrayBuffer (MP3) を返す。
   * TTSPipeline はこれを HTML5 <audio> で再生する。
   */
  async synthesize(text) {
    if (!this.modelUuid) {
      throw new Error('Aivis Cloud: モデルUUIDが未設定です。設定からモデルUUIDを入力してください');
    }
    const reqBody = {
      model_uuid:    this.modelUuid,
      text,
      use_ssml:      false,
      output_format: 'mp3',
    };
    if (this.styleId !== null && this.styleId !== '') {
      reqBody.style_id = Number(this.styleId);
    }

    const res = await fetch('https://api.aivis-project.com/v1/tts/synthesize', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify(reqBody),
    });

    if (res.status === 401) throw new Error('Aivis Cloud API: APIキーが無効です');
    if (res.status === 402) throw new Error('Aivis Cloud API: クレジット残高不足');
    if (res.status === 404) throw new Error('Aivis Cloud API: モデルが見つかりません');
    if (!res.ok)            throw new Error(`Aivis Cloud API エラー: ${res.status}`);

    return res.arrayBuffer();
  }

  /** テキストを読み上げる (AudioContext 経由・PC 向け直接再生) */
  async speak(text, { onStart, onEnd } = {}) {
    this.stop();
    const arrayBuffer = await this.synthesize(text);
    const audioCtx    = await this._getAudioCtx();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

    return new Promise((resolve) => {
      const source = audioCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this._gainNode);
      this._currentSource = source;

      source.onended = () => {
        this._currentSource = null;
        onEnd?.();
        resolve();
      };
      onStart?.();
      source.start(0);
    });
  }
}
