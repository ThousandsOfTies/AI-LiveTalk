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

let _currentSex = 'female';
let _sexData = {
  female: { ..._defaults.female, motionMap: { ..._defaults.female.motionMap } },
  male:   { ..._defaults.male,   motionMap: { ..._defaults.male.motionMap } },
};

export function getCurrentSex() { return _currentSex; }

export function setCurrentSex(sex) {
  if (sex === 'female' || sex === 'male') _currentSex = sex;
}

export function getSexData(sex) {
  return _sexData[sex ?? _currentSex];
}

export function updateSexData(sex, updates) {
  if (!_sexData[sex]) return;
  Object.assign(_sexData[sex], updates);
}

export function resetToDefaults() {
  _currentSex = 'female';
  _sexData = {
    female: { ..._defaults.female, motionMap: { ..._defaults.female.motionMap } },
    male:   { ..._defaults.male,   motionMap: { ..._defaults.male.motionMap } },
  };
}

export function applySettings(s) {
  if (!s) return;
  if (s.current_sex) setCurrentSex(s.current_sex);
  if (s.sex) {
    for (const sex of ['female', 'male']) {
      if (s.sex[sex]) {
        const d = s.sex[sex];
        
        // マイグレーション: 男性キャラに __builtin__ (Lilym) が設定されている場合は __builtin_male__ に修正
        if (sex === 'male' && d.selectedVrmId === '__builtin__') {
          d.selectedVrmId = '__builtin_male__';
        }
        // マイグレーション: 女性キャラに __builtin_male__ (Roid) が設定されている場合は __builtin__ に修正
        if (sex === 'female' && d.selectedVrmId === '__builtin_male__') {
          d.selectedVrmId = '__builtin__';
        }

        // マイグレーション: 旧バージョンで vrma/VRMA_... が保存されている場合はデフォルトに戻す
        let mergedMotionMap = { ..._defaults[sex].motionMap };
        if (d.motionMap) {
          for (const [emo, path] of Object.entries(d.motionMap)) {
            if (path && !path.includes('VRMA_')) {
              mergedMotionMap[emo] = path;
            }
          }
        }

        _sexData[sex] = {
          ..._defaults[sex],
          ...d,
          motionMap: mergedMotionMap,
        };
      }
    }
  }
}

export function collectSettings() {
  return {
    current_sex: _currentSex,
    sex: {
      female: { ..._sexData.female, motionMap: { ..._sexData.female.motionMap } },
      male:   { ..._sexData.male,   motionMap: { ..._sexData.male.motionMap } },
    },
  };
}
