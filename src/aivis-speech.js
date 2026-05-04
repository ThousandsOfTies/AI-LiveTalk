/**
 * AivisSpeech エンジン / Aivis Cloud API クライアント
 *
 * AudioContext は使用しません。
 * synthesize() → ArrayBuffer、再生は HTML5 <audio> 要素で行います。
 * iOS の AudioContext interrupted/suspended 問題を根本回避します。
 */

// ---- 共通基底クラス ----

class BaseClient {
  constructor() {
    /** TTSPipeline / speak() で使う MIME タイプ（サブクラスで上書き） */
    this.mimeType      = 'audio/mpeg';
    this._currentAudio = null;
  }

  /** speak() のデフォルト実装: synthesize() → _playArrayBuffer() */
  async speak(text, callbacks = {}) {
    this.stop();
    const arrayBuffer = await this.synthesize(text);
    return this._playArrayBuffer(arrayBuffer, callbacks);
  }

  /**
   * ArrayBuffer を Blob URL 経由で <audio> 要素により再生する。
   * @param {ArrayBuffer} arrayBuffer
   * @param {{ onStart?: function, onEnd?: function }} callbacks
   */
  async _playArrayBuffer(arrayBuffer, { onStart, onEnd } = {}) {
    const blob  = new Blob([arrayBuffer], { type: this.mimeType });
    const url   = URL.createObjectURL(blob);
    const audio = new Audio(url);
    this._currentAudio = audio;

    return new Promise((resolve) => {
      const finish = () => {
        URL.revokeObjectURL(url);
        this._currentAudio = null;
        onEnd?.();
        resolve();
      };

      audio.onended = finish;
      audio.onerror = () => {
        console.warn(`[${this.constructor.name}] <audio> 再生エラー`);
        finish();
      };

      onStart?.();
      audio.play().catch((e) => {
        console.warn(`[${this.constructor.name}] audio.play() 失敗:`, e.message);
        finish();
      });
    });
  }

  /** 再生中の音声を停止する */
  stop() {
    if (this._currentAudio) {
      try { this._currentAudio.pause(); this._currentAudio.src = ''; } catch { /* ignore */ }
      this._currentAudio = null;
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
export class AivisSpeechClient extends BaseClient {
  /**
   * @param {string} baseUrl    例: 'http://localhost:10101'
   * @param {number} speakerId  話者 ID (デフォルト 888753760)
   */
  constructor(baseUrl = 'http://localhost:10101', speakerId = 888753760) {
    super();
    this.baseUrl   = baseUrl.replace(/\/$/, '');
    this.speakerId = speakerId;
    this.mimeType  = 'audio/wav';
  }

  /** URL に応じて必要なヘッダーを生成する */
  getHeaders() {
    const headers = {};
    if (this.baseUrl.includes('ngrok')) {
      headers['ngrok-skip-browser-warning'] = 'any';
    }
    return headers;
  }

  /**
   * AivisSpeech エンジンが起動しているか確認する
   * @returns {Promise<boolean>}
   */
  async isAvailable() {
    try {
      const res = await fetch(`${this.baseUrl}/version`, {
        signal: AbortSignal.timeout(2000),
        headers: this.getHeaders()
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * テキストを音声合成して生の ArrayBuffer (WAV) を返す
   * @param {string} text
   * @returns {Promise<ArrayBuffer>}
   */
  async synthesize(text) {
    const headers = this.getHeaders();

    const queryRes = await fetch(
      `${this.baseUrl}/audio_query?text=${encodeURIComponent(text)}&speaker=${this.speakerId}`,
      {
        method: 'POST',
        headers
      }
    );
    if (!queryRes.ok) throw new Error(`audio_query エラー: ${queryRes.status}`);
    const query = await queryRes.json();

    const synthRes = await fetch(
      `${this.baseUrl}/synthesis?speaker=${this.speakerId}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers
        },
        body: JSON.stringify(query),
      }
    );
    if (!synthRes.ok) throw new Error(`synthesis エラー: ${synthRes.status}`);
    return synthRes.arrayBuffer();
  }
}

// ---- Aivis Cloud API クライアント ----

/**
 * Aivis Cloud API クライアント
 * https://api.aivis-project.com/v1/tts/synthesize
 * API キーとモデル UUID を設定するだけで、スマホからでも利用できる。
 */
export class AivisCloudClient extends BaseClient {
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
    this.mimeType  = 'audio/mpeg';
  }

  /** API キーが設定されているか */
  isAvailable() {
    return !!this.apiKey;
  }

  /**
   * テキストを音声合成して生の ArrayBuffer (MP3) を返す
   * @param {string} text
   * @returns {Promise<ArrayBuffer>}
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

    return res.arrayBuffer();
  }
}
