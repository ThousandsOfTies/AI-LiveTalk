/**
 * AivisSpeech エンジン / Aivis Cloud API クライアント
 *
 * - AivisSpeechClient: ローカル VOICEVOX 互換 REST API (http://127.0.0.1:10101)
 * - AivisCloudClient:  Aivis Cloud API SaaS (https://api.aivis-project.com)
 *
 * 共通の AudioContext 管理は BaseAudioClient にまとめています。
 */

// ---- モジュール共通: AudioContext / GainNode の集中管理 ----

/** 全クライアントの GainNode を保持 (デバイスボリューム同期用) */
const _gainNodes = new Set();
/** 全 AudioContext を保持 (visibilitychange でレジューム用) */
const _audioContexts = new Set();

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      for (const ctx of _audioContexts) {
        if (ctx.state === 'suspended') {
          ctx.resume().catch(e => console.warn('[AudioContext] visibilitychange resume failed:', e));
        }
      }
    }
  });
}

/**
 * iOS Safari のハードウェアボリューム変化を GainNode に反映する。
 * <video> 要素の volumechange イベントを利用する。
 */
function _syncDeviceVolume() {
  if (typeof document === 'undefined') return;
  if (document.querySelector('[data-ailivetalk-vol]')) return; // 二重初期化防止

  const el = document.createElement('video');
  el.dataset.ailivetalkVol = '1';
  el.setAttribute('playsinline', 'true');
  // opacity:0 では iOS がイベントを送らない場合があるため限りなく透明に
  el.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0.001;pointer-events:none;';
  document.body.appendChild(el);

  el.addEventListener('volumechange', () => {
    for (const node of _gainNodes) {
      node.gain.value = el.volume;
    }
  });
}

// ---- 共通基底クラス ----

/**
 * AudioContext の生成・再開・停止をまとめた基底クラス。
 * AivisSpeechClient と AivisCloudClient はこれを継承する。
 */
class BaseAudioClient {
  constructor() {
    this._audioCtx      = null;
    this._gainNode      = null;
    this._currentSource = null;
  }

  /** AudioContext を新規生成し、visibilitychange 監視対象に登録する */
  _createAudioCtx() {
    // 旧インスタンスを監視リストから除去
    if (this._gainNode)  { _gainNodes.delete(this._gainNode);       this._gainNode = null; }
    if (this._audioCtx)  { _audioContexts.delete(this._audioCtx); }

    const ctx       = new AudioContext();
    this._gainNode  = ctx.createGain();
    this._gainNode.connect(ctx.destination);
    _gainNodes.add(this._gainNode);
    _audioContexts.add(ctx);
    _syncDeviceVolume();
    return ctx;
  }

  /**
   * AudioContext を遅延初期化する（ユーザー操作後でないと使えないため）。
   * suspend 状態ならレジュームを試み、それでも解除できなければ再生成する。
   * @returns {Promise<AudioContext>}
   */
  async _getAudioCtx() {
    if (!this._audioCtx || this._audioCtx.state === 'closed') {
      this._audioCtx = this._createAudioCtx();
    }
    if (this._audioCtx.state === 'suspended') {
      await this._audioCtx.resume().catch(() => {});
      // resume 後も suspended のまま（ブラウザが拒否）なら再生成
      if (this._audioCtx.state === 'suspended') {
        this._audioCtx = this._createAudioCtx();
      }
    }
    return this._audioCtx;
  }

  /** 再生中のソースを停止する */
  stop() {
    if (this._currentSource) {
      try { this._currentSource.stop(); } catch { /* 既に停止済み */ }
      this._currentSource = null;
    }
  }
}

// ---- AivisSpeech ローカルクライアント ----

/**
 * AivisSpeech エンジン クライアント (ローカル)
 * VOICEVOX 互換 REST API を使って高品質 TTS を実現する。
 * AivisSpeech はホスト PC で起動しておく必要がある。
 * デフォルト: http://localhost:10101
 */
