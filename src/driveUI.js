import { updateUserAvatars, appendMessage, setStatus, setStatusTemp } from './uiUtils.js';
import { applySettings, resetToDefaults, applyBackground, refreshSettingsPanel } from './settingsManager.js';
import { applyLocationIfEnabled, getLocationEnabled } from './locationManager.js';
import { getAutoSaveEnabled, loadHistoryAndProfile } from './historySync.js';
import {
  getCurrentVrmId, getVrmSystemPrompts, getVrmFileNames,
  refreshVRMList, loadDefaultVRMA, captureAiAvatar, loadBuiltinVRM, loadVrmFromStorage,
} from './vrmManager.js';
import { getPersonaData } from './personaManager.js';
import { BUILTIN_FEMALE_ID, BUILTIN_MALE_ID } from './constants.js';

let _driveSync, _storage, _llm, _speech, _viewer;

const AVATAR_COLORS = [
  '#F44336','#E91E63','#9C27B0','#673AB7','#3F51B5',
  '#2196F3','#0097A7','#00897B','#43A047','#FB8C00','#F4511E',
];

function _avatarColorFromName(name) {
  if (!name) return '#7a90ff';
  const code = [...name].reduce((s, c) => s + c.charCodeAt(0), 0);
  return AVATAR_COLORS[code % AVATAR_COLORS.length];
}

function _getInitials(name, email) {
  if (name) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return parts[0].slice(0, 2).toUpperCase();
  }
  if (email) return email[0].toUpperCase();
  return '?';
}

export function initDriveUI({ driveSync, storage, llm, speech, viewer }) {
  _driveSync = driveSync;
  _storage   = storage;
  _llm       = llm;
  _speech    = speech;
  _viewer    = viewer;

  driveSync.onSignInChange = _onSignInChange;

  document.getElementById('drive-signin-btn').addEventListener('click', () => {
    try {
      driveSync.signIn();
    } catch (err) {
      document.getElementById('drive-status').textContent = `❌ ${err.message}`;
    }
  });

  document.getElementById('drive-signout-btn').addEventListener('click', () => {
    driveSync.signOut();
    document.getElementById('drive-status').textContent = 'サインアウトしました';
  });
}

export function updateDriveSyncUI(isSignedIn) {
  const driveSigninBtn = document.getElementById('drive-signin-btn');
  const driveUiIn      = document.getElementById('drive-ui-in');
  const img            = document.getElementById('sync-avatar-img');
  const initials       = document.getElementById('sync-avatar-initials');
  const driveStatus    = document.getElementById('drive-status');

  driveSigninBtn.classList.toggle('hidden', isSignedIn);
  driveUiIn.classList.toggle('hidden', !isSignedIn);

  if (isSignedIn) {
    const name  = _driveSync.name;
    const email = _driveSync.email;
    initials.textContent      = _getInitials(name, email);
    initials.style.background = _avatarColorFromName(name || email);
    initials.style.display    = '';

    const pic = _driveSync.picture;
    if (pic) {
      img.src     = pic;
      img.onload  = () => { img.classList.add('loaded'); initials.style.display = 'none'; };
      img.onerror = () => { img.classList.remove('loaded'); initials.style.display = ''; };
    }
  } else {
    img.src = '';
    img.classList.remove('loaded');
    initials.textContent    = '';
    initials.style.display  = '';
    driveStatus.textContent = '';
  }
}

