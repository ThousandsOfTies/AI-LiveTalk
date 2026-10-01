/**
 * Gemini 音声入力・音声合成の設定と再生準備。
 * 会話、文字起こし、読み上げは同じ Gemini API キーを使う。
 */
import { GeminiTtsClient, GEMINI_TTS_MODELS } from './gemini-tts.js';

const API_ROOT = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_STT_MODEL = 'gemini-3.5-flash-lite';

export class SpeechManager {
  constructor() {
    this._apiKey = '';
    this._sttModel = DEFAULT_STT_MODEL;
    this._sttLang = 'ja-JP';
    this._gemini = new GeminiTtsClient();
    this.isListening = false;
    this.isSpeaking = false;
    this.onTranscript = null;
    this.onInterimTranscript = null;
    this.onListeningEnd = null;
    this.onSpeechStart = null;
    this.onSpeechEnd = null;

    this._mediaRecorder = null;
    this._audioChunks = [];
    this._mimeType = '';
    this._recordingStream = null;
    this._recordingAudioCtx = null;
    this._voiceTimer = null;
    this._maxRecordingTimer = null;
    this._heardSpeech = false;
    this._lastVoiceAt = 0;
    this._recordingStartedAt = 0;
    this._streamAudioCtx = null;
    this._sharedAudio = null;
  }

  setSpeaking(speaking) {
    this.isSpeaking = speaking;
    (speaking ? this.onSpeechStart : this.onSpeechEnd)?.();
  }

  get sttSupported() {
    return !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
  }

  updateGeminiSettings(apiKey, model, voiceId, style = '') {
    this._apiKey = apiKey || '';
    this._gemini.apiKey = this._apiKey;
    this._gemini.model = GEMINI_TTS_MODELS.includes(model) ? model : GEMINI_TTS_MODELS[1];
    this._gemini.voiceId = voiceId || 'Kore';
    this._gemini.style = style || '';
  }

  updateSttModel(model) {
    this._sttModel = model?.trim() || DEFAULT_STT_MODEL;
  }

  getTtsClient() {
    return this._gemini;
  }

  applySettings(settings = {}) {
    this.updateSttModel(settings.stt_model);
    if (GEMINI_TTS_MODELS.includes(settings.gemini_tts_model)) {
      this._gemini.model = settings.gemini_tts_model;
    }
  }

  getSettings() {
    return {
      stt_model: this._sttModel,
      gemini_tts_model: this._gemini.model,
    };
  }

  setLang(lang) {
    this._sttLang = lang || 'ja-JP';
  }

