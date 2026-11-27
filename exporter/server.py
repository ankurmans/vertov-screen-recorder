"""
Renders a recording's composed layout to one MP4: background, the screen
(rounded, inset) and the camera (circle or card), trimmed. The Worker sends
the geometry in pixels; this only downloads inputs and runs ffmpeg.
"""
import json
import os
import shutil
import subprocess
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote

from blank import blank
from media import STILL, VIDEO_CODEC, circle_mask, download, even, filter_args, has_audio, probe_duration, rounded_mask, step_expr, still_input
from poster import poster

def render(job, workdir):
    width, height = even(job["width"]), even(job["height"])
    fps = 30
    trim = []
    if job.get("trim_start"):
        trim += ["-ss", f"{job['trim_start']:.3f}"]
    if job.get("trim_end"):
        trim += ["-to", f"{job['trim_end']:.3f}"]

    screen_path = os.path.join(workdir, "screen")
    download(job["screen_url"], screen_path)
    # A recording whose size changes part way (a shared window resized) must not rebuild the filter graph: that
    # ends the picture at the change. scale and pad follow each frame instead.
    steady = ["-reinit_filter", "0"]
    inputs = [*steady, *trim, "-i", screen_path]
    camera_index = None
    if job.get("camera") and job.get("camera_url"):
        camera_path = os.path.join(workdir, "camera")
        download(job["camera_url"], camera_path)
        inputs += [*steady, *trim, "-i", camera_path]
        camera_index = 1

    colors = job["background"] or ["#000000"]
    next_index = 1 + (1 if camera_index else 0)
    wallpaper = job.get("background_image")
    wallpaper_path = os.path.join(BACKGROUNDS_DIR, os.path.basename(wallpaper)) if wallpaper else None
    bg_filter = ""
    if wallpaper_path and os.path.isfile(wallpaper_path):
        # Scaled to cover the stage and cropped to it, like the player's background-size: cover.
        inputs += still_input(wallpaper_path)
        bg_filter = f"scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},"
    elif len(colors) == 1:
        inputs += ["-f", "lavfi", "-i", f"color=c={colors[0]}:s={width}x{height}:r={fps}"]
    else:
        stops = ":".join(f"c{i}={c}" for i, c in enumerate(colors[:8]))
        # The end point must lie inside the frame: ffmpeg swaps one outside it for a random point.
        inputs += ["-f", "lavfi", "-i",
                   f"gradients=s={width}x{height}:{stops}:nb_colors={len(colors[:8])}:x0=0:y0=0:x1={width - 1}:y1={height - 1}:speed=0.00001:r={fps}:d=1"]
        bg_filter = "trim=end_frame=1,"
    bg_index = next_index
    next_index += 1

    # A plain colour is already cheap; a wallpaper or gradient is drawn once.
    still = f",{STILL}" if bg_filter else ""
    filters = [f"[{bg_index}:v]{bg_filter}format=yuv420p{still}[bg]"]
    last = "bg"

    # Masks loop forever, so every alphamerge ends with its video; without that a silent recording never finishes.
    screen = job.get("screen")
    camera = job.get("camera")
    # Camera-first puts the camera full-frame underneath and the screen floating over it.
    camera_first = bool(job.get("camera_first") and screen and camera and camera_index)
    for part in (["camera", "screen"] if camera_first else ["screen", "camera"]):
        if part == "screen" and screen:
            sw, sh = even(screen["w"]), even(screen["h"])
            filters.append(
                f"[0:v]setpts=PTS-STARTPTS,fps={fps},scale={sw}:{sh}:force_original_aspect_ratio=decrease:eval=frame,"
                f"pad={sw}:{sh}:(ow-iw)/2:(oh-ih)/2:color=black:eval=frame[s0]"
            )
            screen_source = "s0"
            if screen.get("radius", 0) > 0:
                mask = os.path.join(workdir, "screen_mask.png")
                rounded_mask(mask, sw, sh, screen["radius"])
                inputs += still_input(mask)
                filters.append(f"[{screen_source}]format=yuva420p[s0a];[{next_index}:v]format=gray,{STILL}[sm];[s0a][sm]alphamerge=shortest=1[s1]")
                next_index += 1
            else:
                filters.append(f"[{screen_source}]null[s1]")
            filters.append(f"[{last}][s1]overlay={int(screen['x'])}:{int(screen['y'])}:shortest=1[v_s]")
            last = "v_s"

        elif part == "camera" and camera and camera_index:
            cw, ch = even(camera["w"]), even(camera["h"])
            fitted = f"[{camera_index}:v]setpts=PTS-STARTPTS,fps={fps},"
            filters.append(f"{fitted}scale={cw}:{ch}:force_original_aspect_ratio=increase:eval=frame,crop={cw}:{ch}[c0]")
            if camera.get("full"):
                filters.append("[c0]null[c1]")
            else:
                mask = os.path.join(workdir, "camera_mask.png")
                if camera.get("circle"):
                    circle_mask(mask, cw, ch)
                else:
                    rounded_mask(mask, cw, ch, camera.get("radius", 24))
                inputs += still_input(mask)
                filters.append(f"[c0]format=yuva420p[c0a];[{next_index}:v]format=gray,{STILL}[cm];[c0a][cm]alphamerge=shortest=1[c1]")
                next_index += 1
            end = ":shortest=1" if not screen else ":eof_action=pass"
            filters.append(f"[{last}][c1]overlay={int(camera['x'])}:{int(camera['y'])}{end}[v_c]")
            last = "v_c"


    main_audio = has_audio(screen_path)
    # Cuts arrive in source seconds; the composed timeline starts at the trim-in point.
    offset = job.get("trim_start") or 0
    cuts = [(max(0.0, a - offset), b - offset) for a, b in job.get("cuts") or [] if b - offset > 0]
    audio_map = ["-map", "0:a?"]
    if cuts:
        # Cut frames are dropped whole, picture and sound alike: sound is regrouped into frame-long pieces and both are
        # chosen by frame number. (Splitting into kept stretches and joining them drifted half a frame per cut and
        # failed outright at a few hundred.) aselect on ffmpeg's own audio frames would be too coarse.
        keep, end_of_last = [(0, 1)], 0
        for a, b in sorted(cuts):
            a, b = max(round(a * fps), end_of_last), round(b * fps)
            if b <= a:
                continue
            keep += [(a, 0), (b, 1)]
            end_of_last = b
        chosen = step_expr(keep, "n")
        filters.append(f"[{last}]select='{chosen}',setpts=N/{fps}/TB[v_cut]")
        last = "v_cut"
        if main_audio:
            rate = 48000
            filters.append(
                f"[0:a]aresample={rate}:async=1:first_pts=0,asetnsamples=n={rate // fps}:p=0,"
                f"aselect='{chosen}',asetpts=N/SR/TB[a_cut]"
            )
            audio_map = ["-map", "[a_cut]"]
        else:
            audio_map = []

    if job.get("ass"):
        # Annotations and styled captions, burned in last so they sit over the composed frame.
        ass_path = os.path.join(workdir, "overlay.ass")
        with open(ass_path, "w", encoding="utf-8") as handle:
            handle.write(job["ass"])
        filters.append(f"[{last}]ass={ass_path}[v_ass]")
        last = "v_ass"

    output = os.path.join(workdir, "export.mp4")
    command = [
        "ffmpeg", "-v", "error", "-y", *inputs,
        *filter_args(filters, workdir),
        "-map", f"[{last}]", *audio_map,
        *VIDEO_CODEC,
        "-c:a", "aac", "-b:a", "160k",
        "-movflags", "+faststart", "-shortest", output,
    ]
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(result.stderr[-2000:])
    return output


