#!/usr/bin/env python3
"""Draws the wallpaper backgrounds offered in the studio panel. Procedural, so there is no third-party artwork to license.

Writes the same files to public/backgrounds (the player) and exporter/backgrounds (the MP4 export), plus swatch thumbnails in public/backgrounds/thumbs.
Run: python3 scripts/make-backgrounds.py
"""
import os
import numpy as np
from PIL import Image

W, H = 1920, 1080
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = [os.path.join(ROOT, "public", "backgrounds"), os.path.join(ROOT, "exporter", "backgrounds")]


def rgb(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.float64)


def grid():
    y, x = np.mgrid[0:H, 0:W].astype(np.float64)
    return x / W, y / H


def mesh(base, blobs, seed):
    """Soft colour fields: each blob is (x, y, radius, colour); colours blend by Gaussian weight over a base colour."""
    x, y = grid()
    aspect = W / H
    rng = np.random.default_rng(seed)
    out = np.zeros((H, W, 3))
    total = np.full((H, W), 0.02)
    out += rgb(base) * 0.02
    for bx, by, r, color in blobs:
        wobble = 1 + 0.15 * np.sin(6 * x + rng.uniform(0, 6)) * np.sin(5 * y + rng.uniform(0, 6))
        d = ((x - bx) * aspect) ** 2 + (y - by) ** 2
        w = np.exp(-d / (2 * (r * wobble) ** 2))
        out += w[..., None] * rgb(color)
        total += w
    return out / total[..., None]


def hills(sky, layers, seed):
    """A vertical sky and layered silhouettes, each layer lighter at the ridge and darker below."""
    x, y = grid()
    rng = np.random.default_rng(seed)
    top, bottom = rgb(sky[0]), rgb(sky[1])
    img = top + (bottom - top) * y[..., None] ** 1.2
    for base, amp, color_a, color_b in layers:
        ridge = base + sum(
            amp / (k + 1) * np.sin(x * (2.2 + k * 2.7) * np.pi + rng.uniform(0, 6.3)) for k in range(4)
        )
        inside = np.clip((y - ridge) * 14, 0, 1)
        depth = np.clip((y - ridge) * 2.2, 0, 1)
        shade = rgb(color_a)[None, None, :] + (rgb(color_b) - rgb(color_a))[None, None, :] * depth[..., None]
        img = img * (1 - inside[..., None]) + shade * inside[..., None]
    return img


def ribbons(colors, seed):
    """Wide diagonal bands of colour that fold over each other."""
    x, y = grid()
    rng = np.random.default_rng(seed)
    phase = rng.uniform(0, 6.3, 4)
    t = (x * 0.9 + y * 0.6) + 0.18 * np.sin(x * 5 + phase[0]) + 0.14 * np.sin(y * 7 + phase[1]) + 0.08 * np.sin((x + y) * 11 + phase[2])
    t = (np.sin(t * 2.4 * np.pi + phase[3]) + 1) / 2
    stops = [rgb(c) for c in colors]
    n = len(stops) - 1
    pos = t * n
    i = np.clip(pos.astype(int), 0, n - 1)
    f = (pos - i)[..., None]
    arr = np.stack(stops)
    img = arr[i] * (1 - f) + arr[i + 1] * f
    # soft light from the top left, so the folds read as surfaces
    light = 1 + 0.18 * np.cos((x * 0.8 + y * 0.5) * 3.1 * np.pi) * (1 - y * 0.4)
    return img * light[..., None]


def finish(img, name):
    rng = np.random.default_rng(7)
    # a little grain hides gradient banding in the JPEG and in the video
    img = img + rng.normal(0, 1.6, img.shape)
    img = np.clip(img, 0, 255).astype(np.uint8)
    picture = Image.fromarray(img)
    for folder in OUT:
        os.makedirs(folder, exist_ok=True)
        picture.save(os.path.join(folder, name), quality=84, optimize=True, progressive=True)
    # Small copies for the swatches in the studio panel, so opening it does not load ten full wallpapers.
    thumbs = os.path.join(OUT[0], "thumbs")
    os.makedirs(thumbs, exist_ok=True)
    picture.resize((96, 54), Image.LANCZOS).save(os.path.join(thumbs, name), quality=80, optimize=True)


finish(mesh("#0b1d3a", [(0.1, 0.2, 0.30, "#14b8a6"), (0.55, 0.05, 0.28, "#22d3ee"), (0.9, 0.35, 0.30, "#7c3aed"), (0.35, 0.95, 0.35, "#1e3a8a"), (0.85, 0.95, 0.25, "#a855f7")], 1), "aurora.jpg")
finish(mesh("#3b0a1a", [(0.1, 0.9, 0.35, "#ea580c"), (0.6, 0.1, 0.30, "#db2777"), (0.95, 0.7, 0.28, "#f59e0b"), (0.3, 0.3, 0.25, "#9f1239")], 2), "ember.jpg")
finish(mesh("#042f4a", [(0.2, 0.15, 0.32, "#0891b2"), (0.8, 0.2, 0.28, "#34d399"), (0.5, 0.9, 0.35, "#1d4ed8"), (0.05, 0.85, 0.22, "#14b8a6")], 3), "lagoon.jpg")
finish(mesh("#2e1065", [(0.15, 0.25, 0.30, "#c026d3"), (0.75, 0.1, 0.30, "#f472b6"), (0.9, 0.85, 0.32, "#6d28d9"), (0.35, 0.95, 0.28, "#a21caf")], 4), "orchid.jpg")
finish(mesh("#fde2cf", [(0.1, 0.2, 0.30, "#fbcfe8"), (0.8, 0.15, 0.30, "#c7d2fe"), (0.5, 0.95, 0.35, "#fde68a"), (0.95, 0.9, 0.25, "#fdba74")], 5), "sorbet.jpg")
finish(mesh("#0f172a", [(0.2, 0.2, 0.35, "#334155"), (0.85, 0.3, 0.30, "#1e293b"), (0.6, 0.95, 0.30, "#475569"), (0.05, 0.9, 0.25, "#1e3a8a")], 6), "slate.jpg")
finish(hills(("#fcd9b6", "#f9a875"), [
    (0.52, 0.07, "#f2a477", "#c8603f"),
    (0.66, 0.06, "#d9805a", "#8c3f33"),
    (0.80, 0.05, "#a8503f", "#4d1f2c"),
], 11), "dunes.jpg")
finish(hills(("#1e1b4b", "#6366f1"), [
    (0.50, 0.07, "#4f46e5", "#312e81"),
    (0.64, 0.06, "#3730a3", "#1e1b4b"),
    (0.78, 0.05, "#1e1b4b", "#0f0d2e"),
], 12), "hills.jpg")
finish(ribbons(["#1e1b4b", "#7c3aed", "#db2777", "#38bdf8", "#1e1b4b"], 21), "ribbons.jpg")
finish(ribbons(["#022c3a", "#0e7490", "#67e8f9", "#0e7490", "#022c3a"], 22), "tide.jpg")
print("wrote", len([f for f in os.listdir(OUT[0]) if f.endswith(".jpg")]), "wallpapers to", ", ".join(OUT))
