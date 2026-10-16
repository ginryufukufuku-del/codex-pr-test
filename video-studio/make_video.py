#!/usr/bin/env python3
"""脚本・絵コンテ スタジオのプロジェクト JSON から動画を組み立てる。

必要なもの: Python 3.8 以上、ffmpeg(PATH に通っていること)。追加ライブラリは不要。

使い方:
  python3 make_video.py project.json --media ./media --out ./build

各カットの素材は次の順で探す:
  1. カットの "media"(動画スタジオで割り当てたファイル名)
  2. media フォルダ内の C001.mp4 / C1.mov / C001.png のようなカット番号のファイル
  3. どちらもなければ、手描き絵コンテ、または文字のカード(素材待ち)で尺を埋める

出力(--out フォルダ):
  segments/C001.mp4 …  カットごとに尺・解像度・fps をそろえた動画
  <タイトル>.mp4       全カットをつないだ動画(--burn-subs で字幕を焼き込み)
  <タイトル>.srt       セリフの字幕
  <タイトル>.edl       CMX3600 形式の編集リスト(segments を参照)
  resolve_import.py    DaVinci Resolve に読み込ませるスクリプト
"""
import argparse, base64, json, os, re, shutil, subprocess, sys, tempfile, textwrap
from pathlib import Path

SIZES = {"16:9": (1920, 1080), "9:16": (1080, 1920), "1:1": (1080, 1080), "2.39:1": (1920, 804), "4:3": (1440, 1080)}
VIDEO_EXT = {".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi"}
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}
FONT_CANDIDATES = [
    "/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc", "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "C:/Windows/Fonts/meiryo.ttc", "C:/Windows/Fonts/YuGothB.ttc", "C:/Windows/Fonts/msgothic.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc", "/usr/share/fonts/truetype/ipafont-gothic/ipag.ttf",
    "/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf", "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
]


def die(msg):
    print("エラー: " + msg, file=sys.stderr)
    sys.exit(1)


def run(cmd):
    r = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if r.returncode != 0:
        die("ffmpeg が失敗しました:\n" + " ".join(cmd) + "\n" + r.stderr[-1500:])


def find_font(user_font):
    if user_font:
        if not Path(user_font).exists():
            die(f"フォントが見つかりません: {user_font}")
        return user_font
    for f in FONT_CANDIDATES:
        if Path(f).exists():
            return f
    if shutil.which("fc-match"):
        r = subprocess.run(["fc-match", "-f", "%{file}", ":lang=ja"], stdout=subprocess.PIPE, text=True)
        if r.stdout and Path(r.stdout).exists():
            return r.stdout
    return None


def ff_path(p):
    """ffmpeg のフィルタ引数用にパスをエスケープする(Windows のドライブ文字の : も含む)。"""
    return str(p).replace("\\", "/").replace(":", "\\:").replace("'", "\\'")


def tc(sec, fps, hour=0):
    f = round(sec * fps)
    return f"{hour + f // (3600 * fps):02d}:{f // (60 * fps) % 60:02d}:{f // fps % 60:02d}:{f % fps:02d}"


def srt_time(sec):
    ms = round(sec * 1000)
    return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"


def dialogue_lines(text, keep_names=False):
    out = []
    for line in (text or "").splitlines():
        line = line.strip()
        if not line:
            continue
        m = re.match(r"^([^「」：:]{1,20})「(.*?)」?$", line) or re.match(r"^([^：:「]{1,20})[：:]\s*(.+)$", line)
        if m:
            out.append(f"{m.group(1)}「{m.group(2)}」" if keep_names else m.group(2))
        else:
            out.append(line)
    return out


def flat_cuts(project):
    order = [b["id"] for b in project.get("beats", [])]
    scenes = sorted(enumerate(project.get("scenes", [])),
                    key=lambda x: (order.index(x[1].get("beatId")) if x[1].get("beatId") in order else 999, x[0]))
    n, t, rows = 0, 0.0, []
    for si, (_, s) in enumerate(scenes, 1):
        for c in s.get("cuts", []):
            n += 1
            sec = max(0.5, float(c.get("sec") or 0))
            rows.append({"no": n, "scene": si, "s": s, "c": c, "start": t, "sec": sec})
            t += sec
    return rows


