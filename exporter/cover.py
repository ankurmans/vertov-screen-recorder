"""
A designed cover for a video, so a library of screen recordings doesn't look like a wall of near-identical
screenshots: dark branded background, the title in Archivo Black, a red length pill, the most detailed frame as an
inset screen card, and the presenter's camera in a circle when there is one. 1280×720 JPEG.
"""
import os

from PIL import Image, ImageDraw, ImageFilter, ImageFont

from media import download
from poster import best_frame

W, H = 1280, 720
FONTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fonts")
PAPER = (246, 246, 242)
RED = (220, 38, 38)
MARGIN = 56


def hex_rgb(value, fallback):
    try:
        value = value.lstrip("#")
        return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))
    except (AttributeError, ValueError, IndexError):
        return fallback


def length_label(seconds):
    # Rounded down, never up: a true length is what makes the pill worth reading.
    if seconds >= 60:
        return f"{int(seconds // 60)} min"
    return f"{max(10, int(seconds // 10) * 10)} sec"


def wrap(draw, text, font, width, max_lines):
    words, lines, line = text.split(), [], ""
    for word in words:
        trial = f"{line} {word}".strip()
        if draw.textlength(trial, font=font) <= width or not line:
            line = trial
        else:
            lines.append(line)
            line = word
    if line:
        lines.append(line)
    return lines if len(lines) <= max_lines else None


def fit_title(draw, title, width):
    for size in range(84, 46, -4):
        font = ImageFont.truetype(os.path.join(FONTS, "ArchivoBlack-Regular.ttf"), size)
        lines = wrap(draw, title, font, width, 2)
        if lines:
            return font, lines, size
    font = ImageFont.truetype(os.path.join(FONTS, "ArchivoBlack-Regular.ttf"), 48)
    lines = wrap(draw, title, font, width, 99) or [title]
    if len(lines) > 2:
        lines = [lines[0], lines[1].rstrip(".,") + "…"]
    return font, lines, 48


def rounded(image, radius):
    mask = Image.new("L", image.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, *image.size), radius=radius, fill=255)
    image.putalpha(mask)
    return image


def background(accent):
    base = Image.new("RGB", (W, H), (29, 33, 27))
    glow = Image.new("RGB", (W, H), accent)
    mask = Image.new("L", (W, H), 0)
    ImageDraw.Draw(mask).ellipse((W * 0.35, H * 0.1, W * 1.25, H * 1.4), fill=70)
    mask = mask.filter(ImageFilter.GaussianBlur(160))
    return Image.composite(glow, base, mask)


