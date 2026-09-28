# Inbox（未処理の取り込みノート）

iOS Journal アプリの音声記録が、iOS Shortcuts経由で自動的にここへ
書き込まれます。文字起こしはJournalアプリではなく Whisper で自動化しています。
ファイルはまだ整理されていない「生データ」です。

## ファイル形式

1. Shortcuts が音声ファイルを送信: `YYYY-MM-DDTHH-mm-ss.m4a`
2. `python3 scripts/transcribe_inbox.py`（`OPENAI_API_KEY` 必須）が
   Whisper APIで自動文字起こしし、音声ファイルを削除して同名の `.md` を作成:

```markdown
---
source: ios-journal
captured: 2026-09-28T21:15:00+09:00
transcribed_by: whisper-1
---

（Whisperが文字起こししたテキストが入る）
```

## 処理フロー

1. 音声ファイルが残っていれば `scripts/transcribe_inbox.py` を実行して
   `.md` に変換する。
2. Claude Code（`/second-brain` スキル）がこのフォルダの `.md` を検出する。
3. 内容を要約・整理し、対応する日付の `vault/00-Journal/YYYY-MM-DD.md` に
   追記する（複数のInboxファイルが同じ日付なら同じジャーナルにまとめる）。
4. 内容にプロジェクト/領域/参照情報として独立させるべきものがあれば
   `01-Projects` / `02-Areas` / `03-Resources` にノートを作成しリンクする。
5. 処理済みのInboxファイルは削除する（内容はジャーナル側に転記済みのため、
   Inboxに残す必要はない）。

このフォルダにあるファイルは「未処理」を意味するので、空でない場合は
次にClaude Codeを起動したときに処理を促してください。
