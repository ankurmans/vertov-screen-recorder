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
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from media import circle_mask, download, even, has_audio, probe_duration, rounded_mask
from poster import poster

try:
    from cover import ai_cover, cover  # Needs Pillow; the public edition's image may not have it.
except ImportError:
    cover = ai_cover = None

try:
    import effects  # Hosted only; the public edition's image has no effects module.
except ImportError:
    effects = None


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

    # Narration (the workspace's own ElevenLabs track) rides the source timeline like the screen audio:
    # trimmed with the same in-point, then mixed in before the cuts so the cuts hit both.
    voice_index = None
    voice_delay_ms = 0
    if job.get("voice_url"):
        voice_path = os.path.join(workdir, "voice")
        download(job["voice_url"], voice_path)
        start = float(job.get("trim_start") or 0)
        offset = float(job.get("voice_offset") or 0)
        if offset >= start:
            voice_delay_ms = int(round((offset - start) * 1000))
            inputs += ["-i", voice_path]
        else:
            inputs += ["-ss", f"{start - offset:.3f}", "-i", voice_path]
        voice_index = 2 if camera_index else 1

    colors = job["background"] or ["#000000"]
    next_index = 1 + (1 if camera_index else 0) + (1 if voice_index else 0)
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
        zoom = effects.zoom_filter(job.get("zoom_points"), job.get("trim_start") or 0, sw, sh, fps) if effects else None
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

    main_audio = has_audio(screen_path)
    mixed = None
    if voice_index is not None:
        main_label = "[0:a]"
        if effects and job.get("denoise") and main_audio:
            filters.append("[0:a]highpass=f=80,afftdn=nf=-25[a0d]")
            main_label = "[a0d]"
        filters.append(f"[{voice_index}:a]aresample=48000,adelay={voice_delay_ms}|{voice_delay_ms}[va]")
        if main_audio:
            filters.append(f"{main_label}aresample=48000[ma];[ma][va]amix=inputs=2:duration=longest:normalize=0,apad[amix]")
        else:
            filters.append("[va]apad[amix]")
        mixed = "[amix]"

    # Cuts arrive in source seconds; the composed timeline starts at the trim-in point.
    offset = job.get("trim_start") or 0
    cuts = [(max(0.0, a - offset), b - offset) for a, b in job.get("cuts") or [] if b - offset > 0]
    audio_map = ["-map", mixed] if mixed else ["-map", "0:a?"]
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
        audio = bool(mixed) or main_audio
        n = len(keeps)
        if n:
            filters.append(f"[{last}]split={n}" + "".join(f"[vs{i}]" for i in range(n)))
            if audio:
                filters.append(f"{mixed or '[0:a]'}asplit={n}" + "".join(f"[as{i}]" for i in range(n)))
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
    if effects:
        last, next_index = effects.overlays(job, workdir, filters, inputs, last, next_index)
        last, next_index = effects.cursor_overlay(job, workdir, filters, inputs, last, next_index)

    if job.get("ass"):
        # Annotations and styled captions, burned in last so they sit over the composed frame.
        ass_path = os.path.join(workdir, "overlay.ass")
        with open(ass_path, "w", encoding="utf-8") as handle:
            handle.write(job["ass"])
        filters.append(f"[{last}]ass={ass_path}[v_ass]")
        last = "v_ass"

    if effects and not mixed:
        audio_map = effects.denoise(job, screen_path, filters, audio_map)

    output = os.path.join(workdir, "export.mp4")
    limit = []
    if mixed:
        # The padded narration mix never ends by itself and this ffmpeg's -shortest doesn't stop it, so cap the
        # output at the composed length: the trimmed source minus the cuts.
        start = job.get("trim_start") or 0
        stop = min(probe_duration(screen_path), job["trim_end"]) if job.get("trim_end") else probe_duration(screen_path)
        removed = sum(max(0.0, min(b, stop) - max(a, start)) for a, b in job.get("cuts") or [])
        limit = ["-t", f"{max(0.1, stop - start - removed):.3f}"]
    command = [
        "ffmpeg", "-v", "error", "-y", *inputs,
        "-filter_complex", ";".join(filters),
        "-map", f"[{last}]", *audio_map,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "160k",
        "-movflags", "+faststart", "-shortest", *limit, output,
    ]
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(result.stderr[-2000:])
    return output


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"ok")

    def do_POST(self):
        if self.path not in ("/render", "/concat", "/poster", "/cover") or (self.path == "/concat" and not effects) or (self.path == "/cover" and not cover):
            self.send_response(404)
            self.end_headers()
            return
        job = json.loads(self.rfile.read(int(self.headers.get("content-length", "0"))))
        workdir = tempfile.mkdtemp()
        try:
            extra = {}
            content_type = "video/mp4"
            if self.path == "/concat":
                output, durations, (width, height) = effects.concat(job, workdir)
                extra = {"x-durations": ",".join(f"{d:.3f}" for d in durations), "x-size": f"{width}x{height}"}
            elif self.path == "/poster":
                output = poster(job, workdir)
                content_type = "image/jpeg"
            elif self.path == "/cover":
                output = ai_cover(job, workdir) if job.get("background_url") else cover(job, workdir)
                content_type = "image/jpeg"
            else:
                output = render(job, workdir)
            size = os.path.getsize(output)
            self.send_response(200)
            self.send_header("content-type", content_type)
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
