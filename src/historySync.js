import { appendMessage, setStatusTemp } from './uiUtils.js';

let _llm, _storage;
let _autoSaveEnabled = false;
let _autoSaveTimer   = null;

export function initHistorySync({ llm, storage }) {
  _llm     = llm;
  _storage = storage;

  window.addEventListener('beforeunload', () => {
    console.log('[HistorySync] 画面遷移(beforeunload)を検知しました');
    _forceSaveOnExit();
  });
  window.addEventListener('pagehide', () => {
    console.log('[HistorySync] 画面非表示(pagehide)を検知しました');
    _forceSaveOnExit();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      console.log('[HistorySync] バックグラウンド移行(visibilitychange)を検知しました');
      _forceSaveOnExit();
    }
  });
}

export function getAutoSaveEnabled() { return _autoSaveEnabled; }
export function setAutoSaveEnabled(val) { _autoSaveEnabled = val; }
export function cancelAutoSave() { clearTimeout(_autoSaveTimer); }

export function applySettings(s) {
  if (!s) {
    _autoSaveEnabled = true;
    return;
  }
  if (s.autosave_history !== undefined) {
    _autoSaveEnabled = s.autosave_history === 'true';
  } else {
    _autoSaveEnabled = true;
  }
}

export function scheduleHistorySave() {
  if (!_autoSaveEnabled) {
    console.log('[HistorySync] 保存: 自動保存がOFFのためスキップ');
    return;
  }
  clearTimeout(_autoSaveTimer);
  _autoSaveTimer = setTimeout(async () => {
    try {
      console.log(`[HistorySync] 保存実行中... (現在の履歴件数: ${_llm.history.length})`);
      await _storage.saveHistory(_llm.history);
      console.log('[HistorySync] 履歴の保存が正常に完了しました!');
      setStatusTemp(document.getElementById('status-indicator'), '履歴を自動保存しました');
    } catch (err) {
      console.error('[HistorySync] 履歴の自動保存エラー:', err.message);
    }
  }, 2000);
}

/**
 * プロファイルと会話履歴を storage から読み込み、llm と chatMessages に反映する。
 * 起動時と Drive サインイン後の両方で共通して使用する。
 *
 * @param {object} options
 * @param {import('./app-storage.js').AppStorage} options.storage
 * @param {import('./llm-client.js').LLMClient}   options.llm
 * @param {HTMLElement}                            options.chatMessages
 * @param {boolean}  [options.replaceHistory=false]  true の場合は既存の履歴を置き換える (Driveサインイン後)
 * @param {function} [options.loadUserProfile]        storage と異なるプロファイル読み込み関数を差し替える場合
 * @param {string}   [options.logPrefix='起動時']     コンソールログのプレフィックス
 */
export async function loadHistoryAndProfile({
  storage,
  llm,
  chatMessages,
  replaceHistory = false,
  loadUserProfile = null,
  logPrefix = '起動時',
}) {
  // ---- プロファイル読み込み ----
  try {
    console.log(`[HistorySync] ${logPrefix}: プロファイル読み込み処理を開始します...`);
    const profileFn = loadUserProfile
      ?? (typeof storage._b?.loadUserProfile === 'function'
          ? () => storage._b.loadUserProfile()
          : () => Promise.resolve(null));
    const profileInfo = await profileFn().catch(() => null);

    if (profileInfo && Array.isArray(profileInfo)) {
      llm.userProfile = profileInfo;
      console.log(`[HistorySync] ${logPrefix}: プロファイルを復元しました`, profileInfo);
    } else {
      console.log(`[HistorySync] ${logPrefix}: 保存されたプロファイルは見つかりませんでした`);
    }
  } catch (e) {
    console.error(`[HistorySync] ${logPrefix}: プロファイル読み込みエラー`, e);
  }

  // ---- 会話履歴読み込み ----
  if (!_autoSaveEnabled) {
    console.log(`[HistorySync] ${logPrefix}: 自動保存設定がOFFのため、履歴の復元をスキップします`);
    return;
  }
  try {
    console.log(`[HistorySync] ${logPrefix}: 会話履歴の読み込み処理を開始します...`);
    const hist = await storage.loadHistory();
    if (hist && Array.isArray(hist.messages)) {
      console.log(`[HistorySync] ${logPrefix}: 会話履歴を受信しました (API取得件数: ${hist.messages.length}件)`);
      const pastMsgs = hist.messages.filter(m => m.role === 'user' || m.role === 'assistant');
      if (pastMsgs.length > 0) {
        llm.history = replaceHistory ? pastMsgs : [...pastMsgs, ...llm.history];
        chatMessages.innerHTML = '';
        for (const msg of llm.history) appendMessage(msg.role, msg.content, true);
        console.log(`[HistorySync] ${logPrefix}: 会話履歴をUIへマージ・反映完了 (最終件数: ${llm.history.length}件)`);
      } else {
        console.log(`[HistorySync] ${logPrefix}: 受信したデータに有効な発言が含まれていませんでした`);
      }
    } else {
      console.log(`[HistorySync] ${logPrefix}: クラウドまたはローカルに保存された履歴データが存在しませんでした`);
    }
  } catch (e) {
    console.error(`[HistorySync] ${logPrefix}: 会話履歴読み込みエラー`, e);
  }
}

function _forceSaveOnExit() {
  if (_autoSaveEnabled && _llm.history.length > 0) {
    console.log(`[HistorySync] 退避のための即時保存を実行します (件数: ${_llm.history.length})`);
    _storage.saveHistory(_llm.history);
  }
}
