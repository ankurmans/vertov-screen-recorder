import { getContainer } from "@cloudflare/containers";
import { eq } from "drizzle-orm";
import { env } from "cloudflare:workers";
import type { Upload } from "@/db/schema";
import { db } from "@/db";
import { uploads } from "@/db/schema";
import { buildAss } from "@/lib/ass";
import { isCaptionStyle } from "@/lib/caption-styles";
import { mapToExport, parseCuts } from "@/lib/cuts";
import { CURSOR_ART, cursorAt, cursorIdle, cursorPx } from "@/lib/cursor";
import type { CursorTrack } from "@/lib/cursor";
import { parseOverlays } from "@/lib/overlays";
import { zoomAt } from "@/lib/zooms";
import { cursorTrack } from "@/lib/zooms.server";
import { BACKGROUNDS, parseStyle, stageGeometry } from "@/lib/stage";
import { getTranscript, getUploadById } from "@/lib/uploads.server";
import { HOSTED_EDITION } from "@/lib/edition";

/** 1080p by default; recordings captured above 2.5K export at 4K. */
const exportWidth = (upload: Upload) => ((upload.width ?? 0) >= 2560 ? 3840 : 1920);

/** What the export depends on; when this changes, the old export is stale. */
export function exportSignature(upload: Upload): string {
  const style = upload.cameraKey ? parseStyle(upload.style) : { ...parseStyle(upload.style), layout: "screen" };
  return JSON.stringify([style, upload.trimStart ?? 0, upload.trimEnd ?? null, Boolean(upload.cameraKey), parseCuts(upload.cuts), upload.overlays, upload.captionStyle, upload.transcriptKey, upload.width, upload.voiceKey, upload.voiceOffset]);
}

/** The pointer's path on the export timeline, in output pixels (zoom applied), for the exporter's sprite overlay. */
function cursorJob(
  upload: Upload,
  style: ReturnType<typeof parseStyle>,
  track: CursorTrack,
  screen: { x: number; y: number; w: number; h: number },
  timing: { trimStart: number | null; trimEnd: number | null; cuts: string | null },
) {
  const settings = style.cursor!;
  const size = cursorPx(settings.size, screen.w);
  const art = CURSOR_ART[settings.style];
  const hot = { x: (art.hot[0] * size) / 128, y: (art.hot[1] * size) / 128 };
  const place = (t: number, fx: number, fy: number) => {
    const zoom = zoomAt(style.zooms ?? [], t);
    return [screen.x + screen.w * (zoom.x + fx * zoom.scale), screen.y + screen.h * (zoom.y + fy * zoom.scale)] as const;
  };
  const start = upload.trimStart ?? 0;
  const last = track.points[track.points.length - 1][0];
  const end = Math.min(upload.trimEnd ?? last, last);
  const frames: Array<[number, number, number]> = [];
  const visible: Array<[number, number]> = [];
  for (let t = start; t <= end && frames.length < 30000; t += 0.05) {
    const at = cursorAt(track, t, settings.smooth);
    const out = mapToExport(timing, t);
    if (!at || out == null) continue;
    const [x, y] = place(t, at.x, at.y);
    frames.push([Number(out.toFixed(3)), Math.round(x - hot.x), Math.round(y - hot.y)]);
    if (settings.idle && cursorIdle(track, t)) continue;
    const open = visible[visible.length - 1];
    if (open && out - open[1] < 0.12) open[1] = out + 0.05;
    else visible.push([out, out + 0.05]);
  }
  const clicks: Array<[number, number, number]> = [];
  const pressed: Array<[number, number]> = [];
  for (const [t, fx, fy] of track.clicks.slice(0, 2000)) {
    const out = mapToExport(timing, t);
    if (out == null) continue;
    pressed.push([out, out + 0.3]);
    const [x, y] = place(t, fx, fy);
    if (clicks.length < 30) clicks.push([Number(out.toFixed(3)), Math.round(x), Math.round(y)]);
  }
  return { style: settings.style, size: Math.round(size), fx: settings.fx, frames, visible, pressed, clicks };
}

