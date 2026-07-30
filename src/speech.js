/**
 * Web Speech API ラッパー
 * - STT (音声認識): 環境音レベルに応じて Web Speech API / Gemini Audio を自動切替
 * - TTS: ローカル AivisSpeech (最優先) / Aivis Cloud API / ブラウザ SpeechSynthesis (フォールバック)
 */
import { AivisSpeechClient, AivisCloudClient } from './aivis-speech.js';

export class SpeechManager {
  // ---- ノイズ判定定数 ----
  static NOISE_THRESHOLD    = 0.015; // RMS閾値: これを超えると騒音モード
  static NOISE_HYSTERESIS   = 0.008; // 静音復帰閾値（チャタリング防止）
  static NOISE_HISTORY_SIZE = 6;     // ローリング平均サンプル数（500ms × 6 = 3秒）

  constructor() {
    // 高精度STTはLLMとは別の接続設定を持つ。別サービスのAPIキーを誤送信しないため、暗黙の流用はしない。
    this._sttEndpoint = 'https://generativelanguage.googleapis.com/v1beta';
    this._sttApiKey   = '';
    this._sttModel    = 'gemini-2.5-flash';

    this.isListening = false;
    this.isSpeaking = false;

    /** @type {function(string):void} */
    this.onTranscript = null;
    /** @type {function(string):void} */
    this.onInterimTranscript = null;
    /** @type {function():void} */
    this.onListeningEnd = null;
    /** @type {function():void} */
    this.onSpeechStart = null;
    /** @type {function():void} */
    this.onSpeechEnd = null;

    // ローカル AivisSpeech クライアント (127.0.0.1 は HTTPS からでも例外的にアクセス可能)
    this._aivis = new AivisSpeechClient('http://127.0.0.1:10101', 888753760);
    this._useAivis = false;

    // Aivis Cloud API クライアント (SaaS)
    this._cloud = new AivisCloudClient('', '');
    this._useCloud = this._cloud.isAvailable();

    // 優先順位: Local > Cloud
    this._checkAivis().then(() => {
      if (this._useAivis) {
        console.log('[TTS] ローカル AivisSpeech を優先使用します');
      } else if (this._useCloud) {
        console.log('[TTS] Aivis Cloud API を使用します');
      } else {
        console.log('[TTS] ブラウザ SpeechSynthesis を使用します');
      }
    });

    this._recognition = null;
    this._accumulatedText = '';
    this._silenceTimer = null;
    this._initRecognition();

    // ---- ノイズモニタリング ----
    this._noiseStream   = null;
    this._noiseAudioCtx = null;
    this._noiseAnalyser = null;
    this._noiseHistory  = [];
    this._noiseTimer    = null;
    this._noiseGeneration = 0;
    this._noiseStartPromise = null;
    this.isNoisy        = false;
    /** @type {function(boolean):void} */
    this.onNoiseModeChange = null;

    // ---- Gemini STT 録音 ----
    this._mediaRecorder = null;
    this._audioChunks   = [];
    this._mimeType      = '';

    // ---- モバイル向け音声再生アンロック用 ----
    this._sharedAudio   = null;
  }

  /** TTS再生状態を更新し、対応するコールバックを発火する */
  setSpeaking(speaking) {
    this.isSpeaking = speaking;
    (speaking ? this.onSpeechStart : this.onSpeechEnd)?.();
  }

