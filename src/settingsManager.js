import { setStatus } from './uiUtils.js';
import {
  getVrmState, setCurrentVrmSystemPrompt, refreshVRMList, loadBuiltinVRM,
  loadDefaultVRMA, loadVrmFromStorage,
  applySettings as vrmApplySettings, applyPersonaDataToVRM,
} from './vrmManager.js';
import {
  getAutoSaveEnabled, setAutoSaveEnabled, cancelAutoSave,
  applySettings as historyApplySettings,
} from './historySync.js';
import { getLocationEnabled, applySettings as locationApplySettings } from './locationManager.js';
import {
  getCurrentPersona, setCurrentPersona, getPersonaData, updatePersonaData,
  resetToDefaults as personaResetToDefaults,
  applySettings as personaApplySettings,
  collectSettings as personaCollectSettings,
} from './personaManager.js';
import { LLMClient, DEFAULT_MALE_SYSTEM_PROMPT } from './llm-client.js';
import { BUILTIN_FEMALE_ID, BUILTIN_MALE_ID } from './constants.js';
import { provideGeminiApiKey } from './gemini-key-bridge.js';

const GEMINI_LLM_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/openai/';

let _viewer, _llm, _speech, _driveSync, _storage;
let _saveSettingsTimer = null;
let _closeKeyBridge = null;

export function initSettingsManager({ viewer, llm, speech, driveSync, storage }) {
  _viewer    = viewer;
  _llm       = llm;
  _speech    = speech;
  _driveSync = driveSync;
  _storage   = storage;

  _closeKeyBridge?.();
  _closeKeyBridge = provideGeminiApiKey(() => {
    const panel = document.getElementById('settings-panel');
    return panel && !panel.classList.contains('hidden')
      ? document.getElementById('setting-api-key').value
      : _llm.apiKey;
  });

  // タブ切り替え
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    });
  });

  document.getElementById('sex-toggle').addEventListener('click', (e) => {
    const btn = e.target.closest('.sex-btn');
    if (!btn || btn.classList.contains('active')) return;
    switchPersona();
  });
  _updatePersonaToggle();
  document.getElementById('settings-btn').addEventListener('click', _openSettings);
  document.getElementById('save-settings-btn').addEventListener('click', _saveSettingsHandler);
  document.getElementById('cancel-settings-btn').addEventListener('click', _cancelSettings);
  document.getElementById('clear-history-btn').addEventListener('click', _clearHistory);

  // Drive 自動保存チェックボックス
  document.getElementById('drive-autosave-chk').addEventListener('change', (e) => {
    setAutoSaveEnabled(e.target.checked);
    saveSettings();
    if (!e.target.checked) cancelAutoSave();
  });

  _registerSliderListeners();
}

// ---- Public API ----
export function getArmCorr()      { return getPersonaData().armCorrection; }
export function getShoulderCorr() { return getPersonaData().shoulderCorrection; }
export function getChestCorr()    { return getPersonaData().chestCorrection; }

export function applyBackground(path) {
  const panel = document.getElementById('viewer-panel');
  panel.style.background = path
    ? `url('${import.meta.env.BASE_URL}${path}') center center / cover no-repeat, linear-gradient(160deg, #12122a 0%, #0d1526 100%)`
    : '';
}

export async function switchPersona() {
  const next = getCurrentPersona() === 'female' ? 'male' : 'female';
  setCurrentPersona(next);
  applyPersonaDataToVRM();
  const d  = getPersonaData();
  const ss = _speech.getSettings();
  _speech.updateGeminiSettings(_llm.apiKey, ss.gemini_tts_model, d.geminiVoiceId, d.geminiStyle);
  _viewer.setVRMArmCorrection(d.armCorrection);
  _viewer.setVRMAShoulderCorrection(d.shoulderCorrection);
  _viewer.setVRMAChestCorrection(d.chestCorrection);
  applyBackground(d.background);

  const isBuiltin = d.selectedVrmId === BUILTIN_FEMALE_ID || d.selectedVrmId === BUILTIN_MALE_ID;
  if (isBuiltin) {
    await loadBuiltinVRM();
  } else {
    try {
      await loadVrmFromStorage(d.selectedVrmId);
      setStatus('');
      await loadDefaultVRMA(true);
    } catch (err) {
      console.warn('VRM読み込み失敗、ビルトインに戻します:', err.message);
      await loadBuiltinVRM();
    }
  }
  _updatePersonaToggle();
  saveSettings();
}

