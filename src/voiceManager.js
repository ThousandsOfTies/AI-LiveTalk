import { setStatus } from './uiUtils.js';
import { setOnPipelineEnd, stopPipeline } from './chatManager.js';

const MODE = {
  MIC:     'mic',
  RALLY:   'rally',
  CAMERA:  'camera',
  GALLERY: 'gallery',
};

const LONG_PRESS_MS = 600;

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

const STATUS_BY_MODE = {
  [MODE.RALLY]:   '会話モード ON',
  [MODE.CAMERA]:  'カメラモード',
  [MODE.GALLERY]: 'ギャラリーモード',
};

const TITLE_BY_MODE = {
  [MODE.MIC]:     '音声入力 (長押しでモード切替)',
  [MODE.RALLY]:   '会話モード中 (長押しでモード切替)',
  [MODE.CAMERA]:  'カメラモード (長押しでモード切替)',
  [MODE.GALLERY]: 'ギャラリーモード (長押しでモード切替)',
};

let _speech, _llm, _micBtn, _sendBtn, _stopBtn, _sendMessage, _openCamera, _openGallery;
let _chatInput, _picker, _modeOptions;
let _inputMode          = MODE.MIC;
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

  _chatInput   = document.getElementById('chat-input');
  _picker      = document.getElementById('input-mode-picker');
  _modeOptions = _picker.querySelectorAll('.mode-option');

  _stopBtn.addEventListener('click', () => {
    stopPipeline();
    _updateUI();
  });

  if (!speech.sttSupported) {
    _micBtn.disabled = true;
    _micBtn.title    = 'このブラウザは音声認識に非対応です';
  }

  setOnPipelineEnd(() => {
    if (_inputMode === MODE.RALLY && !_speech.isSpeaking && !_speech.isListening) {
      startListeningOnce();
    }
  });

  _speech.onSpeechStart = _updateUI;
  _speech.onSpeechEnd   = () => {
    if (_inputMode === MODE.RALLY && !_speech.isListening) startListeningOnce();
    _updateUI();
  };
  _speech.onNoiseModeChange = _updateUI;

  _initModePicker();
  _registerListeners();
  _updateUI();

  _sendBtn.addEventListener('click', () => {
    _speech.unlockAudio();
    if (_speech.isListening) _speech.stopListening();
  });
}

function _pickIcon(isListening) {
  if (isListening && _speech.isNoisy) return SVG.noisy;
  if (_inputMode === MODE.RALLY)      return SVG.rally;
  if (_inputMode === MODE.CAMERA)     return SVG.camera;
  if (_inputMode === MODE.GALLERY)    return SVG.gallery;
  return SVG.mic;
}

function _updateUI() {
  const isListening = _speech.isListening;
  const isSpeaking  = _speech.isSpeaking;

  _micBtn.classList.toggle('active',      isListening);
  _micBtn.classList.toggle('auto-listen', _inputMode === MODE.RALLY);
  _micBtn.classList.toggle('noisy-mode',  _speech.isNoisy);
  _micBtn.innerHTML = _pickIcon(isListening);

  _micBtn.disabled  = isSpeaking;
  _sendBtn.disabled = isSpeaking;
  _stopBtn.classList.toggle('hidden', !isSpeaking);
  _sendBtn.classList.toggle('hidden', isSpeaking);

  if (isListening) {
    setStatus(_speech.isNoisy ? '✦ 高精度認識中...' : '🎤 聞いています...');
    _micBtn.title = '音声入力中 (クリックで停止)';
  } else if (isSpeaking) {
    setStatus('AI 発話中...');
    _micBtn.title = 'AI発話中 (操作不可)';
  } else {
    setStatus(STATUS_BY_MODE[_inputMode] || '');
    _micBtn.title = TITLE_BY_MODE[_inputMode];
  }

  _chatInput.classList.toggle('recording', isListening);
}

export async function startListeningOnce() {
  if (_speech.isSpeaking) return;
  _receivedTranscript = false;
  _speech.setLang(_llm.ttsLang);
  await _speech.startListening();
  _updateUI();

  _speech.onInterimTranscript = (text) => {
    _chatInput.value = text;
    _chatInput.dispatchEvent(new Event('input'));
  };

  _speech.onTranscript = (text) => {
    _receivedTranscript = true;
    if (text.trim()) _sendMessage(text);
    _updateUI();
  };

  _speech.onListeningEnd = () => {
    if (!_receivedTranscript && _inputMode === MODE.RALLY) {
      console.log('[VoiceManager] 無音タイムアウトのためラリーモードを終了します');
      _inputMode = MODE.MIC;
    }
    _updateUI();
  };
}

function _setMode(mode) {
  const wasRally = _inputMode === MODE.RALLY;
  _inputMode = mode;

  if (wasRally && mode !== MODE.RALLY && _speech.isListening) {
    _speech.stopListening();
  }
  if (mode === MODE.RALLY && !_speech.isListening && !_speech.isSpeaking) {
    startListeningOnce();
  }

  _updateUI();
  _hideModePicker();
}

function _initModePicker() {
  _modeOptions.forEach(btn => {
    btn.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      _setMode(btn.dataset.mode);
    });
  });

  document.addEventListener('pointerdown', (e) => {
    if (!_picker.classList.contains('hidden') &&
        !_picker.contains(e.target) &&
        e.target !== _micBtn) {
      _hideModePicker();
    }
  });
}

function _showModePicker() {
  _modeOptions.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === _inputMode);
  });
  _picker.classList.remove('hidden');
}

function _hideModePicker() {
  _picker.classList.add('hidden');
}

function _clearLongPress() {
  if (_longPressTimer !== null) {
    clearTimeout(_longPressTimer);
    _longPressTimer = null;
  }
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
    }, LONG_PRESS_MS);
  });

  _micBtn.addEventListener('pointerup', () => {
    _clearLongPress();
    if (_longPressTriggered) return;

    if (_inputMode === MODE.CAMERA)  { _openCamera?.();  return; }
    if (_inputMode === MODE.GALLERY) { _openGallery?.(); return; }

    if (_inputMode === MODE.RALLY) {
      _setMode(MODE.MIC);
    } else if (_speech.isListening) {
      _speech.stopListening();
    } else {
      startListeningOnce().catch(console.error);
    }
    _updateUI();
  });

  _micBtn.addEventListener('pointerleave', _clearLongPress);
  _micBtn.addEventListener('pointercancel', _clearLongPress);
}
