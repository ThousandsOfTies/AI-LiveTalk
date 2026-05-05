import { TTSPipeline } from './tts-pipeline.js';
import {
  appendMessage, setStatus, setInputEnabled,
  isNearBottom, scrollToBottom, autoResizeTextarea,
} from './uiUtils.js';
import { getPersonaData } from './personaManager.js';

let _viewer, _llm, _speech, _lipSync, _driveSync;
let _scheduleHistorySave, _getVrmaEmotionMap, _resolveVrmaUrl;
let _chatInput;
let _activePipeline      = null;
let _autoSaveProfileTimer = null;
let _onPipelineEnd        = null;
let _proactiveTimer       = null;

const PROACTIVE_INTERVAL = 300000; // 5分（沈黙とみなす時間）

export function initChatManager({
  viewer, llm, speech, lipSync, driveSync,
  scheduleHistorySave, getVrmaEmotionMap, resolveVrmaUrl,
}) {
  _viewer             = viewer;
  _llm                = llm;
  _speech             = speech;
  _lipSync            = lipSync;
  _driveSync          = driveSync;
  _scheduleHistorySave = scheduleHistorySave;
  _getVrmaEmotionMap  = getVrmaEmotionMap;
  _resolveVrmaUrl     = resolveVrmaUrl;

  _chatInput = document.getElementById('chat-input');

  _llm.onEmotionDetected = (emotion) => {
    _viewer.applyEmotion(emotion);
    setStatus(`感情: ${emotion}`);
    const vrmaMap = _getVrmaEmotionMap();
    const url = _resolveVrmaUrl(vrmaMap[emotion] || vrmaMap.neutral);
    _viewer.loadVRMA(url, { loop: true, isIdle: false }).catch(e => console.warn('感情VRMA再生失敗:', e));
  };

  _llm.onMemoDetected = (memo) => {
    console.log('🕵️‍♂️ プロファイル追加: ', memo);
    if (!_llm.userProfile) _llm.userProfile = [];
    if (!_llm.userProfile.includes(memo)) {
      _llm.userProfile.push(memo);
      if (_llm.userProfile.length > 20) _llm.userProfile.shift();
    }
    if (_driveSync.isSignedIn) {
      clearTimeout(_autoSaveProfileTimer);
      _autoSaveProfileTimer = setTimeout(async () => {
        try {
          await _driveSync.saveUserProfile(_llm.userProfile);
          console.log('✅ UserProfileをGoogle Driveに同期しました。');
        } catch (err) {
          console.warn('プロファイル保存失敗:', err.message);
        }
      }, 5000);
    }
  };

  document.getElementById('send-btn').addEventListener('click', () => sendMessage(_chatInput.value));
  _chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      sendMessage(_chatInput.value);
    }
  });
  _chatInput.addEventListener('input', autoResizeTextarea);

  // 初期タイマー開始
  resetProactiveTimer();
}

/** 自発モード用のタイマーをリセットする */
export function resetProactiveTimer() {
  clearTimeout(_proactiveTimer);
  _proactiveTimer = setTimeout(() => {
    triggerProactiveTalk();
  }, PROACTIVE_INTERVAL);
}

/** 自発的に話しかける */
async function triggerProactiveTalk() {
  const data = getPersonaData();
  if (!data.isProactive) {
    resetProactiveTimer(); // OFFでもタイマーだけは回しておく（ONにした時にすぐ反応できるように）
    return;
  }

  // 誰かが入力中、またはAIが既に喋っている場合はスキップ
  if (_activePipeline || _chatInput.value.trim()) {
    resetProactiveTimer();
    return;
  }

  console.log('🗣 自発モード: 話しかけを開始します...');
  // ユーザーには見えない「システム的な促し」を LLM に送る
  const systemPrompt = "(ユーザーがしばらく沈黙しています。あなたから自然に、短く日本語で話しかけてください。沈黙していたことには触れず、今の状況や軽い世間話、あるいは自分の考えなどを共有してください。)";
  
  try {
    await sendMessage(systemPrompt, { isSystem: true });
  } catch (err) {
    console.warn('自発的な話しかけに失敗:', err);
    resetProactiveTimer();
  }
}

