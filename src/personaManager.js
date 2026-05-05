/**
 * ペルソナ（性別キャラクター）管理モジュール
 * ※ 設定ファイルの保存キー名 ("current_sex", "sex") は後方互換のため維持
 */

const _defaults = {
  female: {
    selectedVrmId:      '__builtin__',
    speakerId:          '888753760',
    cloudModelUuid:     '',
    cloudStyleId:       '',
    background:         'bg/default.png',
    armCorrection:      0,
    shoulderCorrection: 0,
    chestCorrection:    0,
    isProactive:        false,
    motionMap: {
      neutral:   'vrma/female/neutral.vrma',
      happy:     'vrma/female/happy.vrma',
      angry:     'vrma/female/angry.vrma',
      sad:       'vrma/female/sad.vrma',
      surprised: 'vrma/female/surprised.vrma',
      relaxed:   'vrma/female/relaxed.vrma',
    },
  },
  male: {
    selectedVrmId:      '__builtin_male__',
    speakerId:          '888753760',
    cloudModelUuid:     '',
    cloudStyleId:       '',
    background:         'bg/default.png',
    armCorrection:      0,
    shoulderCorrection: 0,
    chestCorrection:    0,
    isProactive:        false,
    motionMap: {
      neutral:   'vrma/male/neutral.vrma',
      happy:     'vrma/male/happy.vrma',
      angry:     'vrma/male/angry.vrma',
      sad:       'vrma/male/sad.vrma',
      surprised: 'vrma/male/surprised.vrma',
      relaxed:   'vrma/male/relaxed.vrma',
    },
  },
};

let _currentPersona = 'female';
let _personaData = {
  female: { ..._defaults.female, motionMap: { ..._defaults.female.motionMap } },
  male:   { ..._defaults.male,   motionMap: { ..._defaults.male.motionMap } },
};

export function getCurrentPersona() { return _currentPersona; }

export function setCurrentPersona(persona) {
  if (persona === 'female' || persona === 'male') _currentPersona = persona;
}

export function getPersonaData(persona) {
  return _personaData[persona ?? _currentPersona];
}

export function updatePersonaData(persona, updates) {
  if (!_personaData[persona]) return;
  Object.assign(_personaData[persona], updates);
}

export function resetToDefaults() {
  _currentPersona = 'female';
  _personaData = {
    female: { ..._defaults.female, motionMap: { ..._defaults.female.motionMap } },
    male:   { ..._defaults.male,   motionMap: { ..._defaults.male.motionMap } },
  };
}

/** 設定オブジェクトからペルソナ状態を復元する（保存キーは後方互換で維持） */
export function applySettings(s) {
  if (!s) return;
  if (s.current_sex) setCurrentPersona(s.current_sex);
  if (s.sex) {
    for (const persona of ['female', 'male']) {
      if (s.sex[persona]) {
        const d = s.sex[persona];

        // マイグレーション: 男性キャラに __builtin__ が設定されている場合は修正
        if (persona === 'male'   && d.selectedVrmId === '__builtin__')      d.selectedVrmId = '__builtin_male__';
        // マイグレーション: 女性キャラに __builtin_male__ が設定されている場合は修正
        if (persona === 'female' && d.selectedVrmId === '__builtin_male__') d.selectedVrmId = '__builtin__';

        // マイグレーション: 旧バージョンの vrma/VRMA_... パスはデフォルトに戻す
        let mergedMotionMap = { ..._defaults[persona].motionMap };
        if (d.motionMap) {
          for (const [emo, path] of Object.entries(d.motionMap)) {
            if (path && !path.includes('VRMA_')) mergedMotionMap[emo] = path;
          }
        }

        _personaData[persona] = { ..._defaults[persona], ...d, motionMap: mergedMotionMap };
      }
    }
  }
}

/** 現在のペルソナ状態を設定オブジェクトとして収集する */
export function collectSettings() {
  return {
    current_sex: _currentPersona,
    sex: {
      female: { ..._personaData.female, motionMap: { ..._personaData.female.motionMap } },
      male:   { ..._personaData.male,   motionMap: { ..._personaData.male.motionMap } },
    },
  };
}
