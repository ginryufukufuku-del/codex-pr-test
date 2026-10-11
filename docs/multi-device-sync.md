# 複数端末でのセカンドブレイン同期セットアップ

iPad・MacBook Air・Mac mini など、複数端末でこのObsidian Vault（GitHubリポジトリ）を
閲覧・編集するための手順。AirDropでファイルを都度送る必要はない。

GitHubリポジトリそのものをObsidianのVaultとして各端末に接続し、
**Obsidian Git** というコミュニティプラグインで自動的にpush/pull（同期）する。

## 前提

- GitHubリポジトリ: `ginryufukufuku-del/codex-pr-test`
- 作業ブランチ: `claude/obsidian-claude-integration-1pknlc`
  （PR #5がまだマージされていない場合、各端末もこのブランチを使う。
  マージ後は `main` に切り替える）
- GitHub Personal Access Token（Contents: Read and writeのスコープ。
  `docs/ios-journal-sync.md` で作成済みのものがあれば流用可）

## Mac（MacBook Air / Mac mini）の設定

1. ターミナルでリポジトリをクローンする（まだの場合）。
   ```
   git clone https://github.com/ginryufukufuku-del/codex-pr-test.git
   cd codex-pr-test
   git checkout claude/obsidian-claude-integration-1pknlc
   ```
2. Obsidianアプリを開き、「Vaultを開く」→「フォルダを開いてVaultとして使用」で
   クローンした `codex-pr-test/vault` フォルダを選択する。
3. Obsidianの設定 → コミュニティプラグイン → 「Obsidian Git」を検索してインストール・有効化。
4. Obsidian Gitの設定で以下を行う。
   - 「自動pull（起動時）」をオン
   - 「自動push（変更後 ○分ごと）」を設定（例: 5分）
   - 認証はmacOSのKeychain/既存のgit設定（HTTPS + PAT、またはSSHキー）をそのまま利用できる。
     `git push` が一度手動で通ることを確認しておくとよい。

## iPadの設定

1. Obsidianアプリをインストールし、新規Vaultを作成する（空のVaultでよい。
   保存先は「このiPad内」または iCloud Drive）。
2. コミュニティプラグインを有効化し、「Obsidian Git」をインストール・有効化。
3. コマンドパレットから「Obsidian Git: Clone an existing remote repo」を実行し、以下を入力する。
   - リポジトリURL: `https://github.com/ginryufukufuku-del/codex-pr-test.git`
   - ブランチ: `claude/obsidian-claude-integration-1pknlc`
   - 認証: GitHubのユーザー名 + Personal Access Token（パスワード欄にPATを入力）
4. クローンが終わったら、Obsidian Gitの設定で「自動pull（起動時）」「自動push」を
   Mac側と同様に設定する。
5. Vault内のサブフォルダ `vault/` 以下に実際のノートがあるため、Obsidianの設定で
   このVaultのルートが `vault/` を指すように調整するか、Vaultとして
   クローン先フォルダ全体を開いた上で `vault/` 内を通常利用する。

## 同期の仕組みと注意点

- 複数端末で同時に編集すると、Git上でコンフリクト（競合）が起きる場合がある。
  その場合はいずれかの端末でコンフリクトマーカーを手動解消し、pushし直す。
- チャット（Claude Code）経由で作成・更新したノートも同じGitHubリポジトリに
  コミットされるため、各端末でpullすれば自動的に反映される。
- AirDropは一時的なファイル転送には使えるが、継続的な同期用途には向かない
  （片方向・手動・コンフリクト解消なし）ため、通常運用では使わない。
