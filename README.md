# Codex PR Test

GitHub CLIとCodexを使ったPull Requestワークフローを検証するためのリポジトリです。

## 目的

このリポジトリでは、次の一連の作業を安全に試せます。

- 作業ブランチの作成
- ファイルの変更とコミット
- GitHubへのブランチのpush
- Pull Requestの作成とレビュー

## 基本ワークフロー

1. `main`ブランチを最新の状態にします。
2. 作業内容に応じた新しいブランチを作成します。
3. 変更を加え、差分を確認してコミットします。
4. ブランチをGitHubへpushし、Pull Requestを作成します。
5. Pull Requestをレビューし、承認後にマージします。

> [!IMPORTANT]
> `main`ブランチは直接変更せず、必ずPull Requestを経由してください。

## 動画生成AI ハブ(`video-ai-hub/`)
動画生成AIのリンク集・プロンプト作成・API生成・履歴比較。
起動: `cd video-ai-hub && cp .env.example .env`(`GEMINI_API_KEY` を記入)→ `node server.js` → http://127.0.0.1:8000
- APIキーはサーバー(`.env`/環境変数)のみで保持。ブラウザへは返さず、動画もサーバー経由で中継。`.env`はgit管理外。
- 既定は `127.0.0.1` のみ待受。外部公開する場合は必ず `APP_TOKEN` を設定し、HTTPS(リバースプロキシ)を併用。
- 現在のAPI対応: Google Veo(`GEMINI_API_KEY`)/ Runway(`RUNWAY_API_KEY`)/ Luma(`LUMA_API_KEY`)/ fal.ai経由(`FAL_KEY`)でKling / MiniMax Hailuo / Alibaba Wan / ByteDance Seedance をモデル選択。`server.js` の `providers` に追加して拡張。
- **全API呼び出しは有料**。UIの「有料」チェックを入れないと生成ボタンは押せず(生成ごとに再確認)、サーバーも `confirmPaid` なしは拒否します。
- Runway は第三者情報ベース、fal.ai はモデルIDのみ公式ページで確認(縦横比はKlingのみ送信、他は未確認のため未送信)の実装で、有効なキーでの動作は未検証。モデル名は `RUNWAY_MODEL` / `LUMA_MODEL` で変更可。
- キー未設定/静的ホスティング時はAPIセクションが非表示になり、リンク集として動作。
- Sora(Web/アプリ)は2026年4月に提供終了のため掲載していません。料金・仕様は各公式で確認してください。

### ⑤ AI制作チーム(4人のエージェント)
Claude(`claude-opus-5-5`)の4人のエージェントが、意見を出し合いながら1本の動画を作ります。
- ①脚本家: 原作と依頼から脚本(場面・秒数・セリフ・ナレーション・人物の見た目の設定)
- ②撮影・生成担当: カメラワーク・人物の位置関係・光をショット表にし、動画生成AIで生成、コマ画像で確認して撮り直し
- ③監督: 秒ごとのタイムライン、声の配役(VOICEVOX)、セリフと映像・原作の整合のファクトチェック
- ④最終チェック: 完成版の照明・配置・流れ・カメラ・音を独立に判定し、担当者に数値付きで差し戻し
- 進め方: 「案 → ほかのメンバーの意見 → 書き手が修正(採否と理由を回答) → 再確認」を工程ごとに最大N回(FilmAgent・Camera Artist などの研究と、制作者の実践を参考)

準備: `cd video-ai-hub && npm install`、`.env` に `ANTHROPIC_API_KEY` と動画生成AIのキー、ffmpeg(Mac: `brew install ffmpeg`)。声を付けるなら VOICEVOX を起動。テスト: `npm test`(APIを呼ばない代役で全工程を通す)。

注意:
- **有料**: Claude(1本あたり約20〜80回呼び出し)と動画生成の料金がかかります。生成回数と Claude の呼び出し回数に上限があります。
- 口の動きの確認は、コマ画像と声の長さからの判定です(音声の聞き取りはしません)。後付けの声は口の動きと合わないため、監督は画面外のナレーションを優先します。
- 素材は使ってよいものだけ: 自分の文章、青空文庫(取り扱い規準を確認)、VOICEVOX(「VOICEVOX:キャラ名」の表記。条件はキャラごとに確認)、利用条件を確認したBGM。完成時にクレジット一覧を表示します。

### デスクトップアプリ(Mac)
`desktop/` に、`video-ai-hub/` をMacアプリ(アイコンをダブルクリックで起動、Node.js不要)にする Electron 版があります。手順は `desktop/README.md`。
