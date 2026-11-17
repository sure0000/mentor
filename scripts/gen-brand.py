"""生成 Mentor 品牌图标（应用图标、favicon、Windows/AppX 资源）。用法：python3 scripts/gen-brand.py"""
import math, os, subprocess, shutil, tempfile
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SS = 4  # 超采样
BASE = 1024

BG_TOP = (24, 78, 72)
BG_BOTTOM = (10, 38, 40)
PAGE = (246, 238, 224)
GOLD = (240, 186, 72)


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def bezier(p0, p1, p2, n=60):
    return [
        (
            (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0],
            (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1],
        )
        for t in [i / n for i in range(n + 1)]
    ]


def stroke(d, pts, width, color):
    """沿折线密集盖圆点，得到边缘平滑、端点圆润的笔画"""
    r = width / 2
    step = max(1.0, r / 6)
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        n = max(1, int(math.hypot(x1 - x0, y1 - y0) / step))
        for i in range(n + 1):
            t = i / n
            x, y = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
            d.ellipse([x - r, y - r, x + r, y + r], fill=color)


def star(cx, cy, R, r):
    pts = []
    for i in range(8):
        ang = -math.pi / 2 + i * math.pi / 4
        rad = R if i % 2 == 0 else r
        pts.append((cx + rad * math.cos(ang), cy + rad * math.sin(ang)))
    return pts


def draw_mark(d, s, ox=0, oy=0, scale=1.0, color=PAGE, gold=GOLD, width=64):
    """一本摊开的书，书页轮廓构成字母 M；上方一颗引路的星。坐标基于 1024 画布。"""
    k = s * scale
    P = lambda x, y: (ox * s + x * k, oy * s + y * k)
    w = int(width * k)
    # M：两侧书页外缘 + 中缝
    left = bezier(P(292, 704), P(286, 520), P(300, 392))
    mid_l = bezier(P(300, 392), P(420, 404), P(512, 548))
    mid_r = bezier(P(512, 548), P(604, 404), P(724, 392))
    right = bezier(P(724, 392), P(738, 520), P(732, 704))
    path = left + mid_l[1:] + mid_r[1:] + right[1:]
    stroke(d, path, w, color)
    # 书页底边（两条弧线在中缝相交）
    stroke(d, bezier(P(292, 704), P(410, 668), P(512, 742)), w, color)
    stroke(d, bezier(P(512, 742), P(614, 668), P(732, 704)), w, color)
    # 中缝
    stroke(d, [P(512, 548), P(512, 742)], int(w * 0.55), color)
    # 引路星
    d.polygon(star(*P(512, 266), 92 * k, 24 * k), fill=gold)


def app_icon(size=BASE, inset=100):
    S = size * SS
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    k = S / BASE
    # 阴影
    shadow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    rect = [inset * k, (inset + 12) * k, (BASE - inset) * k, (BASE - inset + 12) * k]
    sd.rounded_rectangle(rect, radius=186 * k, fill=(0, 0, 0, 110))
    shadow = shadow.filter(ImageFilter.GaussianBlur(18 * k))
    img.alpha_composite(shadow)
    # 渐变底
    grad = Image.new("RGBA", (S, S))
    gd = ImageDraw.Draw(grad)
    for y in range(S):
        gd.line([(0, y), (S, y)], fill=lerp(BG_TOP, BG_BOTTOM, y / S) + (255,))
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [inset * k, inset * k, (BASE - inset) * k, (BASE - inset) * k], radius=186 * k, fill=255
    )
    img.paste(grad, (0, 0), mask)
    d = ImageDraw.Draw(img)
    # 星光晕
    glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse([(512 - 120) * k, (266 - 120) * k, (512 + 120) * k, (266 + 120) * k], fill=GOLD + (70,))
    glow = glow.filter(ImageFilter.GaussianBlur(40 * k))
    img.alpha_composite(Image.composite(glow, Image.new("RGBA", (S, S), (0, 0, 0, 0)), mask))
    d = ImageDraw.Draw(img)
    draw_mark(d, k, scale=0.86, ox=72, oy=86)
    return img.resize((size, size), Image.LANCZOS)


def mark_only(size, color, gold):
    """侧边栏用的单色标记（透明底）"""
    S = size * SS
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    k = S / BASE
    draw_mark(ImageDraw.Draw(img), k, scale=1.18, ox=-92, oy=-118, color=color, gold=gold, width=70)
    return img.resize((size, size), Image.LANCZOS)


def save(img, rel, size=None):
    path = os.path.join(ROOT, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    (img.resize((size, size), Image.LANCZOS) if size else img).save(path)
    print("wrote", rel)


def main():
    icon = app_icon()
    save(icon, "assets/icons/512x512.png", 512)
    save(icon, "assets/icons/256x256.png", 256)
    save(icon, "public/assets/icon.png", 512)
    save(icon, "public/favicon.png", 256)
    # Windows .ico（满幅，不留 macOS 的内边距）
    full = app_icon(inset=24)
    full.save(os.path.join(ROOT, "assets/icons/icon.ico"), sizes=[(s, s) for s in (16, 24, 32, 48, 64, 128, 256)])
    full.save(os.path.join(ROOT, "assets/appx/icon.ico"), sizes=[(s, s) for s in (16, 24, 32, 48, 64, 128, 256)])
    print("wrote icon.ico")
    # AppX
    for name, w, h in [
        ("Square150x150Logo.png", 300, 300),
        ("Square44x44Logo.png", 88, 88),
        ("Square44x44Logo.targetsize-256_altform-unplated.png", 88, 88),
        ("Square44x44Logo.targetsize-44_altform-unplated.png", 88, 88),
        ("StoreLogo.png", 100, 100),
    ]:
        save(full, "assets/appx/" + name, w)
    wide = Image.new("RGBA", (620, 300), (0, 0, 0, 0))
    wide.alpha_composite(full.resize((300, 300), Image.LANCZOS), (160, 0))
    save(wide, "assets/appx/Wide310x150Logo.png")
    # macOS .icns
    tmp = tempfile.mkdtemp()
    iconset = os.path.join(tmp, "icon.iconset")
    os.makedirs(iconset)
    for s in (16, 32, 128, 256, 512):
        icon.resize((s, s), Image.LANCZOS).save(os.path.join(iconset, f"icon_{s}x{s}.png"))
        icon.resize((s * 2, s * 2), Image.LANCZOS).save(os.path.join(iconset, f"icon_{s}x{s}@2x.png"))
    subprocess.run(["iconutil", "-c", "icns", iconset, "-o", os.path.join(ROOT, "assets/icons/icon.icns")], check=True)
    shutil.rmtree(tmp)
    print("wrote icon.icns")
    # 侧边栏标记
    save(mark_only(160, (40, 48, 56), GOLD), "src/assets/images/mentor-mark-light.png")
    save(mark_only(160, (236, 232, 222), GOLD), "src/assets/images/mentor-mark-dark.png")


if __name__ == "__main__":
    main()
