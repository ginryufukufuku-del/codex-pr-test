#!/usr/bin/env python3
"""
vault/99-Inbox/ 内の音声ファイルをWhisperで自動文字起こしし、
同じフロントマター形式のMarkdownノートに変換するスクリプト。

使い方:
    export OPENAI_API_KEY=sk-...
    python3 scripts/transcribe_inbox.py

対象拡張子: .m4a .mp3 .wav .mp4 .mpeg .mpga .webm
処理後、音声ファイルは削除し、同名の .md ファイルを残す
（形式は iOS Shortcuts からのテキスト送信と揃えている）。
"""
import base64
import datetime
import os
import sys
from pathlib import Path

AUDIO_EXTS = {".m4a", ".mp3", ".wav", ".mp4", ".mpeg", ".mpga", ".webm"}
INBOX_DIR = Path(__file__).resolve().parent.parent / "vault" / "99-Inbox"


def transcribe(audio_path: Path) -> str:
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY が設定されていません")

    from openai import OpenAI

    client = OpenAI(api_key=api_key)
    with open(audio_path, "rb") as f:
        result = client.audio.transcriptions.create(
            model="whisper-1",
            file=f,
            language="ja",
        )
    return result.text.strip()


def captured_timestamp(audio_path: Path) -> str:
    # ファイル名が YYYY-MM-DDTHH-mm-ss.<ext> ならそれを使う。
    # そうでなければファイルの更新時刻を使う。
    stem = audio_path.stem
    try:
        dt = datetime.datetime.strptime(stem, "%Y-%m-%dT%H-%M-%S")
    except ValueError:
        dt = datetime.datetime.fromtimestamp(audio_path.stat().st_mtime)
    return dt.isoformat()


def main() -> int:
    if not INBOX_DIR.exists():
        print(f"Inboxフォルダが見つかりません: {INBOX_DIR}", file=sys.stderr)
        return 1

    audio_files = sorted(
        p for p in INBOX_DIR.iterdir() if p.suffix.lower() in AUDIO_EXTS
    )
    if not audio_files:
        print("音声ファイルはありません。")
        return 0

    for audio_path in audio_files:
        print(f"文字起こし中: {audio_path.name}")
        text = transcribe(audio_path)
        captured = captured_timestamp(audio_path)

        note_path = audio_path.with_suffix(".md")
        note_path.write_text(
            f"---\nsource: ios-journal\ncaptured: {captured}\n"
            f"transcribed_by: whisper-1\n---\n\n{text}\n",
            encoding="utf-8",
        )
        audio_path.unlink()
        print(f"  -> {note_path.name} を作成し、音声ファイルを削除しました。")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
