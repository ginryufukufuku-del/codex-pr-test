"""Canvaからダウンロードした画像を、Macアプリ用アイコン(1024x1024・角丸・外側は透明)に整える。
使い方: python3 scripts/make-icon.py build/mascot-source.png build/icon.png   (Pillow が必要: pip3 install pillow)
"""
import sys
from PIL import Image, ImageChops, ImageDraw

src, dst = sys.argv[1], sys.argv[2]
im = Image.open(src).convert("RGB")

# 外側の白い余白を取り除く(絵の部分の外接四角形を求める)
diff = ImageChops.difference(im, Image.new("RGB", im.size, (255, 255, 255))).convert("L").point(lambda v: 255 if v > 24 else 0)
l, t, r, b = diff.getbbox() or (0, 0, im.width, im.height)
side = min(r - l, b - t)
trim = max(1, int(side * 0.015))                 # 縁の白いにじみを落とす
cx, cy = (l + r) // 2, (t + b) // 2
half = side // 2 - trim
im = im.crop((cx - half, cy - half, cx + half, cy + half))

# Apple風: 1024キャンバスの中に 824px の角丸アイコン(余白100px)
ICON, CANVAS = 824, 1024
im = im.resize((ICON, ICON), Image.LANCZOS)
mask = Image.new("L", (ICON * 4, ICON * 4), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, ICON * 4 - 1, ICON * 4 - 1], radius=int(ICON * 4 * 0.2237), fill=255)
mask = mask.resize((ICON, ICON), Image.LANCZOS)
out = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
out.paste(im, ((CANVAS - ICON) // 2, (CANVAS - ICON) // 2), mask)
out.save(dst)
print("saved", dst, out.size)