def remux(job, workdir):
    """Repackages a joined HLS stream (MPEG-TS or fragmented MP4) as an MP4 without re-encoding, so
    an hours-long video converts in seconds. Re-encodes only if the copy fails."""
    source = os.path.join(workdir, "in.bin")
    download(job["input"], source)
    output = os.path.join(workdir, "out.mp4")
    base = ["ffmpeg", "-nostdin", "-v", "error", "-y", "-i", source]
    maps = []
    if job.get("audio_input"):
        # Loom often keeps the sound in its own playlist: take the picture from one stream and the sound from the other.
        sound = os.path.join(workdir, "audio.bin")
        download(job["audio_input"], sound)
        base += ["-i", sound]
        maps = ["-map", "0:v:0", "-map", "1:a:0"]
    attempts = [
        [*base, *maps, "-c", "copy", "-bsf:a", "aac_adtstoasc", "-movflags", "+faststart", output],
        [*base, *maps, "-c", "copy", "-movflags", "+faststart", output],
        [*base, *maps, "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", output],
    ]
    error = ""
    for command in attempts:
        result = subprocess.run(command, capture_output=True, text=True)
        if result.returncode == 0:
            return output
        error = result.stderr[-2000:]
    raise RuntimeError(error)


def run_kind(kind, job, workdir):
    """Runs one render or viewer copy; returns the finished file and the headers that describe it."""
    if kind == "blank":
        return blank(job, workdir), {}
    return render(job, workdir), {}