/** Pixel geometry for the ffmpeg container, from the same math the player uses. */
export async function exportJob(upload: Upload) {
  const style = parseStyle(upload.style);
  const aspect = upload.width && upload.height ? upload.width / upload.height : 16 / 9;
  const hasCamera = Boolean(upload.cameraKey);
  const geometry = stageGeometry(style, aspect, hasCamera);
  const EXPORT_WIDTH = exportWidth(upload);
  const landscape = geometry.stageAspect >= 1;
  const width = landscape ? EXPORT_WIDTH : Math.round(EXPORT_WIDTH * geometry.stageAspect);
  const height = landscape ? Math.round(EXPORT_WIDTH / geometry.stageAspect) : EXPORT_WIDTH;
  const px = (box: { left: number; top: number; width: number; height: number }) => ({
    x: Math.round((box.left / 100) * width),
    y: Math.round((box.top / 100) * height),
    w: Math.round((box.width / 100) * width),
    h: Math.round((box.height / 100) * height),
  });
  const framed = style.background !== "none" || style.layout === "side" || style.layout === "split";
  const layout = hasCamera ? style.layout : "screen";
  const captionStyle = isCaptionStyle(upload.captionStyle) ? upload.captionStyle : "off";
  const overlays = parseOverlays(upload.overlays);
  const transcript = captionStyle !== "off" ? await getTranscript(upload) : null;
  const ass = buildAss({
    width: even(width),
    height: even(height),
    overlays,
    transcript,
    captionStyle,
    source: { trimStart: upload.trimStart, trimEnd: upload.trimEnd, cuts: upload.cuts },
  });
  // Blur regions and images need real frames, so the exporter composites them; times move to the export timeline like the ASS events.
  const timing = { trimStart: upload.trimStart, trimEnd: upload.trimEnd, cuts: upload.cuts };
  const placed = overlays.flatMap((overlay) => {
    const start = mapToExport(timing, overlay.start);
    if (start == null) return [];
    const end = mapToExport(timing, overlay.end) ?? start + (overlay.end - overlay.start);
    if (end - start < 0.05) return [];
    const clamp = (value: number, max: number) => Math.max(0, Math.min(max, Math.round(value)));
    const x = clamp((overlay.x / 100) * width, width - 2);
    const y = clamp((overlay.y / 100) * height, height - 2);
    const w = Math.max(2, Math.min(width - x, Math.round((overlay.w / 100) * width)));
    const h = Math.max(2, Math.min(height - y, Math.round((overlay.h / 100) * height)));
    return [{ overlay, start: Number(start.toFixed(3)), end: Number(end.toFixed(3)), x, y, w, h }];
  });
  const track = HOSTED_EDITION && style.cursor && geometry.screen ? await cursorTrack(upload) : null;
  const cursor = track && geometry.screen ? cursorJob(upload, style, track, px(geometry.screen), timing) : null;
  return {
    cursor,
    blur_boxes: placed.filter((item) => item.overlay.type === "blur").map(({ start, end, x, y, w, h }) => ({ start, end, x, y, w, h })),
    images: placed
      .filter((item) => item.overlay.type === "image" && item.overlay.src)
      .map(({ overlay, start, end, x, y, w }) => ({ start, end, x, y, w, url: `http://media.internal/uploads/overlays/${overlay.src.split("/").slice(-2).join("/")}` })),
    denoise: HOSTED_EDITION && style.denoise === true,
    zoom_points: HOSTED_EDITION ? (style.zooms ?? []) : [],
    ass,
    // Served from R2 by the Exporter's outbound handler.
    screen_url: `http://media.internal/${upload.r2Key}`,
    camera_url: hasCamera && upload.cameraKey ? `http://media.internal/${upload.cameraKey}` : null,
    voice_url: upload.voiceKey ? `http://media.internal/${upload.voiceKey}` : null,
    voice_offset: upload.voiceOffset ?? 0,
    width,
    height,
    background: (BACKGROUNDS[style.background] ?? BACKGROUNDS.none).colors,
    screen: geometry.screen ? { ...px(geometry.screen), radius: framed ? Math.round(width / 80) : 0 } : null,
    camera: geometry.camera
      ? {
          ...px(geometry.camera),
          circle: layout === "bubble" && style.shape === "circle",
          radius: Math.round(width / 70),
          // Camera only and split fill their box edge to edge, so no mask.
          full: layout === "camera" || layout === "split",
        }
      : null,
    trim_start: upload.trimStart ?? 0,
    trim_end: upload.trimEnd ?? null,
    cuts: parseCuts(upload.cuts).filter(
      ([start, end]) => end > (upload.trimStart ?? 0) && (upload.trimEnd == null || start < upload.trimEnd),
    ),
  };
}

