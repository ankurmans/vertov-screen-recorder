"""Helpers the renderer and the effects module share: fetching inputs, probing media, masks."""
import shutil
import subprocess
import urllib.request


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
