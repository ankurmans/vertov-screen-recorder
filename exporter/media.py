"""Helpers the renderer and the effects module share: fetching inputs, probing media, masks."""
import os
import shutil
import subprocess
import urllib.request


def download(url, path):
    # Cloudflare turns away urllib's default user agent.
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; vertov-exporter/1.0)"})
    with urllib.request.urlopen(request, timeout=600) as response, open(path, "wb") as out:
        shutil.copyfileobj(response, out, 1024 * 1024)


# A picture that never changes (background, corner mask, sprite) is read and prepared once, then repeated. Reading it
# again for every frame (-loop 1, or a generating source) cost more than the video itself. Pair with still_input.
STILL = "loop=loop=-1:size=1,setpts=N"


# Every render and join encodes with these, so that finished files can be joined without encoding them again:
# "stitchable" keeps the stream headers the same whatever the picture.
VIDEO_CODEC = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p", "-x264-params", "stitchable=1"]


def still_input(path):
    return ["-framerate", "30", "-i", path]


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
        pass
    # A browser's WebM states no length, so read it off the last packet (demux only, no decoding).
    end = 0.0
    with subprocess.Popen(
        ["ffprobe", "-v", "error", "-show_entries", "packet=pts_time,duration_time", "-of", "csv=p=0", path],
        stdout=subprocess.PIPE, text=True,
    ) as packets:
        for line in packets.stdout:
            fields = line.strip().split(",")
            try:
                at = float(fields[0])
            except ValueError:
                continue
            try:
                at += float(fields[1])
            except (IndexError, ValueError):
                pass
            end = max(end, at)
    return end or 6 * 3600.0


def has_audio(path):
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", path],
        capture_output=True, text=True,
    )
    return bool(probe.stdout.strip())


def step_expr(points, var="t"):
    """An ffmpeg expression for a value that changes at given points [(from, value), ...] in ascending order, as a
    balanced if() tree: a frame costs log2(n) comparisons, however long the video or its list of edits."""
    changes = []
    for at, value in points:
        if changes and at == changes[-1][0]:
            changes.pop()
        if not changes or value != changes[-1][1]:
            changes.append((at, value))

    def tree(lo, hi):
        if hi - lo == 1:
            return str(changes[lo][1])
        mid = (lo + hi) // 2
        return f"if(lt({var},{round(changes[mid][0], 3)}),{tree(lo, mid)},{tree(mid, hi)})"

    return tree(0, len(changes))


_filter_file_flag = None


def filter_args(filters, workdir):
    """The filter graph as ffmpeg arguments. Linux refuses one argument over 128 KB (hundreds of cuts, or a long
    pointer path), so a large graph goes in a file."""
    global _filter_file_flag
    graph = ";".join(filters)
    if len(graph.encode()) < 100_000:
        return ["-filter_complex", graph]
    if _filter_file_flag is None:
        version = subprocess.run(["ffmpeg", "-version"], capture_output=True, text=True).stdout.split()
        major = version[2].split(".")[0].lstrip("n") if len(version) > 2 else ""
        _filter_file_flag = "-/filter_complex" if major.isdigit() and int(major) >= 7 else "-filter_complex_script"
    path = os.path.join(workdir, "graph.txt")
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(graph)
    return [_filter_file_flag, path]


def run_mask(path, w, h, expression):
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"color=black:s={w}x{h}:d=1",
         "-vf", f"format=gray,geq=lum='{expression}'", "-frames:v", "1", path],
        check=True,
    )
