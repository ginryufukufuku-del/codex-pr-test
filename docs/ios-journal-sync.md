# iOS Journal → Obsidian セカンドブレイン 連携セットアップ

iPhoneのJournalアプリ（音声記録）の内容を、このリポジトリの
`vault/99-Inbox/` に自動送信し、Claude Codeが日誌・ノートへ整理する仕組みです。

> [!NOTE]
> AppleはJournalアプリの内容を外部から直接取得する公開APIを提供していません。
> そのため「Journalアプリで録音 → 音声ファイルを共有 → Shortcutsアプリで送信」
> という手動トリガー方式を採用します。ただし**文字起こしはJournalアプリの
> 機能を使わず、Whisperで自動化**するため、iPhone側でテキストを確認・
> コピーする手間は不要です。音声ファイルを送るだけで済みます。

## 全体の流れ

```
[iPhone] Journalアプリで音声メモを録音
    ↓ 音声ファイル(.m4a)を共有
[iPhone] ショートカット「セカンドブレインに送る」を実行
    ↓ GitHub Contents API (PUT /repos/{owner}/{repo}/contents/{path})
[GitHub] vault/99-Inbox/YYYY-MM-DDTHH-mm-ss.m4a としてコミットされる
    ↓
[Claude Code] scripts/transcribe_inbox.py がWhisper APIで自動文字起こしし、
              同名の .md に変換（音声ファイルは削除）
    ↓
[Claude Code] /second-brain スキルでInboxの.mdを処理し、
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

## 2. OpenAI APIキーを取得する（Whisper文字起こし用）

1. https://platform.openai.com でAPIキーを発行する（Whisper APIは従量課金）。
2. このキーはiPhone側では使わず、**Claude Codeを動かす環境の環境変数
   `OPENAI_API_KEY`** として設定する（iOS Shortcutsには入力しない）。

## 3. iOS Shortcuts を作成する

ショートカット名: **「セカンドブレインに送る」**

手順（Shortcutsアプリで以下のアクションを順に追加）:

1. **ファイルを受け取る** — 共有シートから実行できるように
   「共有シートに表示」をON、受け取る種類は「メディア」（音声ファイル）。
   （Journalアプリの音声メモを共有 → このショートカットを選ぶ運用。
   文字起こしはWhisperが自動で行うため、テキスト化の操作は不要）
2. **日付を取得**（現在の日付、フォーマット: `ISO 8601`）
3. **ファイルの内容を取得**して**Base64エンコード**
   （GitHub Contents APIはBase64本文を要求するため）
4. **URLの内容を取得**アクションを追加:
   - URL:
     `https://api.github.com/repos/ginryufukufuku-del/codex-pr-test/contents/vault/99-Inbox/[日付(YYYY-MM-DDTHH-mm-ss)].m4a`
   - メソッド: `PUT`
   - ヘッダー:
     - `Authorization`: `Bearer [GitHub PATをここに]`
     - `Accept`: `application/vnd.github+json`
   - 本文(JSON):
     ```json
     {
       "message": "iOS Journalから音声を自動取り込み",
       "content": "[Base64エンコードした音声ファイル]",
       "branch": "claude/obsidian-claude-integration-1pknlc"
     }
     ```

5. 実行結果（ステータスコード）を通知で表示すると失敗に気づきやすい。

## 4. 使い方

1. Journalアプリで音声メモを記録する（文字起こしは不要、そのままでよい）。
2. 音声を共有 → 「セカンドブレインに送る」を実行。
3. 数秒後、`vault/99-Inbox/` に音声ファイル（`.m4a`）がコミットされる
   （GitHub上でPRに反映される）。
4. Claude Codeとやり取りするとき、まず
   `python3 scripts/transcribe_inbox.py`（`OPENAI_API_KEY`必須）を実行して
   音声を自動文字起こしし `.md` に変換する。
5. 続けて「Inboxを処理して」と伝えるか `/second-brain` スキルが起動する
   タイミングで、文字起こし済みの `.md` がジャーナル・各ノートへ整理される。

## テキストのまま送りたい場合（Whisperを使わない）

音声ではなくテキストを直接送りたい場合は、Shortcutsの「ファイルを受け取る」を
「テキストを受け取る」に変え、送信先の拡張子を `.md` にし、本文をそのまま
Markdown化してPUTすればよい（Whisperの文字起こしをスキップできる）。

## トラブルシューティング

- `401 Unauthorized` → PATの権限またはリポジトリ指定を確認。
- `404 Not Found` → URLのowner/repo/pathのスペルミスを確認。
- `422 Unprocessable Entity` → 同名ファイルが既に存在する可能性
  （ファイル名にタイムスタンプを含めているため通常発生しない）。
- `transcribe_inbox.py` が `OPENAI_API_KEY が設定されていません` と出る
  → Claude Codeを動かす環境側で環境変数を設定できているか確認。