def find_media(row, media_dir):
    c = row["c"]
    if media_dir is None:
        return None
    if c.get("media"):
        p = media_dir / c["media"]
        if p.exists():
            return p
    for stem in (f"C{row['no']:03d}", f"C{row['no']}", f"c{row['no']:03d}", f"c{row['no']}"):
        for ext in sorted(VIDEO_EXT | IMAGE_EXT):
            p = media_dir / (stem + ext)
            if p.exists():
                return p
    return None


def seg_name(row):
    return "C%03d.mp4" % row["no"]


def has_audio(path):
    if not shutil.which("ffprobe"):
        return False
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", str(path)],
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    return bool(r.stdout.strip())


def card_text(row, project):
    c, s = row["c"], row["s"]
    head = f"C{row['no']}  {c.get('shot', '')}・{c.get('angle', '')}・{c.get('move', '')}   {row['sec']:g}秒"
    place = f"S{row['scene']} ○{s.get('place') or '場所未定'}（{s.get('time', '')}）"
    body = "\n".join(textwrap.wrap(c.get("action") or "", 26)) or "（ト書きなし）"
    return f"{head}\n{place}\n\n{body}\n\n［素材待ち：{c.get('method') or '未定'}］"


def build_segment(row, project, media, out, W, H, fps, font, tmp):
    sec = row["sec"]
    fit = f"scale={W}:{H}:force_original_aspect_ratio=decrease,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps={fps},format=yuv420p"
    enc = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-r", str(fps), "-c:a", "aac", "-ar", "48000", "-ac", "2", "-t", f"{sec:.3f}", "-shortest"]
    silence = ["-f", "lavfi", "-t", f"{sec:.3f}", "-i", "anullsrc=r=48000:cl=stereo"]
    c = row["c"]
    if media and media.suffix.lower() in VIDEO_EXT:
        start = max(0.0, float(c.get("mediaIn") or 0))
        # 素材が短いときは最後のフレームを止めて尺を埋める
        vf = f"{fit},tpad=stop_mode=clone:stop_duration={sec:.3f}"
        if has_audio(media):
            cmd = ["ffmpeg", "-y", "-ss", f"{start:.3f}", "-i", str(media), "-filter_complex",
                   f"[0:v]{vf}[v];[0:a]aresample=48000,apad[a]", "-map", "[v]", "-map", "[a]"]
        else:
            cmd = ["ffmpeg", "-y", "-ss", f"{start:.3f}", "-i", str(media), *silence, "-filter_complex", f"[0:v]{vf}[v]", "-map", "[v]", "-map", "1:a"]
        run(cmd + enc + [str(out)])
        return "素材(動画)"
    if media and media.suffix.lower() in IMAGE_EXT:
        run(["ffmpeg", "-y", "-loop", "1", "-i", str(media), *silence, "-filter_complex", f"[0:v]{fit}[v]", "-map", "[v]", "-map", "1:a"] + enc + [str(out)])
        return "素材(静止画)"
    sketch = c.get("sketch") or ""
    if sketch.startswith("data:image/"):
        m = re.match(r"data:image/(\w+);base64,(.*)", sketch, re.S)
        if m:
            img = Path(tmp) / f"sketch_{row['no']}.{ 'jpg' if m.group(1) == 'jpeg' else m.group(1)}"
            img.write_bytes(base64.b64decode(m.group(2)))
            label = ""
            if font:
                tf = Path(tmp) / f"label_{row['no']}.txt"
                tf.write_text(f"C{row['no']}  絵コンテ（素材待ち）", encoding="utf-8")
                label = f",drawtext=fontfile='{ff_path(font)}':textfile='{ff_path(tf)}':fontcolor=white:fontsize={H // 30}:box=1:boxcolor=black@0.55:boxborderw={H // 90}:x={W // 40}:y=h-th-{H // 20}"
            run(["ffmpeg", "-y", "-loop", "1", "-i", str(img), *silence, "-filter_complex", f"[0:v]{fit}{label}[v]", "-map", "[v]", "-map", "1:a"] + enc + [str(out)])
            return "絵コンテ"
    vf = f"color=c=0x1B2430:s={W}x{H}:r={fps}"
    draw = ""
    if font:
        tf = Path(tmp) / f"card_{row['no']}.txt"
        tf.write_text(card_text(row, project), encoding="utf-8")
        draw = f",drawtext=fontfile='{ff_path(font)}':textfile='{ff_path(tf)}':fontcolor=0xE4E9ED:fontsize={H // 22}:line_spacing={H // 60}:x={W // 14}:y={H // 8}"
    run(["ffmpeg", "-y", "-f", "lavfi", "-t", f"{sec:.3f}", "-i", vf, *silence, "-filter_complex", f"[0:v]format=yuv420p{draw}[v]", "-map", "[v]", "-map", "1:a"] + enc + [str(out)])
    return "カード"