export function collectSettings() {
  const vrmState = getVrmState();
  return {
    ..._llm.getSettings(),
    ..._speech.getSettings(),
    ...personaCollectSettings(),
    autosave_history:   String(getAutoSaveEnabled()),
    location_enabled:   String(getLocationEnabled()),
    vrm_char_names:     JSON.stringify(vrmState.charNames),
    vrm_system_prompts: JSON.stringify(vrmState.systemPrompts),
  };
}

export function saveSettings() {
  clearTimeout(_saveSettingsTimer);
  _saveSettingsTimer = setTimeout(() => {
    _storage.saveSettings(collectSettings()).catch(err =>
      console.warn('設定保存失敗:', err.message)
    );
  }, 500);
}

export function applySettings(s) {
  if (!s) {
    historyApplySettings(null);
    return;
  }
  personaApplySettings(s);
  // 旧設定にキーが複数ある場合、保存済み Voice ID と同じプロジェクトの TTS キーを優先する。
  const hasCustomVoice = ['female', 'male'].some(persona => getPersonaData(persona).geminiVoiceId);
  const sharedKey = (hasCustomVoice && s.gemini_tts_api_key)
    || s.llm_api_key || s.gemini_tts_api_key || s.stt_api_key || '';
  _llm.applySettings({ ...s, llm_endpoint: GEMINI_LLM_ENDPOINT, llm_api_key: sharedKey });
  _speech.applySettings(s);
  historyApplySettings(s);
  locationApplySettings(s);
  vrmApplySettings(s);

  const d = getPersonaData();
  _speech.updateGeminiSettings(sharedKey, s.gemini_tts_model, d.geminiVoiceId, d.geminiStyle);
  _viewer.setVRMArmCorrection(d.armCorrection);
  _viewer.setVRMAShoulderCorrection(d.shoulderCorrection);
  _viewer.setVRMAChestCorrection(d.chestCorrection);
  applyBackground(d.background);
  applyPersonaDataToVRM();
  _updatePersonaToggle();
}

export function resetToDefaults() {
  console.log('[Sync] 全ての状態をデフォルトにリセットします...');
  personaResetToDefaults();
  historyApplySettings({ autosave_history: 'true' });
  locationApplySettings({ location_enabled: 'false' });
  vrmApplySettings({ vrm_char_names: '{}', vrm_system_prompts: '{}' });
  _llm.applySettings({ llm_endpoint: GEMINI_LLM_ENDPOINT, llm_api_key: '' });
  _llm.apiKey = '';
  _speech.applySettings({});
  _llm.clearHistory();
  _llm.userProfile = [];

  const d = getPersonaData();
  _speech.updateGeminiSettings('', 'gemini-3.8-flash-lite-tts', d.geminiVoiceId, d.geminiStyle);
  _viewer.setVRMArmCorrection(d.armCorrection);
  _viewer.setVRMAShoulderCorrection(d.shoulderCorrection);
  _viewer.setVRMAChestCorrection(d.chestCorrection);
  applyBackground(d.background);
  applyPersonaDataToVRM();

  document.getElementById('chat-messages').innerHTML = '';
  const spEl = document.getElementById('setting-system-prompt');
  if (spEl) spEl.value = '';
  const upEl = document.getElementById('setting-user-profile');
  if (upEl) upEl.value = '';

  // 設定パネルが開いているなら同期
  if (!document.getElementById('settings-panel').classList.contains('hidden')) {
    refreshSettingsPanel();
  }

  loadBuiltinVRM().catch(e => console.warn('Reset VRM failed:', e));
}

