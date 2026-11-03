"""
Renders a recording's composed layout to one MP4: background, the screen
(rounded, inset) and the camera (circle or card), trimmed. The Worker sends
the geometry in pixels; this only downloads inputs and runs ffmpeg.
"""
import json
import math
import os
import shutil
import subprocess
import tempfile
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def download(url, path):
    # Cloudflare turns away urllib's default user agent.
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; vertov-exporter/1.0)"})
    with urllib.request.urlopen(request, timeout=600) as response, open(path, "wb") as out:
        shutil.copyfileobj(response, out, 1024 * 1024)


def even(value):
    return max(2, int(round(value / 2)) * 2)


def rounded_mask(path, w, h, radius):
    r = max(1, int(radius))
    corner = (
        f"if(lte(X,{r})*lte(Y,{r}),lte(hypot({r}-X,{r}-Y),{r}),"
        f"if(gte(X,W-{r})*lte(Y,{r}),lte(hypot(X-(W-{r}),{r}-Y),{r}),"
        f"if(lte(X,{r})*gte(Y,H-{r}),lte(hypot({r}-X,Y-(H-{r})),{r}),"
        f"if(gte(X,W-{r})*gte(Y,H-{r}),lte(hypot(X-(W-{r}),Y-(H-{r})),{r}),1))))*255"
    )
    run_mask(path, w, h, corner)


def circle_mask(path, w, h):
    run_mask(path, w, h, "lte(hypot(X-W/2,Y-H/2),W/2)*255")


def probe_duration(path):
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
        capture_output=True, text=True,
    )
    try:
        return float(probe.stdout.strip())
    except ValueError:
        return 6 * 3600.0


def has_audio(path):
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", path],
        capture_output=True, text=True,
    )
    return bool(probe.stdout.strip())


def run_mask(path, w, h, expression):
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"color=black:s={w}x{h}:d=1",
         "-vf", f"format=gray,geq=lum='{expression}'", "-frames:v", "1", path],
        check=True,
    )


