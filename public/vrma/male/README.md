# VRMA Emotion Pack

LLMの感情タグ [emo:xxx] と対応するVRMAアニメーション6種のセット。
VRM 1.0準拠、30fps。

## ファイル一覧

| ファイル | 対応タグ | 長さ | 種別 | 説明 |
|---|---|---|---|---|
| neutral.vrma | `[emo:neutral]` | 8秒 | ループ | 呼吸・頭の揺れ・重心移動のアイドル |
| relaxed.vrma | `[emo:relaxed]` | 12秒 | ループ | neutralよりゆったり・振幅控えめ |
| happy.vrma | `[emo:happy]` | 3秒 | ワンショット | 両手を胸の前で合わせて喜ぶ |
| sad.vrma | `[emo:sad]` | 3秒 | ワンショット | 肩が落ちてうつむく |
| angry.vrma | `[emo:angry]` | 3秒 | ワンショット | 前傾・肩すくめ・睨む姿勢 |
| surprised.vrma | `[emo:surprised]` | 2秒 | ワンショット | のけぞる・肩跳ね・腕引き上げ |

## 共通仕様

- 全モーションが同じ中立ポーズ（ARM_DOWN=70°, ARM_OUTWARD=9°, ARM_FORWARD=6°, ELBOW_BEND=10°）
  を基準としており、各モーション間の遷移が破綻しません。
- ワンショット系は t=0 と t=終端で必ず中立ポーズに戻る設計。
- 20ボーン全てをHumanoidに登録済み（VRM 1.0互換）。

## 運用例（three-vrm）

```javascript
// LLM出力から [emo:xxx] を抽出
const emotion = extractEmotion(llmResponse);  // "happy" etc

if (isOneShot(emotion)) {
  // ワンショット：再生後に neutral or relaxed へ戻す
  playOneShot(clips[emotion], {
    onComplete: () => crossfadeTo(clips.neutral)
  });
} else {
  // ループ切替：neutral/relaxed
  crossfadeTo(clips[emotion]);
}
```

## 衣装対応

腕のスカート干渉などは、このパックの腕ボーンキーフレームを起動時に
premultiplyで書き換える方式を推奨（vrma_arm_adjustment_memo.md参照）。
全モーションが共通の基準腕ポーズなので、同じ差分quaternionが全ファイルに適用できます。