export class AivisSpeechClient extends BaseAudioClient {
  /**
   * @param {string} baseUrl    例: 'http://localhost:10101'
   * @param {number} speakerId  話者 ID (デフォルト 888753760)
   */
  constructor(baseUrl = 'http://localhost:10101', speakerId = 888753760) {
    super();
    this.baseUrl   = baseUrl.replace(/\/$/, '');
    this.speakerId = speakerId;
  }

  /**
   * AivisSpeech エンジンが起動しているか確認する
   * @returns {Promise<boolean>}
   */
  async isAvailable() {
    try {
      const res = await fetch(`${this.baseUrl}/version`, { signal: AbortSignal.timeout(2000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * テキストを音声合成して AudioBuffer を返す
   * @param {string} text
   * @returns {Promise<AudioBuffer>}
   */
  async synthesize(text) {
    // Step1: audio_query
    const queryRes = await fetch(
      `${this.baseUrl}/audio_query?text=${encodeURIComponent(text)}&speaker=${this.speakerId}`,
      { method: 'POST' }
    );
    if (!queryRes.ok) throw new Error(`audio_query エラー: ${queryRes.status}`);
    const query = await queryRes.json();

    // Step2: synthesis → WAV バイナリ
    const synthRes = await fetch(
      `${this.baseUrl}/synthesis?speaker=${this.speakerId}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(query),
      }
    );
    if (!synthRes.ok) throw new Error(`synthesis エラー: ${synthRes.status}`);

    const arrayBuffer = await synthRes.arrayBuffer();
    const audioCtx    = await this._getAudioCtx();
    return audioCtx.decodeAudioData(arrayBuffer);
  }

  /**
   * テキストを読み上げる
   * @param {string} text
   * @param {{ onStart?: function, onEnd?: function }} callbacks
   * @returns {Promise<void>}
   */
  async speak(text, { onStart, onEnd } = {}) {
    this.stop();
    const audioBuffer = await this.synthesize(text);
    const audioCtx    = await this._getAudioCtx();

    return new Promise((resolve) => {
      const source    = audioCtx.createBufferSource();
      source.buffer   = audioBuffer;
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

/**
 * Aivis Cloud API クライアント
 * https://api.aivis-project.com/v1/tts/synthesize
 * APIキーとモデルUUIDを設定するだけで、スマホ・どこからでも利用できる。
 */
export class AivisCloudClient extends BaseAudioClient {
  /**
   * @param {string}      apiKey    Aivis Cloud API キー
   * @param {string}      modelUuid AivisHub のモデル UUID
   * @param {string|null} styleId   スタイル ID (省略可)
   */
  constructor(apiKey = '', modelUuid = '', styleId = null) {
    super();
    this.apiKey    = apiKey;
    this.modelUuid = modelUuid;
    this.styleId   = styleId;
  }

  /** APIキーが設定されているか */
  isAvailable() {
    return !!this.apiKey;
  }

  /**
   * テキストを音声合成して AudioBuffer を返す
   * @param {string} text
   * @returns {Promise<AudioBuffer>}
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
    if (res.status === 404) throw new Error('Aivis Cloud API: モデルが見つかりません。設定のモデルUUIDを確認してください');
    if (!res.ok)            throw new Error(`Aivis Cloud API エラー: ${res.status}`);

    const arrayBuffer = await res.arrayBuffer();
    const audioCtx    = await this._getAudioCtx();
    return audioCtx.decodeAudioData(arrayBuffer);
  }

  /**
   * テキストを読み上げる
   * @param {string} text
   * @param {{ onStart?: function, onEnd?: function }} callbacks
   * @returns {Promise<void>}
   */
  async speak(text, { onStart, onEnd } = {}) {
    this.stop();
    const audioBuffer = await this.synthesize(text);
    const audioCtx    = await this._getAudioCtx();

    return new Promise((resolve) => {
      const source    = audioCtx.createBufferSource();
      source.buffer   = audioBuffer;
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
