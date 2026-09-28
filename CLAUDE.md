# Obsidian セカンドブレイン運用ガイド

このリポジトリは Obsidian Vault（`vault/`）と日々のジャーナルを Claude Code で管理する
「セカンドブレイン」システムです。構成は PARA 方式（Projects / Areas / Resources /
Archive）+ Journal（デイリーノート）を採用しています。

## フォルダ構造

```
vault/
  00-Journal/          デイリーノート（YYYY-MM-DD.md）
    templates/
      Daily.md         デイリーノートのテンプレート
  01-Projects/         期限・成果物のある進行中プロジェクト
  02-Areas/            継続的に責任を持つ領域（健康・仕事・学習など）
  03-Resources/        後で参照する知識・資料・トピック別ノート
  04-Archive/          完了/非アクティブになった Projects・Areas
```

## Claude Code の運用ルール

- 新しいジャーナルエントリを作成するときは `vault/00-Journal/templates/Daily.md`
  をコピーし、ファイル名は `vault/00-Journal/YYYY-MM-DD.md` とする。
- ジャーナル本文からタスクや気づきが出てきたら、該当する
  `01-Projects` / `02-Areas` / `03-Resources` のノートを作成・更新し、
  ジャーナル側には `[[ノート名]]` の形式で Obsidian 内部リンクを張る。
- ジャーナルの「今日のノート」セクションには、その日新規作成・更新した
  ノートへのリンク一覧を必ず残す（後から辿れるようにするため）。
- 新規ノートには Obsidian の YAML フロントマター（`tags`, `created`, `area` など）
  を付け、フォルダの目的に合わないノートは作らない。
- 完了した Project や使われなくなった Area は `04-Archive/` へ移動する
  （内容は変更せず、リンク切れが出たら参照側を修正する）。
- 詳細な作成手順・テンプレートは `/second-brain` スキル（
  `.claude/skills/second-brain/SKILL.md`）を参照する。
