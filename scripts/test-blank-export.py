"""The viewer copy must hold nothing from a removed stretch, keep the source's timeline and keep everything else, also for
a screen that only sends a frame when something changes. Run: python3 scripts/test-blank-export.py"""
import importlib.util
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile

sys.path.insert(0, "exporter")
spec = importlib.util.spec_from_file_location("exporter", "exporter/server.py")
exporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exporter)
import blank as blank_module  # noqa: E402


def fetch(url, path):
    shutil.copyfile(url.removeprefix("file://"), path)


exporter.download = blank_module.download = fetch
passed = 0


def check(name, condition, detail=""):
    global passed
    assert condition, f"{name} {detail}"
    passed += 1
    print(f"PASS {name}")


def ffmpeg(*arguments):
    subprocess.run(["ffmpeg", "-v", "error", "-y", *arguments], check=True)


def frames(path):
    """(time, mean brightness) of every picture frame."""
    out = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", path, "-map", "0:v", "-vf", "scale=8:8,format=gray", "-f", "rawvideo", "-"],
        capture_output=True, check=True,
    ).stdout
    return [(index / 30, sum(out[at:at + 64]) / 64) for index, at in enumerate(range(0, len(out), 64))]


def loud(path):
    """(time, peak) for every 5 ms of sound."""
    out = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-map", "0:a", "-ac", "1", "-ar", "48000", "-f", "s16le", "-"],
                         capture_output=True, check=True).stdout
    samples = memoryview(out).cast("h")
    return [(at / 48000, max(abs(v) for v in samples[at:at + 240])) for at in range(0, len(samples) - 239, 240)]


def duration(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", path], capture_output=True, text=True, check=True).stdout
    return float(json.loads(out)["format"]["duration"])


def run(root, name, job):
    work = root / name
    work.mkdir()
    return exporter.run_kind("blank", job, str(work))[0]


with tempfile.TemporaryDirectory(prefix="vertov-blank-test-") as directory:
    root = pathlib.Path(directory)
    # Ten seconds of white picture and a steady tone, as a browser records it (VP8 and Opus).
    source = str(root / "source.webm")
    ffmpeg("-f", "lavfi", "-i", "color=c=white:s=320x180:r=30:d=10", "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=48000:duration=10",
           "-c:v", "libvpx", "-b:v", "300k", "-c:a", "libopus", source)
    # Removed: the first second (a trim), 4 to 6 (a cut), everything after 9 (a trim to the end).
    spans = [[0, 1], [4, 6], [9, 9007199254740991]]
    removed = lambda t: t < 1 or 4 <= t < 6 or t >= 9
    out = run(root, "main", {"url": source, "spans": spans, "width": 320, "height": 180})

    check("the copy keeps the source's length", abs(duration(out) - duration(source)) < 0.1, duration(out))
    picture = frames(out)
    shown = [t for t, level in picture if removed(t) and level > 20]
    check("no picture from a removed stretch", not shown, shown[:10])
    # One frame after each stretch is painted too.
    lost = [t for t, level in picture if not removed(t) and not removed(t - 2 / 30) and level < 200]
    check("the kept picture is untouched", not lost, lost[:10])
    sound = loud(out)
    heard = [t for t, peak in sound if removed(t) and removed(t + 0.025) and removed(t - 0.025) and peak > 200]
    check("no sound from a removed stretch", not heard, heard[:10])
    kept = [t for t, peak in sound if not removed(t) and not removed(t + 0.05) and not removed(t - 0.05) and peak < 1000]
    check("the kept sound is still there", not kept, kept[:10])

    # The player comes back on frame ceil(end * 30 + 1): that frame shows the picture, whether or not the end falls on one.
    for end in (3.0, 3.01, 2.99):
        out = run(root, f"resume-{end}", {"url": source, "spans": [[2, end]], "width": 320, "height": 180})
        picture = frames(out)
        back = blank_module.first_clean_frame(end)
        check(f"the picture is back where the player resumes after {end}", picture[back][1] > 200 and picture[back - 1][1] < 20,
              picture[back - 2:back + 1])

    # A still screen: a frame only when it changes. White at 0, red at 2 (inside the cut), nothing more until 8.
    still = str(root / "still.mp4")
    ffmpeg("-f", "lavfi", "-i", "color=c=white:s=320x180:r=1:d=10", "-vf",
           "drawbox=x=0:y=0:w=iw:h=ih:color=gray:t=fill:enable='gte(t,3)',select='eq(n,0)+eq(n,3)+eq(n,9)'", "-fps_mode", "vfr", "-c:v", "libx264", "-bf", "0", still)
    out = run(root, "still", {"url": still, "spans": [[2, 5]], "width": 320, "height": 180})
    picture = frames(out)
    check("a still screen is black through the cut", all(level < 20 for t, level in picture if 2 <= t < 5))
    check("and comes back as it stood then, not black until its next frame", all(100 < level < 200 for t, level in picture if 5.1 <= t < 8.9),
          [(t, level) for t, level in picture if 5.1 <= t < 8.9 and not 100 < level < 200][:5])

    voice = str(root / "voice.mp3")
    ffmpeg("-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100:duration=6", voice)
    out = run(root, "voice", {"url": voice, "spans": [[2, 3]], "audio_only": True})
    sound = loud(out)
    check("narration is silenced in the removed stretch only",
          all(peak < 200 for t, peak in sound if 2.03 <= t < 2.97) and all(peak > 1000 for t, peak in sound if 0.1 <= t < 1.9 or 3.1 <= t < 5.8))

    # Hundreds of cuts: the graph goes to a file.
    many = [[1 + i * 0.02, 1.01 + i * 0.02] for i in range(400)]
    out = run(root, "many", {"url": source, "spans": many, "width": 320, "height": 180})
    check("hundreds of cuts still render", abs(duration(out) - duration(source)) < 0.1)

    # An intro or outro with edits is rendered without the removed footage before it is joined (where there are joins).
    if hasattr(exporter, "edited"):
        work = root / "clip"
        work.mkdir()
        short = exporter.edited({"url": source, "width": 320, "height": 180, "trim_start": 1, "trim_end": 9, "cuts": [[4, 6]]}, str(work), 0)
        check("an edited intro or outro loses its removed footage", abs(duration(short.removeprefix("file://")) - 6) < 0.2, duration(short.removeprefix("file://")))

print(f"{passed} checks passed")
