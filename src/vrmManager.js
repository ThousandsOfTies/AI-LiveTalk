import { setStatus } from './uiUtils.js';
import { getCurrentPersona, getPersonaData, updatePersonaData } from './personaManager.js';
import { LLMClient, DEFAULT_MALE_SYSTEM_PROMPT } from './llm-client.js';
import { BUILTIN_FEMALE_ID, BUILTIN_MALE_ID } from './constants.js';

let _viewer, _storage, _llm, _canvas, _saveSettings;
let _vrmModelSelect, _vrmFileInput, _vrmLoadStatus, _vrmaPresetSelect, _loadVRMABtn, _vrmaFileInput;

let _currentVrmId     = getPersonaData().selectedVrmId;
let _vrmCharNames     = {};
let _vrmFileNames     = {};
let _vrmSystemPrompts = {};
let _aiAvatarUrl      = null;
let _vrmaEmotionMap   = { ...getPersonaData().motionMap };

export function initVRMManager({ viewer, storage, llm, canvas, saveSettings }) {
  _viewer       = viewer;
  _storage      = storage;
  _llm          = llm;
  _canvas       = canvas;
  _saveSettings = saveSettings;

  _vrmModelSelect   = document.getElementById('vrm-model-select');
  _vrmFileInput     = document.getElementById('vrm-file-input');
  _vrmLoadStatus    = document.getElementById('vrm-load-status');
  _vrmaPresetSelect = document.getElementById('vrma-preset-select');
  _loadVRMABtn      = document.getElementById('load-vrma-btn');
  _vrmaFileInput    = document.getElementById('vrma-file-input');

  _registerListeners();
}

// ---- Getters ----
export function getAiAvatarUrl()      { return _aiAvatarUrl; }
export function getCurrentVrmId()     { return _currentVrmId; }
export function getVrmCharNames()     { return _vrmCharNames; }
export function getVrmFileNames()     { return _vrmFileNames; }
export function getVrmSystemPrompts() { return _vrmSystemPrompts; }
export function getVrmaEmotionMap()   { return _vrmaEmotionMap; }

export function getVrmState() {
  return {
    currentVrmId:  _currentVrmId,
    charNames:     _vrmCharNames,
    systemPrompts: _vrmSystemPrompts,
  };
}

export function setCurrentVrmSystemPrompt(prompt) {
  _vrmSystemPrompts[_currentVrmId] = prompt;
}

// ---- Settings integration ----
export function applySettings(s) {
  if (!s) return;
  if (s.vrm_char_names) {
    try { _vrmCharNames = JSON.parse(s.vrm_char_names); } catch { _vrmCharNames = {}; }
  }
  if (s.vrm_system_prompts) {
    try { _vrmSystemPrompts = JSON.parse(s.vrm_system_prompts); } catch { _vrmSystemPrompts = {}; }
  }
  const currentPersona = getCurrentPersona();
  const vrmId = s.sex?.[currentPersona]?.selectedVrmId ?? s.selected_vrm_id;
  if (vrmId) _currentVrmId = vrmId;
  const motionMap = s.sex?.[currentPersona]?.motionMap;
  if (motionMap) Object.assign(_vrmaEmotionMap, motionMap);
}

export function applyPersonaDataToVRM() {
  const d = getPersonaData();
  Object.assign(_vrmaEmotionMap, d.motionMap);
  _currentVrmId = d.selectedVrmId;
  refreshVRMList(d.selectedVrmId);
}

// ---- URL resolution ----
export function resolveVrmaUrl(path) {
  return path.startsWith('blob:') ? path : import.meta.env.BASE_URL + path;
}

// ---- VRMA ----
export async function loadDefaultVRMA(isIdle = false) {
  await _viewer.loadVRMA(resolveVrmaUrl(_vrmaEmotionMap.neutral), { loop: true, isIdle });
  _vrmaPresetSelect.value = 'neutral';
}

// ---- VRM ----
export function captureAiAvatar() {
  requestAnimationFrame(() => {
    try {
      _aiAvatarUrl = _canvas.toDataURL('image/jpeg', 0.8);
    } catch (err) {
      console.warn('AIアバター取得失敗:', err.message);
    }
  });
}