/**
 * 設定パネルの全フィールドを現在の状態に同期する（パネルの開閉は制御しない）。
 * _openSettings() / resetToDefaults() / driveUI から呼ばれる。
 */
export function refreshSettingsPanel() {
  const vrmState = getVrmState();
  document.getElementById('setting-api-key').value       = _llm.apiKey;
  document.getElementById('setting-model').value         = _llm.model;
  document.getElementById('setting-max-context-turns').value = _llm.maxContextTurns;
  document.getElementById('setting-system-prompt').value =
    vrmState.systemPrompts[vrmState.currentVrmId] ?? _llm.systemPrompt;
  document.getElementById('setting-tts-lang').value      = _llm.ttsLang;

  const ss = _speech.getSettings();
  document.getElementById('setting-stt-model').value    = ss.stt_model || '';

  const d = getPersonaData();
  document.getElementById('setting-gemini-tts-model').value = ss.gemini_tts_model || 'gemini-3.8-flash-tts';
  document.getElementById('setting-gemini-voice-id').value = d.geminiVoiceId || '';
  document.getElementById('setting-gemini-style').value = d.geminiStyle || '';

  const indEl = document.getElementById('voice-sex-indicator');
  if (indEl) indEl.textContent = getCurrentPersona() === 'female' ? '♀ 女性キャラの音声設定' : '♂ 男性キャラの音声設定';


  const armCorr = d.armCorrection;
  document.getElementById('setting-arm-correction').value     = armCorr;
  document.getElementById('setting-arm-correction-num').value = armCorr;
  _viewer.setVRMArmCorrection(armCorr);

  const shCorr = d.shoulderCorrection;
  document.getElementById('setting-shoulder-correction').value     = shCorr;
  document.getElementById('setting-shoulder-correction-num').value = shCorr;
  _viewer.setVRMAShoulderCorrection(shCorr);

  const chCorr = d.chestCorrection;
  document.getElementById('setting-chest-correction').value     = chCorr;
  document.getElementById('setting-chest-correction-num').value = chCorr;
  _viewer.setVRMAChestCorrection(chCorr);

  if (_driveSync.isSignedIn) {
    document.getElementById('drive-autosave-chk').checked = getAutoSaveEnabled();
  }

  document.getElementById('location-chk').checked = getLocationEnabled();
  document.getElementById('location-status').textContent =
    getLocationEnabled() && _llm.locationContext ? `✅ ${_llm.locationContext}` : '';

  document.getElementById('setting-user-profile').value =
    _llm.userProfile ? _llm.userProfile.join('\n') : '';

  const proactiveChk = document.getElementById('setting-proactive-mode');
  if (proactiveChk) proactiveChk.checked = d.isProactive || false;
}

// ---- Private handlers ----
function _openSettings() {
  const settingsPanel = document.getElementById('settings-panel');
  settingsPanel.classList.toggle('hidden');
  if (settingsPanel.classList.contains('hidden')) return;
  refreshSettingsPanel();
  refreshVRMList();
}

