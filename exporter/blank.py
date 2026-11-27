"""
The copy viewers get of an edited recording: the same length and timeline, with every removed stretch painted black and
silenced, so nothing trimmed or cut out is in the file at all. One track per job (screen, camera or narration). The
player still skips the cuts, and comments, chapters and captions keep their times.
"""
import json
import math
import os
import subprocess

from media import VIDEO_CODEC, download, even, filter_args, has_audio, step_expr

FPS = 30
RATE = 48000
# Sound is silenced in pieces this long (5 ms), starting one piece early so no piece reaches into a removed stretch.
AUDIO_STEP = 240


def inside(spans, before=0.0, after=0.0):
    """An ffmpeg expression that is 1 while t is in any of the [start, end) spans, each widened by before/after seconds."""
    widened = []
    for start, end in sorted((float(a), float(b)) for a, b in spans):
        start, end = max(0.0, math.floor((start - before) * 1000) / 1000), math.ceil((end + after) * 1000) / 1000
        if end <= start:
            continue
        if widened and start <= widened[-1][1]:
            widened[-1][1] = max(widened[-1][1], end)
        else:
            widened.append([start, end])
    if not widened:
        return "0", []
    points = [(0.0, 0)]
    for start, end in widened:
        points += [(start, 1), (end, 0)]
    return step_expr(points), widened


def first_clean_frame(end):
    """The first output frame after a removed stretch that cannot hold any of it. src/lib/viewer-copy.ts (copyResume)
    uses the same rule to decide where the player comes back."""
    return math.ceil(min(float(end), 1e9) * FPS + 1 - 1e-6)


def video_size(path):
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", path],
        capture_output=True, text=True,
    )
    streams = json.loads(probe.stdout or "{}").get("streams") or []
    return (streams[0].get("width"), streams[0].get("height")) if streams else (None, None)


def blank(job, workdir):
    source = os.path.join(workdir, "source")
    download(job["url"], source)
    spans = job["spans"]
    audio_only = bool(job.get("audio_only"))
    width, height = (None, None) if audio_only else (job.get("width"), job.get("height"))
    if not audio_only and not (width and height):
        width, height = video_size(source)
    picture = bool(width and height)
    sound = has_audio(source)
    if not picture and not sound:
        raise RuntimeError("nothing to copy: no picture and no sound")

    filters, maps, keys = [], [], []
    if picture:
        width, height = even(width), even(height)
        # Frames are first laid on a steady 30 fps, rounding up, and only then painted: a screen that did not change for
        # a while has no frames of its own, and painting those that exist would leave the picture black after a cut.
        # Rounding up can carry a removed frame one slot past the end, so each stretch is painted up to the first frame
        # that cannot hold any of it.
        black, widened = inside([[start, first_clean_frame(end) / FPS - 0.001] for start, end in spans])
        filters.append(
            f"[0:v:0]setpts=PTS-STARTPTS,fps={FPS}:round=up,"
            f"scale={width}:{height}:force_original_aspect_ratio=decrease:eval=frame,"
            f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=black:eval=frame,format=yuv420p[framed]"
        )
        last = "framed"
        filters.append(f"[{last}]drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill:enable='{black}'[v]")
        maps += ["-map", "[v]"]
        # A key frame where the picture comes back, so the player's jump over a cut lands at once.
        returns = [f"{end:.3f}" for _, end in widened if end < 24 * 3600]
        if returns:
            keys = ["-force_key_frames", ",".join(returns)]
    if sound:
        silent, _ = inside(spans, before=AUDIO_STEP / RATE)
        filters.append(
            f"[0:a:0]aresample={RATE}:async=1:first_pts=0,asetnsamples=n={AUDIO_STEP}:p=0,"
            f"volume=volume=0:enable='{silent}'[a]"
        )
        maps += ["-map", "[a]"]

    output = os.path.join(workdir, "blank.mp4")
    # A recording whose size changes part way must not rebuild the filter graph (see render in server.py).
    command = ["ffmpeg", "-nostdin", "-v", "error", "-y", "-reinit_filter", "0", "-i", source, *filter_args(filters, workdir), *maps]
    if picture:
        command += [*VIDEO_CODEC, "-g", "120", *keys]
    if sound:
        command += ["-c:a", "aac", "-b:a", "160k"]
    command += ["-map_metadata", "-1", "-map_chapters", "-1", "-movflags", "+faststart", output]
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(result.stderr[-2000:])
    return output