export function setOnPipelineEnd(cb) {
  _onPipelineEnd = cb;
}

export async function sendMessage(text, options = {}) {
  const isSystem = options.isSystem || false;
  text = text.trim();
  if (!text) return;

  // 会話があったのでタイマーリセット
  resetProactiveTimer();

  // iOS Safari の自動再生ブロック回避のため、ユーザージェスチャー直後に AudioContext を解禁
  await _speech.unlockAudio();

  _chatInput.classList.remove('recording');
  _chatInput.value = '';
  autoResizeTextarea();

  if (!isSystem) {
    appendMessage('user', text, true);
  }

  if (!_llm.apiKey) {
    const msg = 'APIキーがまだ設定されていないみたい。右上の設定ボタンから、LLMタブでAPIキーを入れてね！';
    appendMessage('assistant', msg, true);
    _viewer.applyEmotion('neutral');
    const p = new TTSPipeline(_speech);
    p.onSpeechStart = () => { _lipSync.start(); _viewer.startTalking(); };
    p.onSpeechEnd   = () => { 
      _lipSync.stop(); _viewer.stopTalking(); _viewer.resetExpressions(); 
      const vrmaMap = _getVrmaEmotionMap();
      _viewer.loadVRMA(_resolveVrmaUrl(vrmaMap.neutral), { loop: true, isIdle: true }).catch(e => console.warn('待機VRMA再生失敗:', e));
    };
    p.push(msg);
    await p.done({ lang: _llm.ttsLang });
    return;
  }

  const assistantEl = appendMessage('assistant', '', true);
  const textNode    = assistantEl.querySelector('.message-text');

  setStatus('考え中...');
  setInputEnabled(false);

  if (_activePipeline) { _activePipeline.stop(); _activePipeline = null; }
  _lipSync.stop();
  _viewer.stopTalking();

  const pipeline   = new TTSPipeline(_speech);
  _activePipeline  = pipeline;

  pipeline.onSpeechStart = () => {
    _lipSync.start();
    _viewer.startTalking();
    setStatus('話し中...');
  };
  pipeline.onSpeechEnd = () => {
    _lipSync.stop();
    _viewer.stopTalking();
    _viewer.resetExpressions();
    setStatus('');
    const vrmaMap = _getVrmaEmotionMap();
    _viewer.loadVRMA(_resolveVrmaUrl(vrmaMap.neutral), { loop: true, isIdle: true }).catch(e => console.warn('待機VRMA再生失敗:', e));
  };
  pipeline.onSpeechError = (err) => {
    setStatus(`⚠️ TTS エラー: ${err.message}`);
  };

  let fullResponse = '';

  try {
    for await (const chunk of _llm.chat(text)) {
      if (_activePipeline !== pipeline) break;
      const wasNearBottom = isNearBottom();
      fullResponse += chunk;
      pipeline.push(chunk);
      textNode.textContent = fullResponse.replace(/^\s+/, '');
      if (wasNearBottom) scrollToBottom(true);
    }

    const spokenText = fullResponse.trim();
    if (!spokenText) {
      textNode.textContent = '(応答がありませんでした)';
      setStatus('');
      return;
    }
    textNode.textContent = spokenText;

    await pipeline.done({ lang: _llm.ttsLang });
    _scheduleHistorySave();

  } catch (err) {
    textNode.textContent = `エラー: ${err.message}`;
    _viewer.resetExpressions();
    _lipSync.stop();
    _viewer.stopTalking();
    setStatus('エラーが発生しました');
    console.error(err);
  } finally {
    if (_activePipeline === pipeline) _activePipeline = null;
    setInputEnabled(true);
    if (!navigator.maxTouchPoints) _chatInput.focus();
    if (_onPipelineEnd) _onPipelineEnd();
  }
}