function _saveSettingsHandler() {
  const geminiModel = document.getElementById('setting-gemini-tts-model').value;
  const geminiVoiceId = document.getElementById('setting-gemini-voice-id').value.trim();
  const geminiStyle = document.getElementById('setting-gemini-style').value.trim();
  _llm.endpoint = GEMINI_LLM_ENDPOINT;
  _llm.apiKey   = document.getElementById('setting-api-key').value.trim();
  _llm.model    = document.getElementById('setting-model').value.trim();
  _llm.maxContextTurns = Math.max(0, Math.min(100,
    Number.parseInt(document.getElementById('setting-max-context-turns').value, 10) || 0
  ));

  const rawPrompt = document.getElementById('setting-system-prompt').value.trim();
  if (!rawPrompt) {
    const isMale = getCurrentPersona() === 'male';
    _llm.systemPrompt = isMale ? DEFAULT_MALE_SYSTEM_PROMPT : LLMClient.DEFAULT_SYSTEM_PROMPT;
    document.getElementById('setting-system-prompt').value = _llm.systemPrompt;
    setStatus('システムプロンプトをデフォルトに戻しました');
  } else {
    _llm.systemPrompt = rawPrompt;
  }
  setCurrentVrmSystemPrompt(_llm.systemPrompt);
  _llm.ttsLang = document.getElementById('setting-tts-lang').value;

  const armCorrection      = parseFloat(document.getElementById('setting-arm-correction-num').value)      || 0;
  const shoulderCorrection = parseFloat(document.getElementById('setting-shoulder-correction-num').value) || 0;
  const chestCorrection    = parseFloat(document.getElementById('setting-chest-correction-num').value)    || 0;
  _viewer.setVRMArmCorrection(armCorrection);
  _viewer.setVRMAShoulderCorrection(shoulderCorrection);
  _viewer.setVRMAChestCorrection(chestCorrection);
  updatePersonaData(getCurrentPersona(), { armCorrection, shoulderCorrection, chestCorrection });

  const proactiveMode = document.getElementById('setting-proactive-mode')?.checked ?? false;
  updatePersonaData(getCurrentPersona(), { isProactive: proactiveMode, geminiVoiceId, geminiStyle });
  _speech.updateSttModel(document.getElementById('setting-stt-model').value);
  _speech.updateGeminiSettings(_llm.apiKey, geminiModel, geminiVoiceId, geminiStyle);

  const profileText = document.getElementById('setting-user-profile').value;
  if (profileText !== undefined) {
    const newProfile = profileText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (JSON.stringify(_llm.userProfile) !== JSON.stringify(newProfile)) {
      _llm.userProfile = newProfile;
      if (_driveSync.isSignedIn) {
        _driveSync.saveUserProfile(_llm.userProfile).catch(e => console.warn('手動プロファイル保存失敗:', e));
      } else if (typeof _storage._b?.saveUserProfile === 'function') {
        _storage._b.saveUserProfile(_llm.userProfile);
      }
      console.log('✅ プロファイルを手動で更新しました:', _llm.userProfile);
    }
  }

  saveSettings();
  document.getElementById('settings-panel').classList.add('hidden');
  setStatus('設定を保存しました');
}

function _cancelSettings() {
  document.getElementById('settings-panel').classList.add('hidden');
  const d = getPersonaData();
  _viewer.setVRMArmCorrection(d.armCorrection);
  _viewer.setVRMAShoulderCorrection(d.shoulderCorrection);
  _viewer.setVRMAChestCorrection(d.chestCorrection);
}

async function _clearHistory() {
  _llm.clearHistory();
  document.getElementById('chat-messages').innerHTML = '';
  cancelAutoSave();
  // ストレージにも空履歴を書き込む（再起動後の復元を防ぐ）
  await _storage.saveHistory([]).catch(err => console.warn('履歴クリア保存失敗:', err));
  setStatus('会話履歴をクリアしました');
  document.getElementById('settings-panel').classList.add('hidden');
}

function _registerSliderListeners() {
  const pairs = [
    ['setting-arm-correction',      'setting-arm-correction-num',      v => _viewer.setVRMArmCorrection(v)],
    ['setting-shoulder-correction', 'setting-shoulder-correction-num', v => _viewer.setVRMAShoulderCorrection(v)],
    ['setting-chest-correction',    'setting-chest-correction-num',    v => _viewer.setVRMAChestCorrection(v)],
  ];
  for (const [sliderId, numId, apply] of pairs) {
    document.getElementById(sliderId).addEventListener('input', (e) => {
      document.getElementById(numId).value = e.target.value;
      apply(parseFloat(e.target.value) || 0);
    });
    document.getElementById(numId).addEventListener('input', (e) => {
      const v = Math.max(-90, Math.min(90, parseFloat(e.target.value) || 0));
      document.getElementById(sliderId).value = v;
      apply(v);
    });
  }
}

function _updatePersonaToggle() {
  const persona = getCurrentPersona();
  document.querySelectorAll('.sex-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.sex === persona);
  });
}