/** Queue job: render in the ffmpeg container, then stream the MP4 into R2 in parts. */
export async function processExport(id: string): Promise<void> {
  const upload = await getUploadById(id);
  if (!upload || upload.status !== "ready") return;
  const signature = exportSignature(upload);
  try {
    // A fresh instance per render, so it always starts with the current image and network rules.
    const container = getContainer(env.EXPORTER, `${id}:${crypto.randomUUID()}`);
    const response = await container.fetch(
      new Request("http://exporter/render", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(await exportJob(upload)),
      }),
    );
    if (!response.ok || !response.body) {
      throw new Error(`render failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
    }
    let key = `uploads/${id}/export.mp4`;
    await streamToR2(key, response.body);
    key = await addBookends(upload, key);
    await db
      .update(uploads)
      .set({ exportKey: key, exportStatus: "done", exportSignature: signature })
      .where(eq(uploads.id, id));
  } catch (error) {
    console.error(JSON.stringify({ message: "Export failed", id, error: error instanceof Error ? error.message : String(error) }));
    await db.update(uploads).set({ exportStatus: "failed" }).where(eq(uploads.id, id));
  }
}

/** Joins the video's chosen intro and outro (other ready videos in the same workspace) around its render. */
async function addBookends(upload: Upload, mainKey: string): Promise<string> {
  if (!HOSTED_EDITION) return mainKey;
  const style = parseStyle(upload.style);
  const clipKey = async (clipId: string | undefined) => {
    if (!clipId || clipId === upload.id) return null;
    const clip = await getUploadById(clipId);
    if (!clip || clip.workspaceId !== upload.workspaceId || clip.status !== "ready" || clip.mediaType !== "video" || clip.deletedAt) return null;
    // Its own layout when that render is current; otherwise the recording as captured (never a nested render).
    return clip.exportStatus === "done" && clip.exportKey && clip.exportSignature === exportSignature(clip) ? clip.exportKey : clip.r2Key;
  };
  const intro = await clipKey(style.intro);
  const outro = await clipKey(style.outro);
  if (!intro && !outro) return mainKey;
  const inputs = [intro, mainKey, outro].filter((key): key is string => Boolean(key)).map((key) => `http://media.internal/${key}`);
  const container = getContainer(env.EXPORTER, `${upload.id}:bookends:${crypto.randomUUID()}`);
  const response = await container.fetch(
    new Request("http://exporter/concat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ inputs, size_from: intro ? 1 : 0 }) }),
  );
  if (!response.ok || !response.body) throw new Error(`intro/outro join failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
  const key = `uploads/${upload.id}/export-full.mp4`;
  await streamToR2(key, response.body);
  return key;
}

const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);

const PART = 10 * 1024 * 1024;

/** Multipart upload of a stream of unknown length without holding it all in memory. */
export async function streamToR2(key: string, body: ReadableStream<Uint8Array>, contentType = "video/mp4"): Promise<number> {
  const upload = await env.BUCKET.createMultipartUpload(key, { httpMetadata: { contentType } });
  const parts: Array<R2UploadedPart> = [];
  const reader = body.getReader();
  let chunks: Array<Uint8Array> = [];
  let buffered = 0;
  let total = 0;
  const flush = async (size: number) => {
    const out = new Uint8Array(size);
    let offset = 0;
    const rest: Array<Uint8Array> = [];
    for (const chunk of chunks) {
      if (offset >= size) {
        rest.push(chunk);
        continue;
      }
      const take = Math.min(chunk.length, size - offset);
      out.set(chunk.subarray(0, take), offset);
      offset += take;
      if (take < chunk.length) rest.push(chunk.subarray(take));
    }
    chunks = rest;
    buffered -= size;
    parts.push(await upload.uploadPart(parts.length + 1, out));
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      buffered += value.length;
      total += value.length;
      while (buffered >= PART) await flush(PART);
    }
    if (buffered > 0 || parts.length === 0) await flush(buffered);
    await upload.complete(parts);
    return total;
  } catch (error) {
    await upload.abort().catch(() => {});
    throw error;
  }
}
