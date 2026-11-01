import { getContainer } from "@cloudflare/containers";
import { eq } from "drizzle-orm";
import { env } from "cloudflare:workers";
import type { Upload } from "@/db/schema";
import { db } from "@/db";
import { uploads } from "@/db/schema";
import { buildAss } from "@/lib/ass";
import { isCaptionStyle } from "@/lib/caption-styles";
import { parseCuts } from "@/lib/cuts";
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
  return {
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
    const key = `uploads/${id}/export.mp4`;
    await streamToR2(key, response.body);
    await db
      .update(uploads)
      .set({ exportKey: key, exportStatus: "done", exportSignature: signature })
      .where(eq(uploads.id, id));
  } catch (error) {
    console.error(JSON.stringify({ message: "Export failed", id, error: error instanceof Error ? error.message : String(error) }));
    await db.update(uploads).set({ exportStatus: "failed" }).where(eq(uploads.id, id));
  }
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
