import { getContainer } from "@cloudflare/containers";
import { eq } from "drizzle-orm";
import { env } from "cloudflare:workers";
import type { Upload } from "@/db/schema";
import { db } from "@/db";
import { uploads } from "@/db/schema";
import { buildAss } from "@/lib/ass";
import { isCaptionStyle } from "@/lib/caption-styles";
import { mapToExport, parseCuts } from "@/lib/cuts";
import { parseOverlays } from "@/lib/overlays";
import { BACKGROUNDS, parseStyle, stageGeometry } from "@/lib/stage";
import { getTranscript, getUploadById } from "@/lib/uploads.server";

/** 1080p by default; recordings captured above 2.5K export at 4K. */
const exportWidth = (upload: Upload) => ((upload.width ?? 0) >= 2560 ? 3840 : 1920);

/** What the export depends on; when this changes, the old export is stale. */
export function exportSignature(upload: Upload): string {
  const style = upload.cameraKey ? parseStyle(upload.style) : { ...parseStyle(upload.style), layout: "screen" };
  return JSON.stringify([style, upload.trimStart ?? 0, upload.trimEnd ?? null, Boolean(upload.cameraKey), parseCuts(upload.cuts), upload.overlays, upload.captionStyle, upload.transcriptKey, upload.width]);
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
  const framed = style.background !== "none" || style.layout === "side";
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
  return {
    blur_boxes: placed.filter((item) => item.overlay.type === "blur").map(({ start, end, x, y, w, h }) => ({ start, end, x, y, w, h })),
    images: placed
      .filter((item) => item.overlay.type === "image" && item.overlay.src)
      .map(({ overlay, start, end, x, y, w }) => ({ start, end, x, y, w, url: `http://media.internal/uploads/overlays/${overlay.src.split("/").slice(-2).join("/")}` })),
    denoise: style.denoise === true,
    zoom_points: style.zooms ?? [],
    ass,
    // Served from R2 by the Exporter's outbound handler.
    screen_url: `http://media.internal/${upload.r2Key}`,
    camera_url: hasCamera && upload.cameraKey ? `http://media.internal/${upload.cameraKey}` : null,
    width,
    height,
    background: (BACKGROUNDS[style.background] ?? BACKGROUNDS.none).colors,
    screen: geometry.screen ? { ...px(geometry.screen), radius: framed ? Math.round(width / 80) : 0 } : null,
    camera: geometry.camera
      ? {
          ...px(geometry.camera),
          circle: layout === "bubble" && style.shape === "circle",
          radius: Math.round(width / 70),
          full: layout === "camera",
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
