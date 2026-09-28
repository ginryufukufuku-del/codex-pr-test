# iOS Journal → Obsidian セカンドブレイン 連携セットアップ

iPhoneのJournalアプリ（音声記録）の内容を、このリポジトリの
`vault/99-Inbox/` に自動送信し、Claude Codeが日誌・ノートへ整理する仕組みです。

> [!NOTE]
> AppleはJournalアプリの内容を外部から直接取得する公開APIを提供していません。
> そのため「Journalアプリで録音 → 自分でテキストを確認・コピー →
> Shortcutsアプリで送信」という手動トリガー方式を採用します（後述の
> 「自動化を強めたい場合」も参照）。

## 全体の流れ

```
[iPhone] Journalアプリで音声メモ
    ↓ (文字起こしはJournalアプリの標準機能を使用)
[iPhone] ショートカット「セカンドブレインに送る」を実行
    ↓ GitHub Contents API (PUT /repos/{owner}/{repo}/contents/{path})
[GitHub] vault/99-Inbox/YYYY-MM-DDTHH-mm-ss.md としてコミットされる
    ↓
[Claude Code] /second-brain スキルでInboxを処理し、
              vault/00-Journal/ や 01〜03 に整理する
```

## 1. GitHub Personal Access Token(PAT) を発行する

1. GitHub → Settings → Developer settings → **Fine-grained personal access token** を作成。
2. Repository access: `ginryufukufuku-del/codex-pr-test` のみに限定。
3. Permissions: **Contents: Read and write** のみ付与（他は不要）。
4. 発行したトークンは iOS の「Shortcuts」内でのみ使用し、他に共有しない。

> [!WARNING]
> このトークンは `vault/99-Inbox/` への書き込み権限を持ちます。
> リポジトリに直接コミットしない（`.gitignore`や環境変数側でのみ保持する）。

## 2. iOS Shortcuts を作成する

ショートカット名: **「セカンドブレインに送る」**

手順（Shortcutsアプリで以下のアクションを順に追加）:

1. **テキストを受け取る** — 共有シートから実行できるように
   「共有シートに表示」をON、受け取る種類は「テキスト」。
   （Journalアプリの音声メモを文字起こし後、テキストを選択して共有 →
   このショートカットを選ぶ運用）
2. **日付を取得**（現在の日付、フォーマット: `ISO 8601`）
3. **テキスト**アクションで以下のMarkdown本文を組み立てる:

   ```
   ---
   source: ios-journal
   captured: [日付(ISO8601)]
   ---

   [受け取ったテキスト]
   ```

4. **Base64エンコード**アクションで上記テキストをBase64化
   （GitHub Contents APIはBase64本文を要求するため）
5. **URLの内容を取得**アクションを追加:
   - URL:
     `https://api.github.com/repos/ginryufukufuku-del/codex-pr-test/contents/vault/99-Inbox/[日付(YYYY-MM-DDTHH-mm-ss)].md`
   - メソッド: `PUT`
   - ヘッダー:
     - `Authorization`: `Bearer [PATをここに]`
     - `Accept`: `application/vnd.github+json`
   - 本文(JSON):
     ```json
     {
       "message": "iOS Journalから自動取り込み",
       "content": "[Base64エンコードした本文]",
       "branch": "claude/obsidian-claude-integration-1pknlc"
     }
     ```

6. 実行結果（ステータスコード）を通知で表示すると失敗に気づきやすい。

## 3. 使い方

1. Journalアプリで音声メモを記録し、文字起こしを表示する。
2. テキストを選択 → 共有 → 「セカンドブレインに送る」を実行。
3. 数秒後、`vault/99-Inbox/` にMarkdownファイルがコミットされる
   （GitHub上でPRに反映される）。
4. 次にClaude Codeとやり取りするとき「Inboxを処理して」と伝えるか、
   `/second-brain` スキルが起動するタイミングで自動的に検出・整理される。

## 自動化を強めたい場合（任意）

- iOS 17以降の「オートメーション」機能で、Journalアプリを開いたタイミングを
  トリガーにできるが、文字起こしテキストの自動取得はできないため、
  最終的な送信操作は手動が必要。
- 完全自動化したい場合は、Journalアプリの代わりに音声メモ→Whisper文字起こし
  →自動送信という別アプリ構成が必要になる（このリポジトリのスコープ外）。

## トラブルシューティング

- `401 Unauthorized` → PATの権限またはリポジトリ指定を確認。
- `404 Not Found` → URLのowner/repo/pathのスペルミスを確認。
- `422 Unprocessable Entity` → 同名ファイルが既に存在する可能性
  （ファイル名にタイムスタンプを含めているため通常発生しない）。
