import { initUiUtils, appendMessage, setStatusTemp, updateUserAvatars } from './uiUtils.js';
import {
  initVRMManager, getAiAvatarUrl, loadInitialVRM,
  getVrmaEmotionMap, resolveVrmaUrl,
} from './vrmManager.js';
import { initChatManager, sendMessage } from './chatManager.js';
import { initVoiceManager } from './voiceManager.js';
import { initSettingsManager, applySettings, saveSettings } from './settingsManager.js';
import {
  initHistorySync, getAutoSaveEnabled, scheduleHistorySave, loadHistoryAndProfile,
} from './historySync.js';
import { initLocationManager, applyLocationIfEnabled, getLocationEnabled } from './locationManager.js';
import { initDriveUI, showReauthToast, updateDriveSyncUI } from './driveUI.js';
import { initPlatformUtils } from './platformUtils.js';

export async function initApp({ viewer, llm, speech, lipSync, driveSync, storage, local, canvas }) {
  const chatMessages = document.getElementById('chat-messages');
  const statusEl     = document.getElementById('status-indicator');
  const chatInput    = document.getElementById('chat-input');
  const sendBtn      = document.getElementById('send-btn');
  const micBtn       = document.getElementById('mic-btn');

  // ---- モジュール初期化 ----
  initUiUtils({ chatMessages, statusEl, chatInput, sendBtn, micBtn, driveSync, getAiAvatarUrl, speech });

  initHistorySync({ llm, storage });

  initLocationManager({ llm, saveSettings });

  initVRMManager({ viewer, storage, llm, canvas, saveSettings });

  initChatManager({
    viewer, llm, speech, lipSync, driveSync,
    scheduleHistorySave, getVrmaEmotionMap, resolveVrmaUrl,
  });

  initVoiceManager({ speech, llm, micBtn, sendBtn, sendMessage });

  initSettingsManager({ viewer, llm, speech, driveSync, storage });

  initDriveUI({ driveSync, storage, llm, speech, viewer });

  initPlatformUtils({ viewer });

  // ---- 起動シーケンス ----
  await local.init();

  // Drive 初期化中に onSignInChange が発火しても UI のみ更新し、
  // 設定読み込みは initApp 側で一元管理する（二重読み込みの競合を防ぐ）
  const _postInitCallback = driveSync.onSignInChange;
  driveSync.onSignInChange = (isSignedIn) => {
    updateDriveSyncUI(isSignedIn);
    if (isSignedIn) updateUserAvatars();
  };

  await driveSync.init().catch(err => console.warn('Drive sync init:', err));

  driveSync.onSignInChange = _postInitCallback;

  // サイレント復元が失敗し、過去のアカウント情報がある場合は再ログインを促す
  if (!driveSync.isSignedIn && driveSync.email) {
    showReauthToast(driveSync.email);
  }

  // 設定を読み込んで全モジュールに適用
  const saved = await storage.loadSettings().catch(() => null);
  applySettings(saved);

  // プロファイルと会話履歴の非同期ロード（UIをブロックしない）
  loadHistoryAndProfile({
    storage,
    llm,
    chatMessages,
    logPrefix: '起動時',
  });

  applyLocationIfEnabled();
  document.getElementById('location-chk').checked = getLocationEnabled();

  if (driveSync.isSignedIn) {
    document.getElementById('drive-autosave-chk').checked = getAutoSaveEnabled();
    const driveStatus = document.getElementById('drive-status');
    if (saved) {
      setStatusTemp(driveStatus, '✅ Drive から設定を読み込みました');
    } else {
      driveStatus.textContent = '⚠️ Drive に設定がまだ保存されていません';
    }
  }

  // VRM を起動時にロード
  await loadInitialVRM();
}