def write_srt(rows, path, keep_names):
    n, out = 0, []
    for r in rows:
        lines = dialogue_lines(r["c"].get("dialogue"), keep_names)
        if not lines:
            continue
        n += 1
        out.append(f"{n}\n{srt_time(r['start'])} --> {srt_time(r['start'] + r['sec'] - 0.05)}\n" + "\n".join(lines) + "\n")
    path.write_text("\n".join(out), encoding="utf-8")
    return n


def write_edl(rows, path, title, fps):
    out = [f"TITLE: {title}", "FCM: NON-DROP FRAME", ""]
    for r in rows:
        name = f"C{r['no']:03d}"
        out.append(f"{r['no']:03d}  {name:<8} V     C        {tc(0, fps)} {tc(r['sec'], fps)} {tc(r['start'], fps, 1)} {tc(r['start'] + r['sec'], fps, 1)}")
        out.append(f"* FROM CLIP NAME: {name}.mp4")
        if r["c"].get("action"):
            out.append(f"* COMMENT: {r['c']['action'][:60]}")
        out.append("")
    path.write_text("\n".join(out), encoding="utf-8")


RESOLVE_TEMPLATE = '''# DaVinci Resolve 取り込みスクリプト(make_video.py が生成)
# 使い方: Resolve でプロジェクトを開き、メニュー「ワークスペース > スクリプト」から実行する。
# 置き場所:
#   Mac:     ~/Library/Application Support/Blackmagic Design/DaVinci Resolve/Fusion/Scripts/Utility/
#   Windows: %APPDATA%\\Blackmagic Design\\DaVinci Resolve\\Support\\Fusion\\Scripts\\Utility\\
# 無料版でも、Resolve のメニューから実行するスクリプトは動きます。
import os

SEGMENTS = __SEGMENTS__
TIMELINE_NAME = __NAME__
FPS = __FPS__
SRT = __SRT__


def get_resolve():
    g = globals()
    if "resolve" in g and g["resolve"]:
        return g["resolve"]
    if "app" in g:
        return g["app"].GetResolve()
    import DaVinciResolveScript as dvr
    return dvr.scriptapp("Resolve")


resolve = get_resolve()
project = resolve.GetProjectManager().GetCurrentProject()
if not project:
    raise SystemExit("プロジェクトを開いてから実行してください")
try:
    project.SetSetting("timelineFrameRate", str(FPS))
except Exception:
    pass
mp = project.GetMediaPool()
missing = [p for p in SEGMENTS if not os.path.exists(p)]
if missing:
    raise SystemExit("見つからないファイルがあります: " + ", ".join(missing[:5]))
items = mp.ImportMedia(SEGMENTS) or []
by_name = {it.GetClipProperty("File Name"): it for it in items}
ordered = [by_name.get(os.path.basename(p)) for p in SEGMENTS]
if None in ordered:
    raise SystemExit("取り込みに失敗したクリップがあります。メディアプールを確認してください")
tl = mp.CreateEmptyTimeline(TIMELINE_NAME)
project.SetCurrentTimeline(tl)
mp.AppendToTimeline(ordered)
print(f"タイムライン「{TIMELINE_NAME}」に {len(ordered)} カットを並べました。")
if SRT and os.path.exists(SRT):
    mp.ImportMedia([SRT])
    print("字幕(SRT)をメディアプールに読み込みました。タイムラインへドラッグして配置してください。")
'''


