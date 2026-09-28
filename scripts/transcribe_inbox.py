#!/usr/bin/env python3
"""
vault/99-Inbox/ 内の音声ファイルをローカルWhisper（faster-whisper）で
自動文字起こしし、同じフロントマター形式のMarkdownノートに変換するスクリプト。

APIキー・ネットワーク接続は不要（初回のモデルダウンロードを除く）。
処理はすべてこのマシン上のCPU/GPUで完結する。

使い方:
    pip install -r scripts/requirements.txt
    python3 scripts/transcribe_inbox.py

環境変数（省略可）:
    WHISPER_MODEL_SIZE  tiny / base / small / medium / large-v3 など（既定: base）
    WHISPER_DEVICE      cpu / cuda（既定: cpu）
    WHISPER_COMPUTE_TYPE  int8 / float16 など（既定: cpu なら int8、cudaなら float16）

対象拡張子: .m4a .mp3 .wav .mp4 .mpeg .mpga .webm
処理後、音声ファイルは削除し、同名の .md ファイルを残す
（形式は iOS Shortcuts からのテキスト送信と揃えている）。

注意: ffmpeg がシステムにインストールされている必要がある
（`brew install ffmpeg` / `apt install ffmpeg` 等）。
"""
import datetime
import os
import sys
from pathlib import Path

AUDIO_EXTS = {".m4a", ".mp3", ".wav", ".mp4", ".mpeg", ".mpga", ".webm"}
INBOX_DIR = Path(__file__).resolve().parent.parent / "vault" / "99-Inbox"


def load_model():
    from faster_whisper import WhisperModel

    model_size = os.environ.get("WHISPER_MODEL_SIZE", "base")
    device = os.environ.get("WHISPER_DEVICE", "cpu")
    compute_type = os.environ.get(
        "WHISPER_COMPUTE_TYPE", "int8" if device == "cpu" else "float16"
    )
    print(f"Whisperモデルを読み込み中... (model={model_size}, device={device})")
    return WhisperModel(model_size, device=device, compute_type=compute_type)


def transcribe(model, audio_path: Path) -> str:
    segments, _info = model.transcribe(str(audio_path), language="ja")
    return "".join(segment.text for segment in segments).strip()


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

    model = load_model()

    for audio_path in audio_files:
        print(f"文字起こし中: {audio_path.name}")
        text = transcribe(model, audio_path)
        captured = captured_timestamp(audio_path)

        note_path = audio_path.with_suffix(".md")
        model_size = os.environ.get("WHISPER_MODEL_SIZE", "base")
        note_path.write_text(
            f"---\nsource: ios-journal\ncaptured: {captured}\n"
            f"transcribed_by: local-whisper ({model_size})\n---\n\n{text}\n",
            encoding="utf-8",
        )
        audio_path.unlink()
        print(f"  -> {note_path.name} を作成し、音声ファイルを削除しました。")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
