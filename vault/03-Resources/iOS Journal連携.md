---
tags: [second-brain, ios, automation]
created: 2026-09-28
---

# iOS Journal連携

iPhoneのJournalアプリの音声記録をこのセカンドブレインに取り込むための仕組み。

## 現状の構成

- `vault/99-Inbox/` : Shortcutsから送られる未処理データの受け皿
- Shortcuts → GitHub Contents API（PUT）→ `99-Inbox/` にMarkdownをコミット
- Claude Codeが `/second-brain` スキルでInboxを検出し、`00-Journal` へ整形して転記

セットアップ手順は `docs/ios-journal-sync.md` に詳細を記載。

## 制約

- Journalアプリに公開APIが無いため、文字起こし後にテキストを選択して
  共有シートからショートカットを手動実行する必要がある（完全自動化不可）。

## 動作確認ログ

- 2026-09-28: ダミーテキストでInbox→ジャーナル整形の一連の流れをテスト
  （[[2026-09-28]] 参照）。実機でのShortcuts作成・本番テストは未実施。
