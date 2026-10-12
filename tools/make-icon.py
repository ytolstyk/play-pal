#!/usr/bin/env python3
"""Renders build/icon.png and build/icon.icns (macOS) for Play Pal.

A dark app tile with a waveform; the "played" part glows amber, one bar is a green cue marker,
and a play triangle sits on top. Needs Pillow and macOS `iconutil`. Re-run only to change the design:
    python3 tools/make-icon.py
"""
import os
import subprocess
import tempfile

from PIL import Image, ImageDraw, ImageFilter

S = 4096  # supersampled canvas; downscaled for output
UNIT = S / 1024

BG_TOP, BG_BOTTOM = (36, 39, 47), (16, 17, 20)
AMBER, AMBER_DIM = (255, 178, 62), (150, 108, 45)
BAR, GREEN = (68, 74, 88), (76, 195, 138)


def u(v):
    return int(round(v * UNIT))


def gradient(size, top, bottom):
    img = Image.new("RGB", (size, size))
    px = ImageDraw.Draw(img)
    for y in range(size):
        t = y / (size - 1)
        px.line([(0, y), (size, y)], fill=tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3)))
    return img


def render():
    canvas = Image.new("RGBA", (S, S), (0, 0, 0, 0))

    # Tile on Apple's icon grid: 824px of the 1024 canvas, rounded.
    tile_box = (u(100), u(100), u(924), u(924))
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle(tile_box, radius=u(185), fill=255)
    tile = gradient(S, BG_TOP, BG_BOTTOM).convert("RGBA")
    canvas.paste(tile, (0, 0), mask)

    # Soft drop shadow under the tile.
    shadow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle(
        (u(100), u(118), u(924), u(942)), radius=u(185), fill=(0, 0, 0, 110)
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(u(14)))
    canvas = Image.alpha_composite(shadow, canvas)

    draw = ImageDraw.Draw(canvas)

    # Waveform: bars, left of the playhead are "played" (amber), one is a cue (green).
    heights = [70, 120, 180, 110, 230, 150, 90, 200, 260, 140, 100, 190, 120, 70, 100]
    n = len(heights)
    left, right, mid_y = 212, 812, 712
    pitch = (right - left) / (n - 1)
    bar_w = 26
    playhead = 6  # bars with index <= playhead are played
    cue_index = 9
    for i, h in enumerate(heights):
        x = left + pitch * i
        color = GREEN if i == cue_index else (AMBER_DIM if i <= playhead else BAR)
        draw.rounded_rectangle(
            (u(x - bar_w / 2), u(mid_y - h / 2), u(x + bar_w / 2), u(mid_y + h / 2)),
            radius=u(bar_w / 2),
            fill=color,
        )

    # Playhead line.
    px_x = left + pitch * (playhead + 0.5)
    draw.rounded_rectangle(
        (u(px_x - 6), u(mid_y - 135), u(px_x + 6), u(mid_y + 135)), radius=u(6), fill=AMBER
    )

    # Play triangle with rounded corners (polygon + round-joined outline), softly glowing.
    cx, cy, r = 530, 368, 150
    pts = [(cx - r * 0.78, cy - r), (cx - r * 0.78, cy + r), (cx + r * 1.02, cy)]
    scaled = [(u(x), u(y)) for x, y in pts]
    glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(glow).polygon(scaled, fill=AMBER + (170,))
    glow = glow.filter(ImageFilter.GaussianBlur(u(34)))
    canvas = Image.alpha_composite(canvas, glow)
    draw = ImageDraw.Draw(canvas)
    draw.polygon(scaled, fill=AMBER)
    draw.line(scaled + [scaled[0], scaled[1]], fill=AMBER, width=u(46), joint="curve")
    for x, y in scaled:
        draw.ellipse((x - u(23), y - u(23), x + u(23), y + u(23)), fill=AMBER)

    return canvas.resize((1024, 1024), Image.LANCZOS)


def main():
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "build")
    os.makedirs(root, exist_ok=True)
    icon = render()
    icon.save(os.path.join(root, "icon.png"))
    with tempfile.TemporaryDirectory() as tmp:
        iconset = os.path.join(tmp, "icon.iconset")
        os.makedirs(iconset)
        for size in (16, 32, 128, 256, 512):
            icon.resize((size, size), Image.LANCZOS).save(os.path.join(iconset, f"icon_{size}x{size}.png"))
            icon.resize((size * 2, size * 2), Image.LANCZOS).save(
                os.path.join(iconset, f"icon_{size}x{size}@2x.png")
            )
        subprocess.run(
            ["iconutil", "-c", "icns", iconset, "-o", os.path.join(root, "icon.icns")], check=True
        )
    print("wrote build/icon.png and build/icon.icns")


if __name__ == "__main__":
    main()