export async function refreshVRMList(selectId = undefined) {
  let files = [];
  try {
    files = await _storage.listVRMFiles();
  } catch (err) {
    console.warn('VRMリスト取得失敗:', err.message);
  }
  _vrmFileNames = {};
  _vrmModelSelect.innerHTML = '';

  const builtinOpt = document.createElement('option');
  const persona = getCurrentPersona();
  if (persona === 'male') {
    builtinOpt.value       = BUILTIN_MALE_ID;
    builtinOpt.textContent = 'リルマ (デフォルト)';
  } else {
    builtinOpt.value       = BUILTIN_FEMALE_ID;
    builtinOpt.textContent = 'リリム (デフォルト)';
  }
  _vrmModelSelect.appendChild(builtinOpt);

  for (const f of files) {
    _vrmFileNames[f.id] = f.name;
    const opt = document.createElement('option');
    opt.value       = f.id;
    opt.textContent = _vrmCharNames[f.id] || f.name;
    _vrmModelSelect.appendChild(opt);
  }

  if (selectId !== undefined) {
    _vrmModelSelect.value = selectId;
    _currentVrmId = selectId;
  } else if (_currentVrmId && _vrmModelSelect.querySelector(`option[value="${_currentVrmId}"]`)) {
    _vrmModelSelect.value = _currentVrmId;
  }
  _updateVrmEditRow();
}

export async function loadBuiltinVRM() {
  setStatus('モデルを読み込み中...');
  _vrmModelSelect.disabled = true;
  try {
    const persona = getCurrentPersona();
    fetch(resolveVrmaUrl(_vrmaEmotionMap.neutral)).catch(() => {}); // プリフェッチ
    if (persona === 'male') {
      try {
        await _viewer.loadVRM(import.meta.env.BASE_URL + 'vrm/Liluma.vrm', (pct) => setStatus(`読み込み中... ${pct}%`));
      } catch {
        await _viewer.loadVRM(import.meta.env.BASE_URL + 'vrm/Lilym.vrm',  (pct) => setStatus(`読み込み中... ${pct}%`));
      }
    } else {
      await _viewer.loadVRM(import.meta.env.BASE_URL + 'vrm/Lilym.vrm', (pct) => setStatus(`読み込み中... ${pct}%`));
    }
    setStatus('デフォルトモーション適用中...');
    await loadDefaultVRMA(true);
    _vrmaPresetSelect.value = 'neutral';
    setStatus('');
    captureAiAvatar();
  } catch (err) {
    setStatus(`モデル読み込みエラー: ${err.message}`);
    console.error(err);
  } finally {
    _vrmModelSelect.disabled = false;
  }
}

/**
 * ストレージ(Drive/IndexedDB)から VRM を DL して viewer に読み込む共通ヘルパー。
 * @param {string}   vrmId
 * @param {function} [onProgress]  (pct: number) => void
 */
export async function loadVrmFromStorage(vrmId, onProgress) {
  const progressFn = onProgress ?? ((pct) => setStatus(`読み込み中... ${pct}%`));
  let fname = _vrmFileNames[vrmId];
  if (!fname) {
    const files = await _storage.listVRMFiles();
    const f = files.find(f => f.id === vrmId);
    if (!f) throw new Error('保存されたモデルが見つかりません');
    _vrmFileNames[f.id] = f.name;
    fname = f.name;
  }
  const buf  = await _storage.downloadVRM(vrmId);
  const file = new File([buf], fname, { type: 'application/octet-stream' });
  await _viewer.loadVRM(file, progressFn);
}

export async function loadInitialVRM() {
  _currentVrmId = getPersonaData().selectedVrmId;
  const isBuiltin = _currentVrmId === BUILTIN_FEMALE_ID || _currentVrmId === BUILTIN_MALE_ID;

  if (isBuiltin) {
    const defaultPrompt = _currentVrmId === BUILTIN_MALE_ID
      ? DEFAULT_MALE_SYSTEM_PROMPT
      : LLMClient.DEFAULT_SYSTEM_PROMPT;
    _llm.systemPrompt = _vrmSystemPrompts[_currentVrmId] ?? defaultPrompt;
    await loadBuiltinVRM();
  } else {
    setStatus('モデルを読み込み中...');
    _vrmModelSelect.disabled = true;
    try {
      _llm.systemPrompt = _vrmSystemPrompts[_currentVrmId] ?? _llm.systemPrompt;
      await loadVrmFromStorage(_currentVrmId);
      setStatus('デフォルトモーション適用中...');
      await loadDefaultVRMA(true);
      setStatus('');
      captureAiAvatar();
    } catch (err) {
      console.warn('前回のモデル読み込み失敗、ビルトインに戻します:', err.message);
      const fallbackId = getCurrentPersona() === 'male' ? BUILTIN_MALE_ID : BUILTIN_FEMALE_ID;
      _currentVrmId = fallbackId;
      updatePersonaData(getCurrentPersona(), { selectedVrmId: fallbackId });
      const defaultPrompt = fallbackId === BUILTIN_MALE_ID
        ? DEFAULT_MALE_SYSTEM_PROMPT
        : LLMClient.DEFAULT_SYSTEM_PROMPT;
      _llm.systemPrompt = _vrmSystemPrompts[fallbackId] ?? defaultPrompt;
      await loadBuiltinVRM();
    } finally {
      _vrmModelSelect.disabled = false;
    }
  }
}