export function showReauthToast(email) {
  if (document.getElementById('reauth-toast')) return;
  const toast = document.createElement('div');
  toast.id = 'reauth-toast';
  Object.assign(toast.style, {
    position:      'fixed',
    top:           '30%',
    left:          '50%',
    transform:     'translateX(-50%)',
    background:    'rgba(0, 0, 0, 0.9)',
    color:         '#fff',
    padding:       '20px 24px',
    borderRadius:  '12px',
    boxShadow:     '0 10px 25px rgba(0,0,0,0.5)',
    zIndex:        '9999',
    display:       'flex',
    flexDirection: 'column',
    alignItems:    'center',
    gap:           '15px',
    width:         '85%',
    maxWidth:      '350px',
    textAlign:     'center',
    fontSize:      '14px',
  });

  const text     = document.createElement('span');
  text.textContent = `Drive同期 (${email}) を再開しますか？`;

  const btn = document.createElement('button');
  btn.textContent = 'はい';
  Object.assign(btn.style, {
    padding: '6px 16px', borderRadius: '20px', border: 'none',
    background: '#4CAF50', color: '#fff', fontWeight: 'bold', cursor: 'pointer',
  });

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  Object.assign(closeBtn.style, {
    background: 'none', border: 'none', color: '#bbb',
    cursor: 'pointer', fontSize: '16px', padding: '0 4px',
  });

  btn.addEventListener('click', () => {
    try { _driveSync.signIn(); } catch (e) { console.error(e); }
    toast.remove();
  });
  closeBtn.addEventListener('click', () => toast.remove());

  toast.append(text, btn, closeBtn);
  document.body.appendChild(toast);
}

async function _onSignInChange(isSignedIn, isNewLogin = false) {
  const driveStatus      = document.getElementById('drive-status');
  const driveAutosaveChk = document.getElementById('drive-autosave-chk');
  const locationChk      = document.getElementById('location-chk');
  const settingsPanel    = document.getElementById('settings-panel');
  const chatMessages     = document.getElementById('chat-messages');

  updateDriveSyncUI(isSignedIn);

  if (!isSignedIn) {
    const existingToast = document.getElementById('reauth-toast');
    if (existingToast) existingToast.remove();
    return;
  }

  // ---- サインイン後の処理 ----
  updateUserAvatars();
  if (isNewLogin) resetToDefaults();

  driveStatus.textContent = '同期中...';

  let s;
  try {
    s = await _storage.loadSettings();
  } catch (err) {
    driveStatus.textContent = `❌ 設定の読み込みに失敗しました: ${err.message}`;
    return;
  }

  if (!s) {
    driveStatus.textContent = '⚠️ Drive に設定がまだ保存されていません';
    return;
  }

  const prevVrmId = getCurrentVrmId();
  applySettings(s);
  applyLocationIfEnabled();
  driveAutosaveChk.checked = getAutoSaveEnabled();
  locationChk.checked      = getLocationEnabled();

  // 設定パネルが開いていれば UI を同期
  if (!settingsPanel.classList.contains('hidden')) {
    refreshSettingsPanel();
  }

  applyBackground(getPersonaData().background);

  // プロファイル・履歴の非同期ロード（historySync に委譲）
  loadHistoryAndProfile({
    storage:         _storage,
    llm:             _llm,
    chatMessages,
    replaceHistory:  isNewLogin,
    loadUserProfile: () => _driveSync.loadUserProfile(),
    logPrefix:       'Drive同期後',
  });

  // VRM が変わっていれば再ロード
  const currentVrmId = getCurrentVrmId();
  if (currentVrmId !== prevVrmId) {
    await _reloadVrmAfterSync(currentVrmId);
  }

  setStatusTemp(driveStatus, '✅ Drive から設定を読み込みました');
}

/** Drive サインイン後に VRM を再ロードするヘルパー */
async function _reloadVrmAfterSync(vrmId) {
  const isBuiltin = vrmId === BUILTIN_FEMALE_ID || vrmId === BUILTIN_MALE_ID;
  if (isBuiltin) {
    try { await loadBuiltinVRM(); } catch (err) {
      console.warn('Drive サインイン後の組み込み VRM 読み込み失敗:', err.message);
    }
  } else {
    try {
      await refreshVRMList(vrmId);
      await loadVrmFromStorage(vrmId);
      await loadDefaultVRMA(true);
      setStatus('');
      captureAiAvatar();
    } catch (err) {
      console.warn('Drive サインイン後の VRM 読み込み失敗:', err.message);
    }
  }
}
