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