def zoom_filter(points, offset, width, height, fps):
    """Use source time before cuts; the player uses the same eased, edge-clamped crop."""
    valid = []
    for point in (points if isinstance(points, list) else [])[:100]:
        if not isinstance(point, dict):
            continue
        values = [point.get(key) for key in ("start", "duration", "x", "y", "scale")]
        if not all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in values):
            continue
        start, duration, x, y, scale = values
        if start < 0 or duration < 1 or scale <= 1:
            continue
        valid.append((start, min(duration, 12), min(1, max(0, x)), min(1, max(0, y)), min(2.5, max(1.25, scale))))
    normalized = []
    for point in sorted(valid):
        if not normalized or point[0] >= normalized[-1][0] + normalized[-1][1]:
            normalized.append(point)
    if not normalized:
        return None
    scales, xs, ys = ["1"], ["0.5"], ["0.5"]
    for start, duration, x, y, scale in normalized:
        start -= offset
        end = start + duration
        ease = min(0.45, duration / 3)
        ramp_in = f"clip((it-({start:.6f}))/{ease:.6f},0,1)"
        ramp_out = f"clip((({end:.6f})-it)/{ease:.6f},0,1)"
        smooth_in = f"({ramp_in}*{ramp_in}*(3-2*{ramp_in}))"
        smooth_out = f"({ramp_out}*{ramp_out}*(3-2*{ramp_out}))"
        scales.append(f"{scale - 1:.6f}*{smooth_in}*{smooth_out}")
        active = f"between(it,{start:.6f},{end:.6f})"
        xs.append(f"({x - 0.5:.6f})*{active}")
        ys.append(f"({y - 0.5:.6f})*{active}")
    z = "+".join(scales)
    x = f"max(0,min(iw-iw/zoom,iw*({'+'.join(xs)})-iw/zoom/2))"
    y = f"max(0,min(ih-ih/zoom,ih*({'+'.join(ys)})-ih/zoom/2))"
    return f"zoompan=z='{z}':x='{x}':y='{y}':d=1:s={width}x{height}:fps={fps}"


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
    inputs = [*trim, "-i", screen_path]
    camera_index = None
    if job.get("camera") and job.get("camera_url"):
        camera_path = os.path.join(workdir, "camera")
        download(job["camera_url"], camera_path)
        inputs += [*trim, "-i", camera_path]
        camera_index = 1

    colors = job["background"] or ["#000000"]
    next_index = 2 if camera_index else 1
    if len(colors) == 1:
        inputs += ["-f", "lavfi", "-i", f"color=c={colors[0]}:s={width}x{height}:r={fps}"]
    else:
        stops = ":".join(f"c{i}={c}" for i, c in enumerate(colors[:8]))
        inputs += ["-f", "lavfi", "-i",
                   f"gradients=s={width}x{height}:{stops}:nb_colors={len(colors[:8])}:x0=0:y0=0:x1={width}:y1={height}:speed=0.00001:r={fps}"]
    bg_index = next_index
    next_index += 1

    filters = [f"[{bg_index}:v]format=yuv420p[bg]"]
    last = "bg"

    screen = job.get("screen")
    if screen:
        sw, sh = even(screen["w"]), even(screen["h"])
        filters.append(
            f"[0:v]setpts=PTS-STARTPTS,fps={fps},scale={sw}:{sh}:force_original_aspect_ratio=decrease,"
            f"pad={sw}:{sh}:(ow-iw)/2:(oh-ih)/2:color=black[s0]"
        )
        zoom = zoom_filter(job.get("zoom_points"), job.get("trim_start") or 0, sw, sh, fps)
        screen_source = "s0"
        if zoom:
            filters.append(f"[s0]{zoom}[s_zoom]")
            screen_source = "s_zoom"
        if screen.get("radius", 0) > 0:
            mask = os.path.join(workdir, "screen_mask.png")
            rounded_mask(mask, sw, sh, screen["radius"])
            inputs += ["-loop", "1", "-i", mask]
            filters.append(f"[{screen_source}]format=yuva420p[s0a];[{next_index}:v]format=gray[sm];[s0a][sm]alphamerge[s1]")
            next_index += 1
        else:
            filters.append(f"[{screen_source}]null[s1]")
        filters.append(f"[{last}][s1]overlay={int(screen['x'])}:{int(screen['y'])}:shortest=1[v_s]")
        last = "v_s"

    camera = job.get("camera")
    if camera and camera_index:
        cw, ch = even(camera["w"]), even(camera["h"])
        filters.append(
            f"[{camera_index}:v]setpts=PTS-STARTPTS,fps={fps},scale={cw}:{ch}:force_original_aspect_ratio=increase,"
            f"crop={cw}:{ch}[c0]"
        )
        if camera.get("full"):
            filters.append("[c0]null[c1]")
        else:
            mask = os.path.join(workdir, "camera_mask.png")
            if camera.get("circle"):
                circle_mask(mask, cw, ch)
            else:
                rounded_mask(mask, cw, ch, camera.get("radius", 24))
            inputs += ["-loop", "1", "-i", mask]
            filters.append(f"[c0]format=yuva420p[c0a];[{next_index}:v]format=gray[cm];[c0a][cm]alphamerge[c1]")
            next_index += 1
        end = ":shortest=1" if not screen else ":eof_action=pass"
        filters.append(f"[{last}][c1]overlay={int(camera['x'])}:{int(camera['y'])}{end}[v_c]")
        last = "v_c"

    # Cuts arrive in source seconds; the composed timeline starts at the trim-in point.
    offset = job.get("trim_start") or 0
    cuts = [(max(0.0, a - offset), b - offset) for a, b in job.get("cuts") or [] if b - offset > 0]
    audio_map = ["-map", "0:a?"]
    if cuts:
        # Keep-ranges spliced with trim + concat (aselect doesn't reliably drop audio).
        end = probe_duration(screen_path) - offset
        if job.get("trim_end"):
            end = min(end, job["trim_end"] - offset)
        keeps, cursor = [], 0.0
        for a, b in sorted(cuts):
            if a - cursor > 0.04:
                keeps.append((cursor, a))
            cursor = max(cursor, b)
        if end - cursor > 0.04:
            keeps.append((cursor, end))
        audio = has_audio(screen_path)
        n = len(keeps)
        if n:
            filters.append(f"[{last}]split={n}" + "".join(f"[vs{i}]" for i in range(n)))
            if audio:
                filters.append(f"[0:a]asplit={n}" + "".join(f"[as{i}]" for i in range(n)))
            pairs = ""
            for i, (a, b) in enumerate(keeps):
                filters.append(f"[vs{i}]trim=start={a:.3f}:end={b:.3f},setpts=PTS-STARTPTS[vk{i}]")
                if audio:
                    filters.append(f"[as{i}]atrim=start={a:.3f}:end={b:.3f},asetpts=PTS-STARTPTS[ak{i}]")
                pairs += f"[vk{i}][ak{i}]" if audio else f"[vk{i}]"
            filters.append(f"{pairs}concat=n={n}:v=1:a={1 if audio else 0}[v_cut]" + ("[a_cut]" if audio else ""))
            last = "v_cut"
            audio_map = ["-map", "[a_cut]"] if audio else []

    # Blurred regions (redaction) and placed images sit on the composed, cut timeline, under the ASS layer.
    for i, box in enumerate(job.get("blur_boxes") or []):
        w, h = even(box["w"]), even(box["h"])
        radius = max(2, min(24, min(w, h) // 2 - 1))
        enable = f"between(t,{box['start']:.3f},{box['end']:.3f})"
        filters.append(f"[{last}]split[bm{i}][bs{i}]")
        filters.append(f"[bs{i}]crop={w}:{h}:{int(box['x'])}:{int(box['y'])},boxblur={radius}:2[bb{i}]")
        filters.append(f"[bm{i}][bb{i}]overlay={int(box['x'])}:{int(box['y'])}:enable='{enable}'[v_b{i}]")
        last = f"v_b{i}"
    for i, image in enumerate(job.get("images") or []):
        image_path = os.path.join(workdir, f"image{i}")
        download(image["url"], image_path)
        inputs += ["-loop", "1", "-i", image_path]
        enable = f"between(t,{image['start']:.3f},{image['end']:.3f})"
        filters.append(f"[{next_index}:v]scale={even(image['w'])}:-2,format=rgba[im{i}]")
        filters.append(f"[{last}][im{i}]overlay={int(image['x'])}:{int(image['y'])}:shortest=1:enable='{enable}'[v_i{i}]")
        last = f"v_i{i}"
        next_index += 1

    if job.get("ass"):
        # Annotations and styled captions, burned in last so they sit over the composed frame.
        ass_path = os.path.join(workdir, "overlay.ass")
        with open(ass_path, "w", encoding="utf-8") as handle:
            handle.write(job["ass"])
        filters.append(f"[{last}]ass={ass_path}[v_ass]")
        last = "v_ass"

    if job.get("denoise") and has_audio(screen_path):
        source = "a_cut" if audio_map == ["-map", "[a_cut]"] else "0:a"
        filters.append(f"[{source}]highpass=f=80,afftdn=nf=-25[a_clean]")
        audio_map = ["-map", "[a_clean]"]

    output = os.path.join(workdir, "export.mp4")
    command = [
        "ffmpeg", "-v", "error", "-y", *inputs,
        "-filter_complex", ";".join(filters),
        "-map", f"[{last}]", *audio_map,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "160k",
        "-movflags", "+faststart", "-shortest", output,
    ]
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(result.stderr[-2000:])
    return output


def concat(job, workdir):
    """Joins finished MP4s into one: every clip is scaled to one clip's size (letterboxed),
    30 fps, 48 kHz stereo, so clips with different layouts or sources play back to back."""
    urls = job["inputs"]
    paths, durations, audio = [], [], []
    for i, url in enumerate(urls):
        path = os.path.join(workdir, f"in{i}.mp4")
        download(url, path)
        paths.append(path)
        durations.append(probe_duration(path))
        audio.append(has_audio(path))
    # Size from the clip named by size_from (the main video when an intro precedes it), else the first.
    reference = paths[min(max(int(job.get("size_from") or 0), 0), len(paths) - 1)]
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", reference],
        capture_output=True, text=True,
    )
    width, height = (even(int(v)) for v in probe.stdout.strip().split("x"))
    fps = 30
    inputs, filters, pairs = [], [], ""
    for i, path in enumerate(paths):
        inputs += ["-i", path]
        filters.append(
            f"[{i}:v]scale={width}:{height}:force_original_aspect_ratio=decrease,"
            f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps={fps},format=yuv420p[v{i}]"
        )
        if audio[i]:
            filters.append(f"[{i}:a]aresample=48000,aformat=channel_layouts=stereo[a{i}]")
        else:
            # A silent clip still needs a track of the right length to keep the sound in step.
            filters.append(f"anullsrc=r=48000:cl=stereo,atrim=duration={durations[i]:.3f}[a{i}]")
        pairs += f"[v{i}][a{i}]"
    filters.append(f"{pairs}concat=n={len(paths)}:v=1:a=1[v][a]")
    output = os.path.join(workdir, "stitched.mp4")
    result = subprocess.run(
        ["ffmpeg", "-nostdin", "-v", "error", "-y", *inputs, "-filter_complex", ";".join(filters),
         "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p",
         "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", output],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr[-2000:])
    return output, durations, (width, height)


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"ok")

    def do_POST(self):
        if self.path not in ("/render", "/concat"):
            self.send_response(404)
            self.end_headers()
            return
        job = json.loads(self.rfile.read(int(self.headers.get("content-length", "0"))))
        workdir = tempfile.mkdtemp()
        try:
            extra = {}
            if self.path == "/concat":
                output, durations, (width, height) = concat(job, workdir)
                extra = {"x-durations": ",".join(f"{d:.3f}" for d in durations), "x-size": f"{width}x{height}"}
            else:
                output = render(job, workdir)
            size = os.path.getsize(output)
            self.send_response(200)
            self.send_header("content-type", "video/mp4")
            self.send_header("content-length", str(size))
            for name, value in extra.items():
                self.send_header(name, value)
            self.end_headers()
            with open(output, "rb") as handle:
                shutil.copyfileobj(handle, self.wfile, 1024 * 1024)
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
