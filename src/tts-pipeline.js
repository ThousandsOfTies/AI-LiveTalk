/**
 * TTSパイプライン
 *
 * LLMのストリームチャンクを受け取り、句読点で文を切り出して
 * 選択中のTTSへの合成リクエストを並列に送り、元の順番で再生する。
 *
 * フロー:
 *   LLMチャンク → 文分割 → [合成A] [合成B] [合成C] ...
 *                                ↓ 元の順番で再生キューへ
 *                            再生A → 再生B → 再生C (直列再生)
 *                                 ↑
 *                         Aを再生している間にBを合成
 *
 * Gemini TTS へ送った音声を受信順に再生する。
 */
import { combineSpeechStyle } from './emotion-styles.js';

export class TTSPipeline {
  /** @param {import('./speech.js').SpeechManager} speechManager */
  constructor(speechManager, { emotionStyles = {} } = {}) {
    this._speech = speechManager;
    this._client = speechManager.getTtsClient();
    this._baseStyle = this._client.style || '';
    this._emotionStyles = { ...emotionStyles };
    this._emotion = 'neutral';
    this._earlyPhrases = typeof this._client.synthesizeStream === 'function';

    // テキストバッファ（LLMチャンク蓄積）
    this._textBuf   = '';
    // 合成Promiseまたは音声ストリームのキュー
    this._queue     = [];
    // 再生ループ実行中フラグ
    this._loopRunning  = false;
    // done() が呼ばれたフラグ
    this._finished  = false;
    // フライト中の合成リクエスト数
    this._inFlight  = 0;
    // 停止済みフラグ
    this._stopped   = false;
    this._abortController = new AbortController();
    // 再生中のHTML Audio要素とPCM音声ノード
    this._currentSrc = null;
    this._currentFinish = null;
    this._streamSources = null;
    this._enqueuedCount = 0;
    // 最初の一言を再生開始したか
    this._started   = false;

    // 外部コールバック
    this.onSpeechStart = null;
    this.onSpeechEnd   = null;
    this.onSpeechError = null;

    // done() が await できるよう Promise を作成
    let resolve;
    this._donePromise = new Promise(r => { resolve = r; });
    this._doneResolve = resolve;
  }

  // ---- 公開 API ----

  setEmotion(emotion) {
    this._emotion = emotion;
  }

  /**
   * LLMストリームのチャンクを受け取る
   * @param {string} chunk
   */
  push(chunk) {
    if (this._stopped) return;
    this._textBuf += chunk;
    this._extractSentences(false);
  }

  /**
   * LLM生成完了を通知し、全ての再生完了まで待機する
   * @param {{ lang?: string }} ttsOptions
   * @returns {Promise<void>}
   */
  async done() {
    if (this._stopped) return;
    this._extractSentences(true);
    this._finished = true;
    this._checkDone();
    await this._donePromise;
  }

  /** 再生を中断する */
  stop() {
    this._stopped = true;
    this._abortController.abort();
    this._stopCurrentAudio();
    this._speech.stopSpeaking();
    this._doneResolve?.();
    this._doneResolve = null;
  }

  // ---- プライベート: 文分割 & 合成 ----

  /**
   * バッファから句読点区切りの文を取り出して合成キューに積む
   * @param {boolean} force 残り全てを強制的に処理する
   */
  _extractSentences(force) {
    // 日本語句読点・改行・英語文末を区切りとする (連続する記号も1つのまとまりにする)
    const re = /[。！？\n]+|[.!?]+(?=\s|$)/g;
    let lastEnd = 0;
    let match;

    while ((match = re.exec(this._textBuf)) !== null) {
      const end = match.index + match[0].length;
      const sentence = this._textBuf.slice(lastEnd, end).trim();
      lastEnd = end;
      if (sentence) this._enqueueSynth(sentence);
    }
    this._textBuf = this._textBuf.slice(lastEnd);

    // 最初の二句は自然な区切りから先に合成し、再生中に次の音声を準備する。
    // 短すぎる相づちは単独で読ませず、後続の句とまとめる。
    while (!force && this._earlyPhrases && this._enqueuedCount < 2) {
      const comma = [...this._textBuf.matchAll(/、/g)]
        .find(item => this._textBuf.slice(0, item.index + 1).trim().length >= 6);
      if (comma) {
        const end = comma.index + 1;
        this._enqueueSynth(this._textBuf.slice(0, end).trim());
        this._textBuf = this._textBuf.slice(end);
      } else break;
    }

    if (force && this._textBuf.trim()) {
      this._enqueueSynth(this._textBuf.trim());
      this._textBuf = '';
    }
  }

  /** 文を選択中のTTSで合成してキューに積み、再生ループを起動する */
  _enqueueSynth(text) {
    if (this._stopped) return;
    this._enqueuedCount++;
    const style = combineSpeechStyle(this._baseStyle, this._emotion, this._emotionStyles);
    if (this._speech._streamAudioCtx && typeof this._client.synthesizeStream === 'function') {
      this._queue.push({ stream: this._client.synthesizeStream(text, { signal: this._abortController.signal, style }) });
      this._kickLoop();
      return;
    }
    this._inFlight++;

    const client = this._client;

    // 合成は即座に開始（再生を待たない）
    const audioPromise = client.synthesize(text, { signal: this._abortController.signal, style })
      .then(buf  => { this._inFlight--; return buf; })
      .catch(err => { this._inFlight--; throw err; });

    this._queue.push(audioPromise);
    this._kickLoop();
  }

