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