// ---- Private helpers ----
function _updateVrmEditRow() {
  const val           = _vrmModelSelect.value;
  const editRow       = document.getElementById('vrm-edit-row');
  const charNameInput = document.getElementById('vrm-char-name');
  const isBuiltin     = val === BUILTIN_FEMALE_ID || val === BUILTIN_MALE_ID || val === '__add__';
  if (val && !isBuiltin) {
    editRow.classList.remove('hidden');
    charNameInput.value       = _vrmCharNames[val] || '';
    charNameInput.placeholder = _vrmFileNames[val] || '表示名を入力';
  } else {
    editRow.classList.add('hidden');
  }
}

function _applyVrmSystemPrompt(vrmId) {
  let fallback = _llm.systemPrompt;
  if (vrmId === BUILTIN_MALE_ID)   fallback = DEFAULT_MALE_SYSTEM_PROMPT;
  else if (vrmId === BUILTIN_FEMALE_ID) fallback = LLMClient.DEFAULT_SYSTEM_PROMPT;
  else fallback = getCurrentPersona() === 'male' ? DEFAULT_MALE_SYSTEM_PROMPT : LLMClient.DEFAULT_SYSTEM_PROMPT;
  _llm.systemPrompt = _vrmSystemPrompts[vrmId] ?? fallback;
  const el = document.getElementById('setting-system-prompt');
  if (el) el.value = _llm.systemPrompt;
}

async function _handleVrmSelect(val) {
  const promptEl = document.getElementById('setting-system-prompt');
  if (promptEl && _currentVrmId) {
    _vrmSystemPrompts[_currentVrmId] = promptEl.value.trim();
  }

  const isBuiltin = val === BUILTIN_FEMALE_ID || val === BUILTIN_MALE_ID;
  _currentVrmId = val;
  updatePersonaData(getCurrentPersona(), { selectedVrmId: val });
  _updateVrmEditRow();
  _applyVrmSystemPrompt(val);

  if (isBuiltin) {
    await loadBuiltinVRM();
    _saveSettings();
    return;
  }

  _vrmModelSelect.disabled    = true;
  _vrmLoadStatus.textContent  = '読み込み中...';
  try {
    await loadVrmFromStorage(val, (pct) => { _vrmLoadStatus.textContent = `読み込み中... ${pct}%`; });
    _vrmLoadStatus.textContent = `✅ ${_vrmCharNames[val] || _vrmFileNames[val] || val}`;
    setStatus('');
    _saveSettings();
    await loadDefaultVRMA(true).catch(e => console.warn('デフォルトモーション読み込み失敗:', e.message));
    captureAiAvatar();
  } catch (err) {
    _vrmLoadStatus.textContent = `❌ ${err.message}`;
    console.error(err);
  } finally {
    _vrmModelSelect.disabled = false;
  }
}

