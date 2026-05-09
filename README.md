# AiLiveTalk — 3Dアバター AIアシスタント

**https://thousandsofties.github.io/AI-LiveTalk/**

VRM キャラクターと LLM を組み合わせた 3D AI アシスタント Web アプリです。
ブラウザだけで動作し、スマートフォンからも利用できます。

## 機能

- **VRM モデル表示** — VRoid Studio などで作成した `.vrm` ファイルを読み込んで表示
- **LLM チャット** — OpenAI 互換 API（OpenAI / Gemini / Ollama など）でキャラクターと会話
- **マルチモーダル入力** — カメラ撮影・端末内画像ファイルを LLM に渡してキャラクターが解釈・反応
- **入力モード切替** — マイクボタン長押しで「ワンショット / ラリーモード / カメラ / ギャラリー」をピッカーで選択
- **発話中断** — AI が喋っている間だけ「停止」ボタンが現れ、TTS と LLM ストリームを即座に中断
- **感情表現** — LLM の返答に応じてキャラクターの表情・モーション (VRMA) が変化
- **音声合成 (TTS)** — AivisSpeech（ローカル）/ Aivis Cloud API / ブラウザ TTS にフォールバック
- **音声入力 (STT)** — マイクからの音声入力に対応 (騒音時は Gemini Audio へ自動切替)
- **長期記憶（プロファイリング）** — 会話からユーザーの特徴を秘密裏に分析・記憶
- **Google Drive 同期** — 設定・会話履歴・プロファイル・VRM ファイルを Google Drive に保存・同期
- **オフライン対応** — Google Drive 未使用時は IndexedDB にローカル保存

## セットアップ

### 必要なもの

- モダンブラウザ（Chrome / Edge / Safari）
- OpenAI 互換 API のエンドポイントと API キー

### 設定手順

1. アプリを開き、右上の **⚙️ 設定** をクリック
2. **LLM タブ** で APIエンドポイント・APIキー・モデル名を入力して保存
3. （任意）**音声タブ** で AivisSpeech または Aivis Cloud API を設定
4. （任意）ヘッダーの **☁ サインイン** から Google アカウントでサインインすると設定が自動同期

### LLM 設定例

| サービス | エンドポイント | モデル名 |
|---|---|---|
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
| Gemini | `https://generativelanguage.googleapis.com/v1beta/openai/` | `gemini-2.5-flash` |
| Ollama (ローカル) | `http://localhost:11434/v1` | `llama3.2` など |

> 📷 **画像入力（カメラ・ギャラリー）を使う場合は、ビジョン対応モデル（`gpt-4o-mini` / `gemini-2.5-flash` 等）を選択してください。** Ollamaの軽量モデルなどビジョン非対応のモデルでは画像送信時にエラーになります。

## 使い方

### 入力モード切替（マイクボタン長押し）

チャット入力欄の左にあるマイクボタンを **長押し（0.6秒）** するとモードピッカーが開き、入力方法を切り替えられます。

| モード | アイコン | 動作（タップ時） |
|---|---|---|
| ワンショット | 🔴 赤丸 | 1回だけ音声入力 |
| ラリーモード | 🔴 + 矢印 | 連続会話（AIの発話終了後に自動で再録音） |
| カメラ | 📷 カメラ風 | カメラを起動して撮影 → 画像と一緒に送信 |
| ギャラリー | 🖼 風景画 | 端末内の画像ファイルを選択 → 画像と一緒に送信 |

選択したモードがマイクボタンのアイコンに反映され、次回タップ時の動作が決まります。

### 画像入力の流れ

1. マイクボタンを長押し → 「カメラ」または「ギャラリー」を選択
2. ボタンが該当アイコンに変化
3. ボタンをタップ → カメラ起動 / 画像選択ダイアログ
4. 撮影 / 選択すると入力欄上にサムネイルが表示
5. テキストを添えて（または空のまま）送信すると、AI が画像を解釈して反応

> 画像はクライアント側で最大 1280px に縮小・JPEG 圧縮（品質85%）してから LLM に送信します。コスト・通信量を抑える目的です。

### AI の発話を途中で止める

AI が喋っている間だけ、送信ボタンの位置に「停止」ボタンが現れます。タップすると TTS 再生と LLM ストリームの両方を即座に中断します。STT が誤認識して長文応答が始まったときに便利です。

## 音声合成 (AivisSpeech) の連携

AI-LiveTalk はローカルで動作する [AivisSpeech](https://aivis-project.com/) と連携して、高品質な日本語音声を再生できます。

### 1. AivisSpeech の準備
AivisSpeech Engine をインストールし、本リポジトリに含まれる以下のバッチファイルを使用して起動してください。

- **`start_aivis_local.bat`** — 同じ PC のブラウザから利用する場合。
- **`start_aivis_with_tunnel.bat`** — スマートフォンなどの外部ネットワークから利用する場合（トンネル機能）。

### 2. スマートフォンからの利用 (外部公開)
`start_aivis_with_tunnel.bat` を実行すると、トンネル方式を選択できます。

- **localhost.run** (推奨): アカウント不要で即座に HTTPS URL が発行されます。
- **Pinggy**: SSH を利用した代替手段です。
- **Cloudflare**: `cloudflared` がインストールされている場合に使用可能です。

発行された URL（例: `https://xxxx.lhr.life`）を、アプリの **設定 > 音声タブ > AivisSpeech URL** に貼り付けて保存してください。

#### 自動起動設定
引数として番号を指定すると、メニューをスキップして自動起動できます。
```powershell
# localhost.run で自動起動する場合
.\start_aivis_with_tunnel.bat 1
```

## ローカル開発

```bash
npm install
npm run dev        # Vite dev server (localhost:3000)
npm run dev:server # Express server (localhost:3003)
```

### 環境変数 (`.env`)

```env
VITE_GOOGLE_CLIENT_ID=your-google-oauth-client-id
```

Google OAuth クライアント ID は [Google Cloud Console](https://console.cloud.google.com/) で取得してください。
承認済みの JavaScript 生成元に `http://localhost:3000` と本番 URL を追加してください。

## デプロイ

GitHub Actions で `main` ブランチへの push 時に GitHub Pages へ自動デプロイされます。

GitHub リポジトリの Secrets に以下を設定してください：

| Secret | 内容 |
|---|---|
| `VITE_GOOGLE_CLIENT_ID` | Google OAuth クライアント ID |

## 技術スタック

- [Three.js](https://threejs.org/) + [@pixiv/three-vrm](https://github.com/pixiv/three-vrm) — VRM レンダリング
- [Vite](https://vitejs.dev/) — ビルドツール
- Google Identity Services — OAuth 2.0 認証
- Google Drive API — クラウド同期
- IndexedDB — ローカルストレージ
