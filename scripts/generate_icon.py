#!/usr/bin/env python3
"""Generate Slicky app icon (cursor + snip motif) and UI assets."""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
ICONS_DIR = ROOT / "src-tauri" / "icons"
PUBLIC_DIR = ROOT / "public"

# Monochrome brand palette
BG_TOP = (18, 18, 18)
BG_BOTTOM = (8, 8, 8)
BG_DARK = (10, 10, 10)


def lerp(a: int, b: int, t: float) -> int:
    return int(a + (b - a) * t)


def gradient_bg(size: int) -> Image.Image:
    """Subtle black → charcoal gradient (no color)."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = (x / size * 0.35 + y / size * 0.65)
            t = max(0.0, min(1.0, t))
            r = lerp(BG_TOP[0], BG_BOTTOM[0], t)
            g = lerp(BG_TOP[1], BG_BOTTOM[1], t)
            b = lerp(BG_TOP[2], BG_BOTTOM[2], t)
            px[x, y] = (r, g, b, 255)
    return img


def rounded_mask(size: int, radius_ratio: float = 0.225) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    r = int(size * radius_ratio)
    draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=r, fill=255)
    return mask


def draw_cursor(draw: ImageDraw.ImageDraw, ox: float, oy: float, scale: float) -> None:
    """macOS-style arrow pointer."""
    pts = [
        (0, 0),
        (0, 22),
        (6, 17),
        (10, 28),
        (14, 26),
        (10, 15),
        (18, 15),
    ]
    scaled = [(ox + x * scale, oy + y * scale) for x, y in pts]
    shadow = [(x + 2 * scale, y + 3 * scale) for x, y in scaled]
    draw.polygon(shadow, fill=(0, 0, 0, 70))
    draw.polygon(scaled, fill=(255, 255, 255, 255))
    draw.line(scaled + [scaled[0]], fill=(20, 20, 28, 200), width=max(1, int(1.2 * scale)))


def draw_snip_rect(draw: ImageDraw.ImageDraw, box: tuple, scale: float) -> None:
    x0, y0, x1, y1 = box
    dash = max(4, int(5 * scale))
    gap = max(3, int(4 * scale))
    color = (255, 255, 255, 200)
    for edge in ("top", "right", "bottom", "left"):
        if edge == "top":
            x, y, x2, y2 = x0, y0, x1, y0
        elif edge == "right":
            x, y, x2, y2 = x1, y0, x1, y1
        elif edge == "bottom":
            x, y, x2, y2 = x0, y1, x1, y1
        else:
            x, y, x2, y2 = x0, y0, x0, y1
        length = math.hypot(x2 - x, y2 - y)
        pos = 0.0
        while pos < length:
            end = min(pos + dash, length)
            t0, t1 = pos / length, end / length
            sx = x + (x2 - x) * t0
            sy = y + (y2 - y) * t0
            ex = x + (x2 - x) * t1
            ey = y + (y2 - y) * t1
            draw.line([(sx, sy), (ex, ey)], fill=color, width=max(2, int(2.5 * scale)))
            pos += dash + gap
    # Corner handles
    r = max(2, int(3 * scale))
    for cx, cy in ((x0, y0), (x1, y0), (x1, y1), (x0, y1)):
        draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(255, 255, 255, 230))


def render_icon(size: int) -> Image.Image:
    """Black app icon (white cursor mark) on a macOS-proportioned rounded square.

    Follows Apple's icon grid: the rounded body is inset ~10% on each side
    (≈824px in a 1024 canvas) with transparent margins and a soft drop shadow,
    so the icon sits at the same size as other Dock apps instead of full-bleed.
    """
    s = size / 1024.0
    icon = Image.new("RGBA", (size, size), (0, 0, 0, 0))

    margin = int(100 * s)
    body = size - 2 * margin
    radius = int(body * 0.2237)  # macOS continuous-corner squircle ≈ 22.37%

    # Soft drop shadow beneath the body, like other macOS icons.
    shadow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    sdraw = ImageDraw.Draw(shadow)
    drop = int(14 * s)
    sdraw.rounded_rectangle(
        (margin, margin + drop, margin + body, margin + body + drop),
        radius=radius,
        fill=(0, 0, 0, 90),
    )
    icon.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(max(1, int(20 * s)))))

    # Rounded body filled with the subtle black → charcoal gradient.
    body_img = gradient_bg(body)
    mask = rounded_mask(body, radius_ratio=radius / body)
    icon.paste(body_img, (margin, margin), mask)

    # White cursor mark, centered within the body.
    draw = ImageDraw.Draw(icon)
    cs = body * 0.0185
    cw, ch = 18 * cs, 28 * cs
    ox = margin + (body - cw) / 2
    oy = margin + (body - ch) / 2
    draw_cursor(draw, ox, oy, cs)

    return icon


def main() -> None:
    ICONS_DIR.mkdir(parents=True, exist_ok=True)
    PUBLIC_DIR.mkdir(parents=True, exist_ok=True)

    master = render_icon(1024)
    master.save(ICONS_DIR / "icon.png", "PNG")

    for sz in (32, 128, 256, 512):
        resized = master.resize((sz, sz), Image.Resampling.LANCZOS)
        resized.save(ICONS_DIR / f"icon_{sz}.png", "PNG")

    ui = master.resize((64, 64), Image.Resampling.LANCZOS)
    ui.save(PUBLIC_DIR / "slickly-icon.png", "PNG")
    ui32 = master.resize((32, 32), Image.Resampling.LANCZOS)
    ui32.save(PUBLIC_DIR / "slickly-icon-32.png", "PNG")

    print(f"wrote {ICONS_DIR / 'icon.png'} (1024×1024)")
    print(f"wrote {PUBLIC_DIR / 'slickly-icon.png'} (64×64 UI)")


if __name__ == "__main__":
    main()
