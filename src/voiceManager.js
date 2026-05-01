import { setStatus } from './uiUtils.js';
import { setOnPipelineEnd } from './chatManager.js';

let _speech, _llm, _micBtn, _sendBtn, _sendMessage;
let _rallyMode        = false; // ラリーモード（自動会話）のON/OFF
let _longPressTimer   = null;
let _longPressTriggered = false;
let _receivedTranscript = false; // 今回の録音で文字が認識されたか

export function initVoiceManager({ speech, llm, micBtn, sendBtn, sendMessage }) {
  _speech      = speech;
  _llm         = llm;
  _micBtn      = micBtn;
  _sendBtn     = sendBtn;
  _sendMessage = sendMessage;

  if (!speech.sttSupported) {
    _micBtn.disabled = true;
    _micBtn.title    = 'このブラウザは音声認識に非対応です';
  }

  // 会話パイプライン終了（AIの思考とTTS生成が全て終わったタイミング）
  setOnPipelineEnd(() => {
    // ラリーモード中かつAIが喋り終えていたら、録音を開始
    if (_rallyMode && !_speech.isSpeaking && !_speech.isListening) {
      startListeningOnce();
    }
  });

  // TTS 再生開始時の処理
  _speech.onSpeechStart = () => {
    _updateUI();
  };

  // TTS 再生終了時の処理
  _speech.onSpeechEnd = () => {
    // ラリーモード中であれば、発話終了後に自動で録音を開始
    if (_rallyMode && !_speech.isListening) {
      startListeningOnce();
    }
    _updateUI();
  };

  _speech.onNoiseModeChange = () => {
    _updateUI();
  };

  _registerListeners();
  _updateUI();
}

/** 現在のステート（ラリー・発話・録音）に基づいてUIを一括更新する */
function _updateUI() {
  const isListening = _speech.isListening;
  const isSpeaking  = _speech.isSpeaking;

  // マイクボタンのクラス
  _micBtn.classList.toggle('active', isListening);
  _micBtn.classList.toggle('auto-listen', _rallyMode);
  _micBtn.classList.toggle('noisy-mode', _speech.isNoisy);

  // アイコン切り替え
  if (isListening) {
    _micBtn.textContent = _speech.isNoisy ? '✦' : '🎤';
  } else {
    // 非録音中。ラリーモードなら専用アイコン、通常ならマイク
    _micBtn.textContent = _rallyMode ? '💬' : '🎤';
  }

  // ボタンの有効・無効（AI発話中は入力を一切受け付けない）
  _micBtn.disabled  = isSpeaking;
  _sendBtn.disabled = isSpeaking;

  // ステータス・タイトル
  if (isListening) {
    setStatus(_speech.isNoisy ? '✦ 高精度認識中...' : '🎤 聞いています...');
    _micBtn.title = '音声入力中 (クリックで停止)';
  } else if (isSpeaking) {
    setStatus('AI 発話中...');
    _micBtn.title = 'AI発話中 (操作不可)';
  } else if (_rallyMode) {
    setStatus('会話モード ON');
    _micBtn.title = '会話モード中 (長押しで終了)';
  } else {
    setStatus('');
    _micBtn.title = '音声入力 (クリックで開始/停止)';
  }

  const chatInput = document.getElementById('chat-input');
  if (chatInput) chatInput.classList.toggle('recording', isListening);
}

export async function startListeningOnce() {
  // AIが喋っている間は、録音を開始しない
  if (_speech.isSpeaking) return;

  _receivedTranscript = false;
  _speech.setLang(_llm.ttsLang);
  await _speech.startListening();
  _updateUI();

  const chatInput = document.getElementById('chat-input');
  _speech.onInterimTranscript = (text) => {
    if (chatInput) {
      chatInput.value = text;
      chatInput.dispatchEvent(new Event('input'));
    }
  };

  _speech.onTranscript = (text) => {
    _receivedTranscript = true;
    if (_rallyMode) {
      _sendMessage(text);
    } else if (chatInput) {
      chatInput.value = text;
      chatInput.dispatchEvent(new Event('input'));
      chatInput.focus();
    }
    _updateUI();
  };

  _speech.onListeningEnd = () => {
    // 録音終了時、一度も文字が認識されていなければ（＝タイムアウトなど）、ラリーモードを解除する
    if (!_receivedTranscript && _rallyMode) {
      console.log('[VoiceManager] 無音タイムアウトのためラリーモードを終了します');
      _rallyMode = false;
    }
    _updateUI();
  };
}

async function _toggleRallyMode() {
  _rallyMode = !_rallyMode;
  if (_rallyMode) {
    if (!_speech.isListening && !_speech.isSpeaking) {
      await startListeningOnce();
    }
  } else {
    if (_speech.isListening) {
      _speech.stopListening();
    }
  }
  _updateUI();
}

function _registerListeners() {
  _micBtn.addEventListener('contextmenu', (e) => e.preventDefault());

  // iOS Safari の絵文字長押し（文字情報・コールアウト）を抑制し pointercancel を防ぐ
  _micBtn.addEventListener('touchstart', (e) => { e.preventDefault(); }, { passive: false });

  _micBtn.addEventListener('pointerdown', () => {
    if (_micBtn.disabled) return;
    _speech.startNoiseMonitoring();
    _longPressTriggered = false;
    _longPressTimer = setTimeout(() => {
      _longPressTimer     = null;
      _longPressTriggered = true;
      _toggleRallyMode();
    }, 600);
  });

  _micBtn.addEventListener('pointerup', () => {
    if (_longPressTimer !== null) { clearTimeout(_longPressTimer); _longPressTimer = null; }
    if (_longPressTriggered) return;

    // 通常のクリック：録音の開始/停止、またはラリーモードの終了
    if (_speech.isListening) {
      _speech.stopListening();
    } else {
      if (_rallyMode) {
        _toggleRallyMode(); // ラリーモード中ならラリーを終了
      } else {
        startListeningOnce().catch(console.error);
      }
    }
    _updateUI();
  });

  _micBtn.addEventListener('pointerleave', () => {
    if (_longPressTimer !== null) { clearTimeout(_longPressTimer); _longPressTimer = null; }
  });

  _micBtn.addEventListener('pointercancel', () => {
    if (_longPressTimer !== null) { clearTimeout(_longPressTimer); _longPressTimer = null; }
  });
}