# Long renders run here in the background, so no request has to stay open for the length of one: the Worker starts a
# job, asks after it, then collects the file. A finished job is kept a while for collection.
JOBS = {}
JOBS_LOCK = threading.Lock()
HOLD_SECONDS = 30 * 60


def start_job(job_id, kind, job):
    with JOBS_LOCK:
        if job_id in JOBS:
            return JOBS[job_id]
        entry = JOBS[job_id] = {"state": "running", "workdir": tempfile.mkdtemp()}

    def work():
        try:
            output, headers = run_kind(kind, job, entry["workdir"])
            entry.update(output=output, headers=headers, finished=time.time(), state="done")
        except Exception as error:  # noqa: BLE001 - report any failure to the Worker
            shutil.rmtree(entry["workdir"], ignore_errors=True)
            entry.update(error=str(error)[-2000:], finished=time.time(), state="failed")

    threading.Thread(target=work, daemon=True).start()
    return entry


def holding():
    """Whether the instance must stay up: a job is running, or one finished too recently to have been collected."""
    with JOBS_LOCK:
        return any(entry["state"] == "running" or time.time() - entry["finished"] < HOLD_SECONDS for entry in JOBS.values())


class Handler(BaseHTTPRequestHandler):
    def send_json(self, status, value):
        body = json.dumps(value).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_file(self, path, content_type, extra):
        self.send_response(200)
        self.send_header("content-type", content_type)
        self.send_header("content-length", str(os.path.getsize(path)))
        for name, value in extra.items():
            self.send_header(name, value)
        self.end_headers()
        with open(path, "rb") as handle:
            shutil.copyfileobj(handle, self.wfile, 1024 * 1024)

    def do_GET(self):
        if self.path == "/busy":
            return self.send_json(200, {"holding": holding()})
        if self.path.startswith("/jobs/"):
            job_id, _, part = self.path[len("/jobs/"):].partition("/")
            job_id = unquote(job_id)
            entry = JOBS.get(job_id)
            if part == "output":
                if not entry or entry["state"] != "done":
                    return self.send_json(409, {"error": "no finished file"})
                return self.send_file(entry["output"], "video/mp4", entry["headers"])
            # "unknown" means the instance restarted and lost the job; the Worker starts it again.
            state = entry["state"] if entry else "unknown"
            return self.send_json(200, {"state": state, **({"error": entry["error"]} if state == "failed" else {})})
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"ok")

    def do_POST(self):
        if self.path == "/jobs":
            request = json.loads(self.rfile.read(int(self.headers.get("content-length", "0"))))
            if request.get("kind") not in ("render", "blank"):
                return self.send_json(400, {"error": "unknown kind"})
            entry = start_job(str(request["id"]), request["kind"], request["job"])
            return self.send_json(202, {"state": entry["state"]})
        if self.path not in ("/render", "/remux", "/poster"):
            self.send_response(404)
            self.end_headers()
            return
        job = json.loads(self.rfile.read(int(self.headers.get("content-length", "0"))))
        workdir = tempfile.mkdtemp()
        try:
            extra = {}
            content_type = "video/mp4"
            if self.path == "/render":
                output, extra = run_kind(self.path[1:], job, workdir)
            elif self.path == "/remux":
                output = remux(job, workdir)
            elif self.path == "/poster":
                output = poster(job, workdir)
                content_type = "image/jpeg"
            self.send_file(output, content_type, extra)
        except Exception as error:  # noqa: BLE001 - report any failure to the Worker
            body = str(error).encode()
            self.send_response(500)
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        finally:
            shutil.rmtree(workdir, ignore_errors=True)


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", int(os.environ.get("PORT", "8080"))), Handler).serve_forever()
