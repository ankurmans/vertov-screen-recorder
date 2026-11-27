"""
Picks a video's thumbnail: a dozen frames from 10% to 70% of the way through, keeping the one with the most detail.
The first frame of a screen recording is usually a blank or loading page; JPEG size is a cheap, reliable stand-in for
how much is on screen, so a near-empty frame never wins.
"""
import os
import subprocess

from media import download, probe_duration

SAMPLES = 12


def frame_at(source, seconds, path, width):
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-ss", f"{seconds:.3f}", "-i", source, "-frames:v", "1",
         "-vf", f"scale={width}:-2", "-q:v", "3", path],
        capture_output=True,
    )
    return os.path.exists(path) and os.path.getsize(path) > 0


def best_frame(source, duration, workdir, width, prefix="frame"):
    if not duration or duration >= 6 * 3600:
        duration = 10.0
    best, best_size = None, -1
    for index in range(SAMPLES):
        seconds = duration * (0.10 + 0.60 * index / (SAMPLES - 1))
        path = os.path.join(workdir, f"{prefix}-{index}.jpg")
        if not frame_at(source, seconds, path, width):
            continue
        size = os.path.getsize(path)
        if size > best_size:
            best, best_size = path, size
    if not best:
        # Very short or odd files: fall back to the first frame rather than nothing.
        path = os.path.join(workdir, f"{prefix}-first.jpg")
        if frame_at(source, 0, path, width):
            best = path
    if not best:
        raise RuntimeError("no frame could be read")
    return best


def poster(job, workdir):
    source = os.path.join(workdir, "video")
    download(job["video_url"], source)
    # Browser recordings may not state their length; the Worker sends the one it measured.
    duration = job.get("duration") or probe_duration(source)
    return best_frame(source, duration, workdir, int(job.get("width") or 1280))