  async startListening() {
    if (this.isListening || !this.sttSupported) return;
    if (!this._apiKey) {
      console.warn('[Gemini STT] APIキーが未設定です');
      this.onListeningEnd?.();
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { noiseSuppression: true, echoCancellation: true, autoGainControl: true },
      });
      this._recordingStream = stream;
      this._mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')
          ? 'audio/ogg;codecs=opus' : 'audio/webm';
      this._audioChunks = [];
      const recorder = new MediaRecorder(stream, { mimeType: this._mimeType });
      this._mediaRecorder = recorder;
      recorder.ondataavailable = event => {
        if (event.data.size > 0) this._audioChunks.push(event.data);
      };
      recorder.onstop = () => {
        this._releaseMicrophone();
        this._transcribeGemini();
      };
      recorder.start();
      this.isListening = true;
      this._recordingStartedAt = Date.now();
      this._heardSpeech = false;
      this._lastVoiceAt = 0;
      this._maxRecordingTimer = setTimeout(() => this.stopListening(), 30000);
      this._startSilenceDetection(stream);
    } catch (error) {
      stream?.getTracks().forEach(track => track.stop());
      this._recordingStream = null;
      this._mediaRecorder = null;
      this.isListening = false;
      console.error('[Gemini STT] 録音開始に失敗:', error);
      this.onListeningEnd?.();
    }
  }

  _startSilenceDetection(stream) {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      const context = new AudioContextClass();
      this._recordingAudioCtx = context;
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      context.createMediaStreamSource(stream).connect(analyser);
      context.resume().catch(() => {});
      const samples = new Uint8Array(analyser.fftSize);
      this._voiceTimer = setInterval(() => {
        if (!this.isListening || context.state !== 'running') return;
        analyser.getByteTimeDomainData(samples);
        let energy = 0;
        for (const value of samples) {
          const amplitude = (value - 128) / 128;
          energy += amplitude * amplitude;
        }
        const now = Date.now();
        if (Math.sqrt(energy / samples.length) > 0.015) {
          this._heardSpeech = true;
          this._lastVoiceAt = now;
        } else if (this._heardSpeech && now - this._lastVoiceAt > 1500) {
          this.stopListening();
        } else if (!this._heardSpeech && now - this._recordingStartedAt > 10000) {
          this.stopListening();
        }
      }, 100);
    } catch (error) {
      console.warn('[Gemini STT] 無音検出を開始できません:', error);
    }
  }

  stopListening() {
    if (!this.isListening) return;
    this.isListening = false;
    clearTimeout(this._maxRecordingTimer);
    clearInterval(this._voiceTimer);
    this._voiceTimer = null;
    const recorder = this._mediaRecorder;
    this._mediaRecorder = null;
    if (recorder?.state !== 'inactive') recorder.stop();
  }

  _releaseMicrophone() {
    this._recordingStream?.getTracks().forEach(track => track.stop());
    this._recordingStream = null;
    this._recordingAudioCtx?.close().catch(() => {});
    this._recordingAudioCtx = null;
  }

  async _transcribeGemini() {
    const blob = new Blob(this._audioChunks, { type: this._mimeType });
    this._audioChunks = [];
    if (!blob.size || (!this._heardSpeech && Date.now() - this._recordingStartedAt >= 10000)) {
      this.onListeningEnd?.();
      return;
    }
    try {
      const base64 = await blobToBase64(blob);
      const response = await fetch(API_ROOT + '/models/' + encodeURIComponent(this._sttModel) + ':generateContent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this._apiKey },
        body: JSON.stringify({
          contents: [{ parts: [
            { inline_data: { mime_type: this._mimeType.split(';')[0], data: base64 } },
            { text: '以下の音声を' + this._sttLang + 'で正確に書き起こしてください。書き起こしたテキストのみを出力してください。' },
          ] }],
        }),
      });
      if (!response.ok) throw new Error('Gemini STT ' + response.status);
      const data = await response.json();
      const transcript = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (transcript) this.onTranscript?.(transcript);
      else this.onListeningEnd?.();
    } catch (error) {
      console.error('[Gemini STT] 転写エラー:', error);
      this.onListeningEnd?.();
    }
  }

  async unlockAudio() {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass && !this._streamAudioCtx) this._streamAudioCtx = new AudioContextClass();
      this._streamAudioCtx?.resume().catch(error =>
        console.warn('[SpeechManager] 音声ストリームの準備に失敗:', error.message)
      );
    } catch (error) {
      console.warn('[SpeechManager] 音声ストリームを使用できません:', error.message);
    }
    if (!this._sharedAudio) {
      this._sharedAudio = new Audio();
      this._sharedAudio.preload = 'auto';
    }
    this._sharedAudio.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFRm10IBAAAAABAAEAIlYAAClWAAACABAAZGF0YQAAAAA=';
    this._sharedAudio.volume = 0;
    try { await this._sharedAudio.play(); }
    catch (error) { console.warn('[SpeechManager] unlockAudio 失敗:', error.message); }
  }

  stopSpeaking() {
    this.isSpeaking = false;
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1] || '');
    reader.onerror = () => reject(reader.error || new Error('音声データの変換に失敗しました'));
    reader.readAsDataURL(blob);
  });
}
