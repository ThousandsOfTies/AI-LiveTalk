import { setStatus } from './uiUtils.js';
import { setOnPipelineEnd, stopPipeline } from './chatManager.js';

const SVG = {
  mic: `<svg viewBox="0 0 24 24" width="30" height="30" xmlns="http://www.w3.org/2000/svg" style="pointer-events:none">
    <circle cx="12" cy="12" r="8" fill="#e74c3c"/>
  </svg>`,

  rally: `<svg viewBox="0 0 24 24" width="30" height="30" xmlns="http://www.w3.org/2000/svg" fill="none" style="pointer-events:none">
    <circle cx="12" cy="12" r="6" fill="#e74c3c"/>
    <path d="M12 3 A9 9 0 1 1 4.21 7.5" stroke="#e74c3c" stroke-width="2.2" stroke-linecap="round"/>
    <polygon points="6,4.5 7.2,9.25 1.2,5.75" fill="#e74c3c"/>
  </svg>`,

  camera: `<svg viewBox="0 0 24 24" width="30" height="30" xmlns="http://www.w3.org/2000/svg" fill="none" style="pointer-events:none">
    <rect x="1.5" y="5" width="21" height="14" rx="3" fill="#2a2a3a" stroke="#888" stroke-width="1.5"/>
    <circle cx="12" cy="12" r="4.5" stroke="white" stroke-width="2"/>
    <circle cx="12" cy="12" r="1.5" fill="white"/>
  </svg>`,

  gallery: `<svg viewBox="0 0 24 24" width="30" height="30" xmlns="http://www.w3.org/2000/svg" fill="none" style="pointer-events:none">
    <rect x="2" y="4.5" width="20" height="15" rx="2.5" fill="#1e1e38" stroke="#aaa" stroke-width="1.6"/>
    <circle cx="7.5" cy="9.5" r="2" fill="#aaa"/>
    <path d="M2 16.5 L8.5 10 L13.5 15 L17 11.5 L22 16.5" stroke="#aaa" stroke-width="1.8" stroke-linejoin="round"/>
  </svg>`,

  noisy: `<svg viewBox="0 0 24 24" width="30" height="30" xmlns="http://www.w3.org/2000/svg" style="pointer-events:none">
    <text x="12" y="17" text-anchor="middle" font-size="17" fill="white">✦</text>
  </svg>`,
};

let _speech, _llm, _micBtn, _sendBtn, _stopBtn, _sendMessage, _openCamera, _openGallery;
let _inputMode          = 'mic'; // 'mic' | 'rally' | 'camera'
let _longPressTimer     = null;
let _longPressTriggered = false;
let _receivedTranscript = false;

export function initVoiceManager({ speech, llm, micBtn, sendBtn, stopBtn, sendMessage, openCamera, openGallery }) {
  _speech      = speech;
  _llm         = llm;
  _micBtn      = micBtn;
  _sendBtn     = sendBtn;
  _stopBtn     = stopBtn;
  _sendMessage = sendMessage;
  _openCamera  = openCamera;
  _openGallery = openGallery;

  _stopBtn.addEventListener('click', () => {
    stopPipeline();
    _updateUI();
  });

  if (!speech.sttSupported) {
    _micBtn.disabled = true;
    _micBtn.title    = 'このブラウザは音声認識に非対応です';
  }

  setOnPipelineEnd(() => {
    if (_inputMode === 'rally' && !_speech.isSpeaking && !_speech.isListening) {
      startListeningOnce();
    }
  });

  _speech.onSpeechStart = () => { _updateUI(); };
  _speech.onSpeechEnd   = () => {
    if (_inputMode === 'rally' && !_speech.isListening) startListeningOnce();
    _updateUI();
  };
  _speech.onNoiseModeChange = () => { _updateUI(); };

  _initModePicker();
  _registerListeners();
  _updateUI();

  _sendBtn.addEventListener('click', () => {
    _speech.unlockAudio();
    if (_speech.isListening) _speech.stopListening();
  });
}

