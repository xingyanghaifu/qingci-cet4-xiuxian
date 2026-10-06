# -*- coding: utf-8 -*-
"""
生成 og:image 分享卡 src/assets/og-cover.png（1200×630）。

为什么要它：og/twitter 已声明 summary_large_image 但没有图，微信/微博/Twitter/Slack
分享时会降级成裸文字卡片，白丢一次曝光。

设计语言对齐 scripts/make-icons.mjs 的 PWA 图标：暗底 + 玉点金环 + 米色山峦。
不调 AI 绘图接口 —— 这张图是几何构成 + 中文标题，确定性生成即可，
且要跟配色变量同步，靠 AI 出图反而会漂。

运行：python scripts/make-og-cover.py
"""
import math
import os
import random

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "src", "assets", "og-cover.png")

W, H = 1200, 630
BG = (18, 16, 14)          # --bg (dark)
JADE = (14, 107, 83)       # --jade-ink
JADE_LT = (90, 200, 168)   # 玉点
GOLD = (239, 201, 138)     # --gold
WHITE = (246, 236, 223)    # --paper
SOFT = (166, 158, 146)     # --muted
LINE = (58, 52, 45)

# 与站内 mulberry32 同一随机数（seed 固定 → 噪点纹理每次构建一致）
random.seed(1913)


def pick_font(*candidates):
    for name in candidates:
        path = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts", name)
        if os.path.exists(path):
            return path
    raise SystemExit("找不到中文字体：" + "/".join(candidates))


def main():
    img = Image.new("RGB", (W, H), BG)
    px = img.load()

    # 宣纸质感：极淡噪点，与站内 .cloud-weave 同思路，不喧宾夺主
    for _ in range(26000):
        x = random.randrange(W)
        y = random.randrange(H)
        v = px[x, y]
        px[x, y] = (min(255, v[0] + 6), min(255, v[1] + 6), min(255, v[2] + 5))

    d = ImageDraw.Draw(img)

    # 右侧金环（留缺口 = 进度环）+ 玉点，呼应 icon-512
    cx, cy, R = 905, 315, 205
    d.arc([cx - R, cy - R, cx + R, cy + R], start=-108, end=108, fill=GOLD, width=15)
    a = math.radians(-108)
    dx, dy = cx + R * math.cos(a), cy + R * math.sin(a)
    d.ellipse([dx - 21, dy - 21, dx + 21, dy + 21], fill=JADE_LT)

    # 环内三座峰
    base = 470
    d.polygon([(700, base), (772, base - 66), (844, base)], fill=(190, 182, 170))
    d.polygon([(760, base), (840, base - 96), (920, base)], fill=(214, 206, 192))
    d.polygon([(862, base), (942, base - 132), (1022, base)], fill=WHITE)

    f_title = ImageFont.truetype(pick_font("msyhbd.ttc", "msyh.ttc", "simhei.ttf"), 82)
    f_sub = ImageFont.truetype(pick_font("msyh.ttc", "simhei.ttf"), 34)
    f_kicker = ImageFont.truetype(pick_font("msyh.ttc", "simhei.ttf"), 27)
    f_meta = ImageFont.truetype(pick_font("msyh.ttc", "simhei.ttf"), 26)
    f_mark = ImageFont.truetype(pick_font("msyhbd.ttc", "msyh.ttc"), 38)

    d.rounded_rectangle([72, 96, 560, 100], radius=2, fill=JADE)
    d.text((72, 138), "青词天路", font=f_title, fill=WHITE)
    d.text((72, 246), "把四级单词 炼成一场修行", font=f_sub, fill=GOLD)
    d.text((72, 320), "CET-4  4540 词   ·   六种记忆题型   ·   间隔复习", font=f_kicker, fill=SOFT)
    d.text((72, 364), "问道斗法 · 学情看板 · 纯本地运行 · 断网可用", font=f_kicker, fill=SOFT)

    # 底部：方形徽标 + 域名
    d.rounded_rectangle([72, 470, 152, 534], radius=16, fill=JADE)
    d.text((112, 502), "青", font=f_mark, fill=(248, 243, 234), anchor="mm")
    d.text((172, 502), "qingci-cet4-xiuxian.pages.dev", font=f_meta, fill=SOFT, anchor="lm")

    # 古籍框线意象的轻点缀
    d.line([(1112, 486), (1176, 486)], fill=LINE, width=2)
    d.line([(1112, 470), (1112, 502)], fill=LINE, width=2)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    img.save(OUT, "PNG", optimize=True)
    print("og-cover.png 已生成 %dx%d → %s" % (W, H, os.path.relpath(OUT, ROOT)))


if __name__ == "__main__":
    main()