function _registerListeners() {
  document.getElementById('vrm-char-name').addEventListener('change', async (e) => {
    if (!_currentVrmId || _currentVrmId === BUILTIN_FEMALE_ID) return;
    const name = e.target.value.trim();
    if (name) {
      _vrmCharNames[_currentVrmId] = name;
    } else {
      delete _vrmCharNames[_currentVrmId];
    }
    await refreshVRMList(_currentVrmId);
    _saveSettings();
  });

  document.getElementById('vrm-delete-btn').addEventListener('click', async () => {
    const isBuiltin = _currentVrmId === BUILTIN_FEMALE_ID || _currentVrmId === BUILTIN_MALE_ID;
    if (!_currentVrmId || isBuiltin) return;
    const dispName = _vrmCharNames[_currentVrmId] || _vrmFileNames[_currentVrmId] || _currentVrmId;
    if (!confirm(`「${dispName}」を削除しますか？`)) return;
    try {
      await _storage.deleteVRM(_currentVrmId);
      delete _vrmCharNames[_currentVrmId];
      delete _vrmFileNames[_currentVrmId];
      delete _vrmSystemPrompts[_currentVrmId];
      _vrmLoadStatus.textContent = '';
      const fallbackId = getCurrentPersona() === 'male' ? BUILTIN_MALE_ID : BUILTIN_FEMALE_ID;
      updatePersonaData(getCurrentPersona(), { selectedVrmId: fallbackId });
      await refreshVRMList(fallbackId);
      _applyVrmSystemPrompt(fallbackId);
      await loadBuiltinVRM();
      _saveSettings();
    } catch (err) {
      _vrmLoadStatus.textContent = `❌ ${err.message}`;
      console.error(err);
    }
  });

  _vrmModelSelect.addEventListener('change', (e) => _handleVrmSelect(e.target.value));

  document.getElementById('vrm-add-btn').addEventListener('click', () => _vrmFileInput.click());

  _loadVRMABtn.addEventListener('click', () => _vrmaFileInput.click());

  _vrmaFileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const emotion = _vrmaPresetSelect.value || 'neutral';
    setStatus(`「${_vrmaPresetSelect.options[_vrmaPresetSelect.selectedIndex].text}」のモーションを置き換え中...`);
    _loadVRMABtn.disabled = true;
    try {
      const blobUrl = URL.createObjectURL(file);
      _vrmaEmotionMap[emotion] = blobUrl;
      await _viewer.loadVRMA(blobUrl, { loop: true, isIdle: emotion === 'neutral' });
      setStatus(`✅ ${_vrmaPresetSelect.options[_vrmaPresetSelect.selectedIndex].text} のモーションを更新しました`);
    } catch (err) {
      setStatus(`VRMAエラー: ${err.message}`);
      console.error(err);
    } finally {
      _loadVRMABtn.disabled  = false;
      _vrmaFileInput.value   = '';
    }
  });

  _vrmaPresetSelect.addEventListener('change', async () => {
    const emotion     = _vrmaPresetSelect.value;
    const prevEmotion = _vrmaPresetSelect.dataset.current ?? 'neutral';
    setStatus('モーション読み込み中...');
    try {
      const url = resolveVrmaUrl(_vrmaEmotionMap[emotion] || _vrmaEmotionMap.neutral);
      await _viewer.loadVRMA(url, { loop: true, isIdle: emotion === 'neutral' });
      _vrmaPresetSelect.dataset.current = emotion;
      setStatus('アニメーション再生中');
    } catch (err) {
      setStatus(`VRMAエラー: ${err.message}`);
      _vrmaPresetSelect.value = prevEmotion;
      console.error(err);
    }
  });

  _vrmFileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    _vrmModelSelect.disabled   = true;
    _vrmLoadStatus.textContent = '保存中...';
    try {
      await _storage.uploadVRM(file, () => {});
      _vrmLoadStatus.textContent = '読み込み中...';
      await _viewer.loadVRM(file, (pct) => { _vrmLoadStatus.textContent = `読み込み中... ${pct}%`; });
      _vrmLoadStatus.textContent = `✅ ${file.name}`;
      setStatus('');
    } catch (err) {
      _vrmLoadStatus.textContent = `❌ ${err.message}`;
      console.error(err);
      _vrmModelSelect.disabled = false;
      _vrmFileInput.value      = '';
      return;
    }
    await refreshVRMList();
    const found = Array.from(_vrmModelSelect.options).find(
      o => o.value !== '__add__' && o.value !== BUILTIN_FEMALE_ID && _vrmFileNames[o.value] === file.name
    );
    if (found) {
      const isMale = getCurrentPersona() === 'male';
      _vrmSystemPrompts[found.value] = isMale ? DEFAULT_MALE_SYSTEM_PROMPT : LLMClient.DEFAULT_SYSTEM_PROMPT;
      _vrmModelSelect.value = found.value;
      _currentVrmId         = found.value;
      _updateVrmEditRow();
      _applyVrmSystemPrompt(found.value);
    }
    await loadDefaultVRMA(true).catch(e => console.warn('デフォルトモーション読み込み失敗:', e.message));
    _vrmModelSelect.disabled = false;
    _vrmFileInput.value      = '';
  });
}