def cover(job, workdir):
    source = os.path.join(workdir, "video")
    download(job["video_url"], source)
    duration = float(job.get("duration") or 0) or 10.0
    frame_path = best_frame(source, duration, workdir, 1600)
    camera_path = None
    if job.get("camera_url"):
        camera_source = os.path.join(workdir, "camera")
        download(job["camera_url"], camera_source)
        camera_path = best_frame(camera_source, duration, workdir, 800, prefix="camera")

    accent = hex_rgb(job.get("brand_color"), (232, 237, 220))
    canvas = background(accent)
    draw = ImageDraw.Draw(canvas)
    y = draw_text(draw, job, duration)

    # The frame as a screen card filling the space below the title.
    top = y + 26
    card_h = H - top - 36
    card_w = int(card_h * 16 / 9)
    if card_w > W - 2 * MARGIN - (180 if camera_path else 0):
        card_w = W - 2 * MARGIN - (180 if camera_path else 0)
        card_h = int(card_w * 9 / 16)
    frame = Image.open(frame_path).convert("RGB")
    scale = max(card_w / frame.width, card_h / frame.height)
    frame = frame.resize((int(frame.width * scale), int(frame.height * scale)), Image.LANCZOS)
    left_crop = (frame.width - card_w) // 2
    frame = frame.crop((left_crop, 0, left_crop + card_w, card_h)).convert("RGBA")
    # With a camera circle on the left the card sits right; without one it's centred under the title.
    card_x = W - MARGIN - card_w if camera_path else (W - card_w) // 2
    shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle((card_x + 6, top + 18, card_x + card_w + 6, top + card_h + 18), radius=22, fill=(0, 0, 0, 150))
    canvas = Image.alpha_composite(canvas.convert("RGBA"), shadow.filter(ImageFilter.GaussianBlur(22)))
    canvas.alpha_composite(rounded(frame, 18), (card_x, top))
    ImageDraw.Draw(canvas).rounded_rectangle((card_x, top, card_x + card_w, top + card_h), radius=18, outline=(255, 255, 255, 40), width=2)

    if camera_path:
        size_c = 230
        face = Image.open(camera_path).convert("RGB")
        side = min(face.width, face.height)
        face = face.crop(((face.width - side) // 2, (face.height - side) // 2, (face.width + side) // 2, (face.height + side) // 2))
        face = face.resize((size_c, size_c), Image.LANCZOS).convert("RGBA")
        mask = Image.new("L", (size_c, size_c), 0)
        ImageDraw.Draw(mask).ellipse((0, 0, size_c, size_c), fill=255)
        face.putalpha(mask)
        cx, cy = MARGIN, H - 36 - size_c
        ImageDraw.Draw(canvas).ellipse((cx - 7, cy - 7, cx + size_c + 7, cy + size_c + 7), fill=PAPER)
        canvas.alpha_composite(face, (cx, cy))

    out = os.path.join(workdir, "cover.jpg")
    canvas.convert("RGB").save(out, "JPEG", quality=88)
    return out


def draw_text(draw, job, duration):
    """Length pill, then the title under it across the full width. Returns the y where the title ends."""
    pill_font = ImageFont.truetype(os.path.join(FONTS, "Archivo-Variable.ttf"), 30)
    try:
        pill_font.set_variation_by_name("Bold")
    except (OSError, ValueError):
        pass
    label = length_label(duration)
    pill_w = int(draw.textlength(label, font=pill_font)) + 40
    draw.rounded_rectangle((MARGIN, 44, MARGIN + pill_w, 44 + 46), radius=23, fill=RED)
    draw.text((MARGIN + 20, 44 + 23), label, font=pill_font, fill="white", anchor="lm")
    title = (job.get("title") or "Untitled video").strip()
    font, lines, size = fit_title(draw, title, job.get("title_width") or W - 2 * MARGIN)
    y = 112
    for line in lines:
        draw.text((MARGIN, y), line, font=font, fill=PAPER, stroke_width=job.get("stroke", 0), stroke_fill=(0, 0, 0))
        y += int(size * 1.05)
    return y


def ai_cover(job, workdir):
    """An AI-made scene (no text) with the title and length set on top, over a dark fade so they always read."""
    path = os.path.join(workdir, "background")
    download(job["background_url"], path)
    scene = Image.open(path).convert("RGB")
    scale = max(W / scene.width, H / scene.height)
    scene = scene.resize((int(scene.width * scale) + 1, int(scene.height * scale) + 1), Image.LANCZOS)
    left, top = (scene.width - W) // 2, (scene.height - H) // 2
    canvas = scene.crop((left, top, left + W, top + H)).convert("RGBA")
    fade = Image.new("L", (W, H), 0)
    fade_draw = ImageDraw.Draw(fade)
    for row in range(0, 340):
        fade_draw.line((0, row, W, row), fill=int(200 * (1 - row / 340) ** 1.4))
    shade = Image.new("RGBA", (W, H), (12, 14, 11, 255))
    shade.putalpha(fade)
    canvas = Image.alpha_composite(canvas, shade)
    # The scene puts a person on the right, so the title keeps to the left 60%.
    draw_text(ImageDraw.Draw(canvas), {**job, "stroke": 1, "title_width": int(W * 0.6) - MARGIN}, float(job.get("duration") or 0) or 10.0)
    out = os.path.join(workdir, "cover.jpg")
    canvas.convert("RGB").save(out, "JPEG", quality=90)
    return out
