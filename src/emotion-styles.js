export const DEFAULT_EMOTION_STYLES = Object.freeze({
  happy: '嬉しそうに、明るく弾む口調で',
  sad: '少ししんみりと、柔らかくゆっくり',
  angry: '少し不満げに、語尾をきっぱり',
  surprised: '驚きを込めて、抑揚をつけて',
  relaxed: '安心した、穏やかな口調で',
  neutral: '',
});

// 未設定の感情には初期値を補い、意図的な空欄は維持する。
export function normalizeEmotionStyles(styles = {}) {
  return Object.fromEntries(Object.entries(DEFAULT_EMOTION_STYLES).map(([emotion, fallback]) => [
    emotion, typeof styles?.[emotion] === 'string' ? styles[emotion].trim() : fallback,
  ]));
}

export function combineSpeechStyle(baseStyle, emotion, styles) {
  const extra = Object.hasOwn(DEFAULT_EMOTION_STYLES, emotion) ? styles?.[emotion] : styles?.neutral;
  return [baseStyle, extra].filter(value => typeof value === 'string' && value.trim())
    .map(value => value.trim()).join('\n');
}
