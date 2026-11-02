"""Render real ffmpeg fixtures and check the crop against the player's math."""
import importlib.util
import json
import math
import pathlib
import shutil
import subprocess
import tempfile

spec = importlib.util.spec_from_file_location("exporter", "exporter/server.py")
exporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exporter)


def run(*args):
    return subprocess.check_output(args, stderr=subprocess.PIPE)


with tempfile.TemporaryDirectory(prefix="vertov-zoom-test-") as directory:
    root = pathlib.Path(directory)
    pixels = bytearray()
    for y in range(360):
        for x in range(640):
            pixels.extend((round(x / 639 * 220) + 16, round(y / 359 * 220) + 16, 80))
    image = root / "screen.ppm"
    image.write_bytes(b"P6\n640 360\n255\n" + pixels)
    screen = root / "screen.mp4"
    camera = root / "camera.mp4"
    run("ffmpeg", "-v", "error", "-y", "-loop", "1", "-i", str(image), "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "6", "-r", "30", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", str(screen))
    run("ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=blue:s=80x80:r=30:d=6", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(camera))
    exporter.download = lambda url, path: shutil.copyfile(url, path)
    point = {"start": 1.5, "duration": 2, "x": 0.75, "y": 0.4, "scale": 2}
    job = {"screen_url": str(screen), "camera_url": str(camera), "width": 640, "height": 360, "background": ["#000000"],
           "screen": {"x": 0, "y": 0, "w": 640, "h": 360}, "camera": {"x": 560, "y": 280, "w": 80, "h": 80, "circle": True},
           "trim_start": 1, "trim_end": 5, "cuts": [[2, 3]], "zoom_points": [point], "denoise": True}
    output_dir = root / "render"
    output_dir.mkdir()
    output = exporter.render(job, str(output_dir))
    metadata = json.loads(run("ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", output))
    video = next(s for s in metadata["streams"] if s["codec_type"] == "video")
    assert (video["width"], video["height"]) == (640, 360)
    assert abs(float(metadata["format"]["duration"]) - 3) < 0.1
    assert any(s["codec_type"] == "audio" for s in metadata["streams"])
    frames = run("ffmpeg", "-v", "error", "-i", output, "-f", "rawvideo", "-pix_fmt", "rgb24", "-")
    frame_size = 640 * 360 * 3
    for time in [0, 0.2, 0.5, 0.8, 1.2, 1.4, 1.7, 2.5]:
        index = round(time * 30)
        frame = frames[index * frame_size:(index + 1) * frame_size]
        source_time = index / 30 + 1 + (1 if index >= 30 else 0)
        smooth = lambda v: (lambda t: t * t * (3 - 2 * t))(min(1, max(0, v)))
        amount = smooth((source_time - point["start"]) / 0.45) * smooth((point["start"] + point["duration"] - source_time) / 0.45)
        scale = 1 + amount
        tx = max(1 - scale, min(0, 0.5 - point["x"] * scale))
        ty = max(1 - scale, min(0, 0.5 - point["y"] * scale))
        sx, sy = (0.5 - tx) / scale, (0.5 - ty) / scale
        center = (180 * 640 + 320) * 3
        red, green = frame[center:center + 2]
        assert abs(red - (sx * 220 + 16)) < 7, (time, red, sx)
        assert abs(green - (sy * 220 + 16)) < 7, (time, green, sy)
        face = (320 * 640 + 600) * 3
        assert frame[face + 2] > 230 and frame[face] < 25, "Camera must stay fixed while the screen zooms"
    assert exporter.zoom_filter([], 0, 640, 360, 30) is None
    assert exporter.zoom_filter([dict(point, x=float("nan"))], 0, 640, 360, 30) is None
    print("PASS real MP4 crop matches preview math through trim/cuts; fixed camera, duration and denoised audio retained")