function _updateUI() {
  const isListening = _speech.isListening;
  const isSpeaking  = _speech.isSpeaking;

  _micBtn.classList.toggle('active',      isListening);
  _micBtn.classList.toggle('auto-listen', _inputMode === 'rally');
  _micBtn.classList.toggle('noisy-mode',  _speech.isNoisy);

  if (isListening && _speech.isNoisy) {
    _micBtn.innerHTML = SVG.noisy;
  } else if (_inputMode === 'rally') {
    _micBtn.innerHTML = SVG.rally;
  } else if (_inputMode === 'camera') {
    _micBtn.innerHTML = SVG.camera;
  } else if (_inputMode === 'gallery') {
    _micBtn.innerHTML = SVG.gallery;
  } else {
    _micBtn.innerHTML = SVG.mic;
  }

  _micBtn.disabled  = isSpeaking;
  _sendBtn.disabled = isSpeaking;

  // AIが喋っている間だけ停止ボタンを表示し、送信ボタンを隠す
  _stopBtn.classList.toggle('hidden', !isSpeaking);
  _sendBtn.classList.toggle('hidden', isSpeaking);

  if (isListening) {
    setStatus(_speech.isNoisy ? '✦ 高精度認識中...' : '🎤 聞いています...');
    _micBtn.title = '音声入力中 (クリックで停止)';
  } else if (isSpeaking) {
    setStatus('AI 発話中...');
    _micBtn.title = 'AI発話中 (操作不可)';
  } else if (_inputMode === 'rally') {
    setStatus('会話モード ON');
    _micBtn.title = '会話モード中 (長押しでモード切替)';
  } else if (_inputMode === 'camera') {
    setStatus('カメラモード');
    _micBtn.title = 'カメラモード (長押しでモード切替)';
  } else {
    setStatus('');
    _micBtn.title = '音声入力 (長押しでモード切替)';
  }

  const chatInput = document.getElementById('chat-input');
  if (chatInput) chatInput.classList.toggle('recording', isListening);
}

export async function startListeningOnce() {
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
    if (text.trim()) _sendMessage(text);
    _updateUI();
  };

  _speech.onListeningEnd = () => {
    if (!_receivedTranscript && _inputMode === 'rally') {
      console.log('[VoiceManager] 無音タイムアウトのためラリーモードを終了します');
      _inputMode = 'mic';
    }
    _updateUI();
  };
}

function _setMode(mode) {
  const wasRally = _inputMode === 'rally';
  _inputMode = mode;

  if (wasRally && mode !== 'rally' && _speech.isListening) {
    _speech.stopListening();
  }
  if (mode === 'rally' && !_speech.isListening && !_speech.isSpeaking) {
    startListeningOnce();
  }

  _updateUI();
  _hideModePicker();
}

function _initModePicker() {
  const picker = document.getElementById('input-mode-picker');
  picker.querySelectorAll('.mode-option').forEach(btn => {
    btn.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      _setMode(btn.dataset.mode);
    });
  });

  document.addEventListener('pointerdown', (e) => {
    if (!picker.classList.contains('hidden') &&
        !picker.contains(e.target) &&
        e.target !== _micBtn) {
      _hideModePicker();
    }
  });
}

function _showModePicker() {
  const picker = document.getElementById('input-mode-picker');
  picker.querySelectorAll('.mode-option').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === _inputMode);
  });
  picker.classList.remove('hidden');
}

function _hideModePicker() {
  document.getElementById('input-mode-picker').classList.add('hidden');
}

function _registerListeners() {
  _micBtn.addEventListener('contextmenu', (e) => e.preventDefault());
  _micBtn.addEventListener('touchstart',  (e) => { e.preventDefault(); }, { passive: false });

  _micBtn.addEventListener('pointerdown', () => {
    if (_micBtn.disabled) return;
    _speech.unlockAudio();
    _speech.startNoiseMonitoring();
    _longPressTriggered = false;
    _longPressTimer = setTimeout(() => {
      _longPressTimer     = null;
      _longPressTriggered = true;
      _showModePicker();
    }, 600);
  });

  _micBtn.addEventListener('pointerup', () => {
    if (_longPressTimer !== null) { clearTimeout(_longPressTimer); _longPressTimer = null; }
    if (_longPressTriggered) return;

    if (_inputMode === 'camera') {
      _openCamera?.();
      return;
    }
    if (_inputMode === 'gallery') {
      _openGallery?.();
      return;
    }

    if (_speech.isListening) {
      if (_inputMode === 'rally') {
        _setMode('mic');
      } else {
        _speech.stopListening();
      }
    } else {
      if (_inputMode === 'rally') {
        _setMode('mic');
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
