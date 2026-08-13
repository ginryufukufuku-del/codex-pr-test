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

## タスク管理アプリ

ブラウザで動作するシンプルなタスク管理アプリを収録しています。タスクの追加、完了切替、削除ができ、内容はブラウザに保存されます。

### 起動方法

```bash
python3 -m http.server 8000
```

ブラウザで <http://localhost:8000> を開いてください。

### テスト

```bash
python3 -m unittest discover -s test -v
```