  // ---- プライベート: 再生ループ ----

  _kickLoop() {
    if (this._loopRunning) return;
    this._loopRunning = true;
    this._runLoop();
  }

  async _runLoop() {
    while (this._queue.length > 0) {
      const item = this._queue.shift();
      try {
        if (item.stream) {
          await this._playPcmStream(item.stream);
          continue;
        }
        const audioBuffer = await item;
        if (this._stopped) continue;

        if (!this._started) {
          this._started = true;
          this.onSpeechStart?.();
        }
        await this._playBuffer(audioBuffer);
      } catch (err) {
        if (this._stopped && err?.name === 'AbortError') continue;
        console.warn('[TTSPipeline] 合成/再生エラー:', err.message);
        this.onSpeechError?.(err);
      }
    }
    this._loopRunning = false;
    this._checkDone();
  }

  /** Gemini から届いた PCM を順に鳴らす。 */
  async _playPcmStream(stream) {
    const context = this._speech._streamAudioCtx;
    await context.resume();
    const sources = new Set();
    this._streamSources = sources;
    let nextStart = context.currentTime;
    let lastEnd = Promise.resolve();
    let carry = null;
    let completed = false;
    try {
      for await (const chunk of stream) {
        if (this._stopped) break;
        let bytes = new Uint8Array(chunk);
        if (carry !== null) {
          const joined = new Uint8Array(bytes.length + 1);
          joined[0] = carry;
          joined.set(bytes, 1);
          bytes = joined;
          carry = null;
        }
        if (bytes.length % 2) {
          carry = bytes[bytes.length - 1];
          bytes = bytes.subarray(0, -1);
        }
        if (!bytes.length) continue;

        const samples = bytes.length / 2;
        const buffer = context.createBuffer(1, samples, 24000);
        const output = buffer.getChannelData(0);
        const pcm = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        for (let i = 0; i < samples; i++) output[i] = pcm.getInt16(i * 2, true) / 32768;

        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(context.destination);
        lastEnd = new Promise(resolve => {
          source.onended = () => { sources.delete(source); resolve(); };
        });
        sources.add(source);
        const start = Math.max(nextStart, context.currentTime + 0.02);
        source.start(start);
        nextStart = start + buffer.duration;
        if (!this._started) {
          this._started = true;
          this.onSpeechStart?.();
        }
      }
      await lastEnd;
      completed = true;
    } finally {
      if (!completed) for (const source of sources) { try { source.stop(); } catch { /* already stopped */ } }
      if (this._streamSources === sources) this._streamSources = null;
    }
  }

  /** 全て完了したか確認し、完了していれば Promise を解決する */
  _checkDone() {
    if (this._stopped) return;
    if (
      this._finished     &&
      this._queue.length === 0 &&
      !this._loopRunning &&
      this._inFlight     === 0
    ) {
      this.onSpeechEnd?.();
      this._doneResolve?.();
      this._doneResolve = null; // 二重呼び出し防止
    }
  }

  /**
   * 合成済み ArrayBuffer を HTML5 <audio> 要素で再生し、終了まで待機する。
   * AudioContext の suspended / interrupted 問題を回避するため
   * <audio> 要素を使う（iOS でも安定して動作する）。
   */
  async _playBuffer(rawBuffer) {
    const client   = this._client;
    const mimeType = client.mimeType ?? 'audio/mpeg';

    const blob = new Blob([rawBuffer], { type: mimeType });
    const url  = URL.createObjectURL(blob);

    // iOS Safari 対策: アンロック済みの共有 Audio 要素を使い回す
    const audio = this._speech._sharedAudio || new Audio();
    audio.src = url;
    audio.volume = 1.0;
    audio.preload = 'auto';
    this._currentSrc = audio;

    return new Promise((resolve) => {
      let isDone = false;
      let timeoutId = null;
      const finish = () => {
        if (isDone) return;
        isDone = true;
        clearTimeout(timeoutId);
        URL.revokeObjectURL(url);
        // 共有要素の場合は src を空にする（メモリ解放）が、インスタンスは保持
        audio.src = '';
        this._currentSrc = null;
        this._currentFinish = null;
        resolve();
      };
      this._currentFinish = finish;

      audio.onended  = finish;
      audio.onerror  = (e) => {
        console.warn('[TTSPipeline] <audio> 再生エラー:', e);
        finish();
      };

      // セーフティタイムアウト
      const estimatedMs = (rawBuffer.byteLength / 16000) * 1000;
      timeoutId = setTimeout(finish, Math.max(estimatedMs + 2000, 5000));

      audio.play().catch((err) => {
        console.warn('[TTSPipeline] audio.play() 失敗:', err.message);
        finish();
      });
    });
  }

  /** 再生を停止する */
  _stopCurrentAudio() {
    if (this._streamSources) {
      for (const source of this._streamSources) { try { source.stop(); } catch { /* already stopped */ } }
      this._streamSources.clear();
      this._streamSources = null;
    }
    if (this._currentSrc) {
      if (this._currentSrc instanceof Audio) {
        try { this._currentSrc.pause(); this._currentSrc.src = ''; } catch { /* ignore */ }
      } else {
        try { this._currentSrc.stop(); } catch { /* ignore */ }
      }
      this._currentSrc = null;
      this._currentFinish?.();
      this._currentFinish = null;
    }
  }
}