def main():
    ap = argparse.ArgumentParser(description="脚本・絵コンテ スタジオの JSON から動画を組み立てる")
    ap.add_argument("project", help="プロジェクト JSON")
    ap.add_argument("--media", help="素材フォルダ(C001.mp4 などを置く)")
    ap.add_argument("--out", default="build", help="出力フォルダ(既定: build)")
    ap.add_argument("--height", type=int, help="出力の高さ(例: 720 で軽い下書き)")
    ap.add_argument("--fps", type=int, help="フレームレート(既定: プロジェクトの設定)")
    ap.add_argument("--burn-subs", action="store_true", help="セリフを字幕として焼き込む")
    ap.add_argument("--keep-names", action="store_true", help="字幕に話者名を残す")
    ap.add_argument("--font", help="日本語フォントのパス(自動で見つからないとき)")
    a = ap.parse_args()

    if not shutil.which("ffmpeg"):
        die("ffmpeg が見つかりません。Mac は `brew install ffmpeg`、Windows は ffmpeg.org から入手して PATH を通してください")
    project = json.loads(Path(a.project).read_text(encoding="utf-8"))
    rows = flat_cuts(project)
    if not rows:
        die("カットがありません")
    fps = a.fps or int(project.get("fps") or 24)
    W, H = SIZES.get(project.get("aspect"), SIZES["16:9"])
    if a.height:
        W, H = round(W * a.height / H / 2) * 2, round(a.height / 2) * 2
    media_dir = Path(a.media) if a.media else None
    if media_dir and not media_dir.is_dir():
        die(f"素材フォルダがありません: {media_dir}")
    font = find_font(a.font)
    if not font:
        print("注意: 日本語フォントが見つからないため、素材待ちカードに文字を入れません(--font で指定できます)")

    out = Path(a.out).resolve()
    seg_dir = out / "segments"
    seg_dir.mkdir(parents=True, exist_ok=True)
    title = re.sub(r'[\\/:*?"<>|]', "_", project.get("title") or "untitled")
    stats = {}
    with tempfile.TemporaryDirectory() as tmp:
        for r in rows:
            seg = seg_dir / seg_name(r)
            kind = build_segment(r, project, find_media(r, media_dir), seg, W, H, fps, font, tmp)
            stats[kind] = stats.get(kind, 0) + 1
            print(f"  C{r['no']:03d} {r['sec']:>5g}秒  {kind}")
        lst = Path(tmp) / "list.txt"
        lst.write_text("".join("file '%s'\n" % (seg_dir / seg_name(r)).as_posix() for r in rows), encoding="utf-8")
        srt = out / f"{title}.srt"
        n_sub = write_srt(rows, srt, a.keep_names)
        movie = out / f"{title}.mp4"
        if a.burn_subs and n_sub:
            style = f"FontSize={max(12, H // 40)},Outline=2,MarginV={H // 40}"
            if font:
                style += ",FontName=" + Path(font).stem
            run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(lst), "-vf",
                 f"subtitles='{ff_path(srt)}':force_style='{style}'" + (f":fontsdir='{ff_path(Path(font).parent)}'" if font else ""),
                 "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "copy", "-movflags", "+faststart", str(movie)])
        else:
            run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy", "-movflags", "+faststart", str(movie)])
    write_edl(rows, out / f"{title}.edl", project.get("title") or "untitled", fps)
    segs = [str((seg_dir / seg_name(r)).resolve()) for r in rows]
    script = (RESOLVE_TEMPLATE.replace("__SEGMENTS__", json.dumps(segs, ensure_ascii=False, indent=1))
              .replace("__NAME__", json.dumps(project.get("title") or "untitled", ensure_ascii=False))
              .replace("__FPS__", str(fps)).replace("__SRT__", json.dumps(str(srt.resolve()), ensure_ascii=False)))
    (out / "resolve_import.py").write_text(script, encoding="utf-8")
    total = sum(r["sec"] for r in rows)
    print(f"\n完成: {movie}  ({W}x{H}, {fps}fps, {int(total // 60)}分{total % 60:g}秒, {len(rows)}カット)")
    print("  内訳: " + "、".join(f"{k} {v}" for k, v in stats.items()))
    print(f"  字幕: {srt.name}({n_sub}件)  編集リスト: {title}.edl  Resolve用: resolve_import.py")


if __name__ == "__main__":
    main()