  get sttSupported() {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition)
        || this._canUseHighAccuracyStt();
  }

  /** AivisSpeech の疎通確認（非同期・バックグラウンド） */
  async _checkAivis() {
    this._useAivis = await this._aivis.isAvailable();
    if (this._useAivis) console.log('[TTS] ローカル AivisSpeech を使用します');
    else if (this._useCloud) console.log('[TTS] Aivis Cloud API を使用します');
    else console.log('[TTS] ブラウザ SpeechSynthesis を使用します');
  }

  /**
   * Cloud API 設定を更新する
   * @param {string} apiKey
   * @param {string} modelUuid
   * @param {string|null} styleId
   */
  updateCloudSettings(apiKey, modelUuid, styleId = null) {
    this._cloud.apiKey    = apiKey;
    this._cloud.modelUuid = modelUuid;
    this._cloud.styleId   = (styleId !== '' && styleId != null) ? styleId : null;
    this._useCloud = this._cloud.isAvailable();
    if (this._useCloud) {
      console.log('[TTS] Aivis Cloud API に切り替えました');
    } else if (!this._useAivis) {
      this._checkAivis();
    }
  }

  /**
   * AivisSpeech 接続設定を更新して再チェックする
   * @param {string} url
   * @param {number} speakerId
   */
  updateAivisSettings(url, speakerId) {
    this._aivis.baseUrl = url.replace(/\/$/, '');
    this._aivis.speakerId = Number(speakerId);
    this._checkAivis();
  }

  /** 騒音時に使用する高精度STT（Gemini Audio）の接続設定を更新する。 */
  updateSttSettings(endpoint, apiKey, model) {
    this._sttEndpoint = (endpoint || '').replace(/\/+$/, '');
    this._sttApiKey   = apiKey || '';
    this._sttModel    = model || '';
  }

  _hasHighAccuracyStt() {
    return !!(this._sttEndpoint && this._sttApiKey && this._sttModel);
  }

  _canUseHighAccuracyStt() {
    return !!(this._hasHighAccuracyStt() && navigator.mediaDevices && window.MediaRecorder);
  }

  /** 設定を一括適用する */
  applySettings(s) {
    if (s.aivis_url) {
      this._aivis.baseUrl = s.aivis_url.replace(/\/$/, '');
    }
    if (s.aivis_cloud_api_key) {
      this._cloud.apiKey = s.aivis_cloud_api_key;
      this._useCloud = this._cloud.isAvailable();
    }
    if (s.stt_endpoint !== undefined) this._sttEndpoint = String(s.stt_endpoint).replace(/\/+$/, '');
    if (s.stt_api_key !== undefined)  this._sttApiKey   = String(s.stt_api_key);
    if (s.stt_model !== undefined)    this._sttModel    = String(s.stt_model);
  }

  /** 現在の設定をオブジェクトとして返す */
  getSettings() {
    return {
      aivis_url:           this._aivis.baseUrl,
      aivis_cloud_api_key: this._cloud.apiKey,
      stt_endpoint:        this._sttEndpoint,
      stt_api_key:         this._sttApiKey,
      stt_model:           this._sttModel,
    };
  }

  // ---- Web Speech API 初期化 ----

  _initRecognition() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;

    this._recognition = new SR();
    this._recognition.lang = 'ja-JP';
    this._recognition.continuous = true;
    this._recognition.interimResults = true;

    this._recognition.onresult = (e) => {
      this._resetRecognitionTimer(); // 30秒の強制タイマーリセット
      
      let finalSegment = '';
      let interimSegment = '';

      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        if (result.isFinal) {
          finalSegment += result[0].transcript;
        } else {
          interimSegment += result[0].transcript;
        }
      }

      this._accumulatedText += finalSegment;
      const currentFullText = this._accumulatedText + interimSegment;

      if (currentFullText.trim().length > 0) {
        this.onInterimTranscript?.(currentFullText);
        this._resetSilenceTimer();
      }
    };

    this._recognition.onend = () => {
      clearTimeout(this._recognitionTimer);
      clearTimeout(this._silenceTimer);
      this.isListening = false;
      this.stopNoiseMonitoring();

      const text = this._accumulatedText.trim();
      if (text) {
        this.onTranscript?.(text);
      } else {
        this.onListeningEnd?.();
      }
      this._accumulatedText = '';
    };

    this._recognition.onerror = (e) => {
      clearTimeout(this._recognitionTimer);
      clearTimeout(this._silenceTimer);
      console.error('STT エラー:', e.error);
      this.isListening = false;
      this.stopNoiseMonitoring();
    };
  }

  _resetSilenceTimer() {
    clearTimeout(this._silenceTimer);
    this._silenceTimer = setTimeout(() => {
      if (this.isListening && this._recognition) {
        console.log('[STT] 独自の無音タイムアウトにより確定します');
        this._recognition.stop();
      }
    }, 3000); // 3.0秒の無音で確定（余裕を持たせる）
  }

  setLang(lang) {
    if (this._recognition) this._recognition.lang = lang;
  }

  // ---- ノイズモニタリング ----

  /** 音声入力中だけ環境音レベルの計測を開始する。 */
  async startNoiseMonitoring() {
    if (this._noiseStream) return; // 既に起動済み
    if (this._noiseStartPromise) return this._noiseStartPromise;
    const generation = this._noiseGeneration;
    this._noiseStartPromise = (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        });
        // 権限ダイアログ表示中などに停止された場合、後からマイクを再開しない。
        if (generation !== this._noiseGeneration) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }
        this._noiseStream = stream;
        this._noiseAudioCtx = new AudioContext();
        this._noiseAnalyser = this._noiseAudioCtx.createAnalyser();
        this._noiseAnalyser.fftSize = 2048;
        this._noiseAudioCtx.createMediaStreamSource(this._noiseStream)
          .connect(this._noiseAnalyser);
        this._noiseHistory = [];
        this._noiseTimer = setInterval(() => this._measureNoise(), 500);
      } catch (e) {
        console.warn('[NoiseMonitor] getUserMedia 失敗:', e.message);
      } finally {
        this._noiseStartPromise = null;
      }
    })();
    return this._noiseStartPromise;
  }

  /** ノイズモニタリングを停止してリソースを解放する */
  stopNoiseMonitoring() {
    this._noiseGeneration++;
    clearInterval(this._noiseTimer);
    this._noiseTimer = null;
    this._noiseStream?.getTracks().forEach(t => t.stop());
    this._noiseStream = null;
    this._noiseAudioCtx?.close();
    this._noiseAudioCtx = null;
    this._noiseAnalyser = null;
    this._noiseHistory  = [];
    if (this.isNoisy) {
      this.isNoisy = false;
      this.onNoiseModeChange?.(false);
    }
  }

  /** 500ms ごとに呼ばれてノイズレベルを計測・isNoisy を更新する */
  _measureNoise() {
    if (!this._noiseAnalyser) return;
    const buf = new Uint8Array(this._noiseAnalyser.fftSize);
    this._noiseAnalyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) { const n = (v - 128) / 128; sum += n * n; }
    const rms = Math.sqrt(sum / buf.length);

    this._noiseHistory.push(rms);
    if (this._noiseHistory.length > SpeechManager.NOISE_HISTORY_SIZE)
      this._noiseHistory.shift();

    const avg = this._noiseHistory.reduce((a, b) => a + b, 0) / this._noiseHistory.length;
    // ヒステリシス: 騒音→静音は低い閾値を使ってチャタリングを防ぐ
    const threshold = this.isNoisy
      ? SpeechManager.NOISE_HYSTERESIS
      : SpeechManager.NOISE_THRESHOLD;

    const nowNoisy = avg > threshold;
    if (nowNoisy !== this.isNoisy) {
      this.isNoisy = nowNoisy;
      this.onNoiseModeChange?.(this.isNoisy);
    }

    // 録音中（特にGeminiモード）の場合、音を検知したらタイマーをリセット
    if (this.isListening && nowNoisy) {
      this._resetRecognitionTimer();
    }
  }

  // ---- Gemini Audio STT ----

  async _startGemini() {
    if (this._mediaRecorder) return;
    this._mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/ogg;codecs=opus') ? 'audio/ogg;codecs=opus' : 'audio/webm';
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { noiseSuppression: true, echoCancellation: true, autoGainControl: true },
      });
    } catch (e) {
      console.error('[Gemini STT] getUserMedia 失敗:', e.message);
      this.isListening = false;
      this.onListeningEnd?.();
      return;
    }
    this._audioChunks = [];
    this._mediaRecorder = new MediaRecorder(stream, { mimeType: this._mimeType });
    this._mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) this._audioChunks.push(e.data); };
    this._mediaRecorder.onstop = () => { stream.getTracks().forEach(t => t.stop()); this._transcribeGemini(); };
    this._mediaRecorder.start();
    this.isListening = true;
    this._resetRecognitionTimer();
  }

  _stopGemini() {
    clearTimeout(this._recognitionTimer);
    if (!this._mediaRecorder) return;
    this._mediaRecorder.stop();
    this._mediaRecorder = null;
    this.isListening = false;
    this.stopNoiseMonitoring();
  }

  async _transcribeGemini() {
    const blob = new Blob(this._audioChunks, { type: this._mimeType });
    this._audioChunks = [];
    // base64 変換
    const base64 = await _blobToBase64(blob);
    const url = `${this._sttEndpoint}/models/${encodeURIComponent(this._sttModel)}:generateContent`;
    const body = {
      contents: [{ parts: [
        { inline_data: { mime_type: this._mimeType.split(';')[0], data: base64 } },
        { text: '以下の音声を正確に書き起こしてください。書き起こしたテキストのみを出力してください。' },
      ]}],
    };
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this._sttApiKey,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Gemini STT ${res.status}`);
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (text) this.onTranscript?.(text);
      else this.onListeningEnd?.();
    } catch (e) {
      console.error('[Gemini STT] 転写エラー:', e.message);
      this.onListeningEnd?.();
    } finally {
      this.stopNoiseMonitoring();
    }
  }

  // ---- STT 制御（環境音で自動切替） ----

  async startListening() {
    if (this.isListening) return;
    await this.startNoiseMonitoring();
    this._measureNoise();
    if (this.isNoisy && this._canUseHighAccuracyStt()) {
      await this._startGemini();
      return;
    }
    // Web Speech API パス
    if (!this._recognition) {
      this.stopNoiseMonitoring();
      return;
    }
    this._accumulatedText = '';
    this._recognition.start();
    this.isListening = true;
    this._resetRecognitionTimer();
  }

  /** タイマーを30秒にリセットする */
  _resetRecognitionTimer() {
    clearTimeout(this._recognitionTimer);
    this._recognitionTimer = setTimeout(() => {
      if (this.isListening) {
        console.warn('[STT] 無音タイムアウトにより強制終了');
        this.stopListening();
      }
    }, 30000);
  }

  stopListening() {
    if (!this.isListening) return;
    if (this._mediaRecorder) { this._stopGemini(); return; }
    // Web Speech API パス
    clearTimeout(this._recognitionTimer);
    clearTimeout(this._silenceTimer);
    this._recognition.stop();
    this.isListening = false;
    this.stopNoiseMonitoring();
  }

  /**
   * テキストを読み上げる（ローカル AivisSpeech > Cloud API > ブラウザTTS の優先順位）
   * @param {string} text
   * @param {{ lang?: string, rate?: number, pitch?: number }} options
   * @returns {Promise<void>}
   */
  async speak(text, options = {}) {
    this.isSpeaking = true;

    // --- ローカル AivisSpeech (最優先) ---
    if (this._useAivis) {
      try {
        await this._aivis.speak(text, {
          onStart: () => this.onSpeechStart?.(),
          onEnd: () => {
            this.isSpeaking = false;
            this.onSpeechEnd?.();
          },
        });
        return;
      } catch (err) {
        console.warn('[AivisSpeech] ローカル読み上げ失敗、Cloud/ブラウザTTSを試みます:', err);
        this._useAivis = false;
      }
    }

    // --- Aivis Cloud API (セカンダリ) ---
    if (this._useCloud) {
      try {
        await this._cloud.speak(text, {
          onStart: () => this.onSpeechStart?.(),
          onEnd: () => {
            this.isSpeaking = false;
            this.onSpeechEnd?.();
          },
        });
        return;
      } catch (err) {
        console.warn('[Aivis Cloud] 読み上げ失敗:', err.message);
        // Cloud API エラーの場合はフォールバックしない（クレジット切れ等を通知するため）
        this.isSpeaking = false;
        this.onSpeechEnd?.();
        throw err;
      }
    }

    // --- ブラウザ SpeechSynthesis フォールバック ---
    return new Promise((resolve, reject) => {
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = options.lang || 'ja-JP';
      utterance.rate = options.rate ?? 1.0;
      utterance.pitch = options.pitch ?? 1.05;
      utterance.volume = options.volume ?? 1.0;

      const trySpeak = () => {
        const voices = window.speechSynthesis.getVoices();
        const match = voices.find((v) => v.lang.startsWith(utterance.lang.slice(0, 2)));
        if (match) utterance.voice = match;

        let fallbackTimer = null;

        utterance.onstart = () => {
          this.isSpeaking = true;
          this.onSpeechStart?.();

          // iOS Safari の onend 発火漏れバグ回避策 (speakingフラグもバグる事があるため時間経過で強制終了)
          const guessedDuration = Math.max(3000, utterance.text.length * 350 + 1000);
          clearTimeout(fallbackTimer);
          fallbackTimer = setTimeout(() => {
            if (this.isSpeaking) {
              console.warn('[TTS] onend fired by fallback timer (timeout)');
              this.isSpeaking = false;
              this.onSpeechEnd?.();
              resolve();
            }
          }, guessedDuration);
        };
        utterance.onend = () => {
          clearTimeout(fallbackTimer);
          if (this.isSpeaking) {
            this.isSpeaking = false;
            this.onSpeechEnd?.();
            resolve();
          }
        };
        utterance.onerror = (e) => {
          clearTimeout(fallbackTimer);
          this.isSpeaking = false;
          this.onSpeechEnd?.();
          if (e.error !== 'interrupted') reject(e);
          else resolve();
        };
        window.speechSynthesis.speak(utterance);
      };

      const voices = window.speechSynthesis.getVoices();
      if (voices.length > 0) {
        trySpeak();
      } else {
        window.speechSynthesis.onvoiceschanged = () => {
          window.speechSynthesis.onvoiceschanged = null;
          trySpeak();
        };
      }
    });
  }

  /**
   * ユーザーゲスチャーの直後に呼び出し、iOS Safari の自動再生ブロックを解除する。
   * 以降、この SpeechManager インスタンスが保持する _sharedAudio を使って再生を行う。
   */
  async unlockAudio() {
    if (!this._sharedAudio) {
      this._sharedAudio = new Audio();
      this._sharedAudio.preload = 'auto';
    }

    // 無音の短いWAVデータ
    this._sharedAudio.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFRm10IBAAAAABAAEAIlYAAClWAAACABAAZGF0YQAAAAA=';
    this._sharedAudio.volume = 0;

    try {
      await this._sharedAudio.play();
    } catch (e) {
      console.warn('[SpeechManager] unlockAudio 失敗:', e.message);
    }

    // ブラウザ TTS フォールバック用の SpeechSynthesis アンロック
    if (!this._useAivis && !this._useCloud && 'speechSynthesis' in window) {
      const utt = new SpeechSynthesisUtterance('');
      utt.volume = 0;
      window.speechSynthesis.speak(utt);
    }
  }

  stopSpeaking() {
    this._aivis.stop();
    this._cloud.stop();
    window.speechSynthesis.cancel();
    this.isSpeaking = false;
  }
}

function _blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1] || '');
    reader.onerror = () => reject(reader.error || new Error('音声データの変換に失敗しました'));
    reader.readAsDataURL(blob);
  });
}
