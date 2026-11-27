import { getContainer } from "@cloudflare/containers";
import { trackError } from "@/lib/error-report.server";
import { inRegion } from "@/lib/region.server";
import { and, count, eq } from "drizzle-orm";
import { env } from "cloudflare:workers";
import type { Upload } from "@/db/schema";
import { db } from "@/db";
import { uploads } from "@/db/schema";
import { buildAss } from "@/lib/ass";
import { isCaptionStyle } from "@/lib/caption-styles";
import { parseCuts } from "@/lib/cuts";
import { parseOverlays } from "@/lib/overlays";
import { allow } from "@/lib/rate-limit.server";
import { BACKGROUNDS, parseStyle, stageGeometry } from "@/lib/stage";
import { getTranscript, getUploadById } from "@/lib/uploads.server";

/** 1080p by default; recordings captured above 2.5K export at 4K. */
const exportWidth = (upload: Upload) => ((upload.width ?? 0) >= 2560 ? 3840 : 1920);

/** What the export depends on; when this changes, the old export is stale. */
export function exportSignature(upload: Upload): string {
  const style = upload.cameraKey ? parseStyle(upload.style) : { ...parseStyle(upload.style), layout: "screen" };
  return JSON.stringify([style, upload.trimStart ?? 0, upload.trimEnd ?? null, Boolean(upload.cameraKey), parseCuts(upload.cuts), upload.overlays, upload.captionStyle, upload.transcriptKey, upload.width]);
}

export const exportSignatureFor = async (upload: Upload): Promise<string> => exportSignature(upload);

/** A finished render of this video that is current for its edits, or null. */
export async function cleanExportKey(upload: Upload): Promise<string | null> {
  return upload.exportStatus === "done" && upload.exportKey && upload.exportSignature === exportSignature(upload) ? upload.exportKey : null;
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
  const framed = style.background !== "none" || style.layout === "side" || style.layout === "split" || (hasCamera && style.layout === "focus");
  const layout = hasCamera ? style.layout : "screen";
  const captionStyle = isCaptionStyle(upload.captionStyle) ? upload.captionStyle : "off";
  const overlays = parseOverlays(upload.overlays, upload.id);
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
    background_image: BACKGROUNDS[style.background]?.image ?? null,
    camera_first: layout === "focus",
    screen: geometry.screen ? { ...px(geometry.screen), radius: framed ? Math.round(width / 80) : 0 } : null,
    camera: geometry.camera
      ? {
          ...px(geometry.camera),
          circle: layout === "bubble" && style.shape === "circle",
          radius: Math.round(width / 70),
          // Camera only, split and camera-first fill their box edge to edge, so no mask.
          full: layout === "camera" || layout === "split" || layout === "focus",
        }
      : null,
    trim_start: upload.trimStart ?? 0,
    trim_end: upload.trimEnd ?? null,
    cuts: parseCuts(upload.cuts).filter(
      ([start, end]) => end > (upload.trimStart ?? 0) && (upload.trimEnd == null || start < upload.trimEnd),
    ),
  };
}

/** One export in progress. It travels in the queue message, so no request or queue consumer stays open for the render. */
export type ExportRun = { name: string; stage: "render" | "join" | "joining"; signature: string; endCard: boolean; startedAt: number; restarts: number };

/** A render may take eight times the video's length, at least an hour and at most a day. */
export const renderDeadlineMs = (duration: number | null) => Math.min(24 * 3600, Math.max(3600, (duration ?? 0) * 8)) * 1000;

/** Seconds until the next look at a job: quick for a short video, every half minute for a long one. */
export const pollSeconds = (startedAt: number, now = Date.now()) => Math.min(30, 3 + Math.floor(Math.max(0, now - startedAt) / 20_000));

const MAX_RESTARTS = 3;

/**
 * Queue job: start the render in its own exporter instance, then follow it with "export-step" messages. A queue
 * consumer may run 15 minutes, and a long video renders for much longer than that.
 */
export async function processExport(id: string): Promise<void> {
  const upload = await getUploadById(id);
  if (!upload || upload.status !== "ready" || upload.exportStatus !== "pending") return;
  const endCard = false;
  const signature = exportSignature(upload);
  const run: ExportRun = { name: exportJobName(id), stage: "render", signature, endCard, startedAt: Date.now(), restarts: 0 };
  try {
    await startRender(run.name, upload);
  } catch (error) {
    if (error instanceof ContainerBusyError) throw error;
    await failExport(id, run.name, error);
    return;
  }
  await nextExportStep(id, run);
}

async function startRender(name: string, upload: Upload): Promise<void> {
  const job = await exportJob(upload);
  await startExportJob(name, "render", job);
}

const nextExportStep = (id: string, run: ExportRun) => env.PROCESS_QUEUE.send({ id, kind: "export-step", run }, { delaySeconds: pollSeconds(run.startedAt) });

async function failExport(id: string, name: string, error: unknown): Promise<void> {
  console.error(JSON.stringify({ message: "Export failed", id, error: error instanceof Error ? error.message : String(error) }));
  trackError(error, { source: "job", route: "export", uploadId: id });
  await db.update(uploads).set({ exportStatus: "failed" }).where(eq(uploads.id, id));
  await destroyExportJob(name);
}

/**
 * Looks at a running export once: waits more, collects the finished file, joins the intro, outro or end card, restarts
 * a render lost with its instance, or gives up. Throws ContainerBusyError to have the queue deliver it again later.
 */
export async function stepExport(id: string, run: ExportRun, attempts = 1): Promise<void> {
  const upload = await getUploadById(id);
  // Deleted, or no longer waiting (another run finished it or it was given up): nothing left to do here.
  if (!upload || upload.status !== "ready" || upload.exportStatus !== "pending") return destroyExportJob(run.name);
  try {
    const rendered = `uploads/${id}/export.mp4`;
    if (run.stage === "join") {
      const join = await bookendInputs(upload, rendered, run.endCard);
      if (!join) return await finishExport(id, run, rendered);
      await startExportJob(run.name, "concat", join);
      await nextExportStep(id, { ...run, stage: "joining" });
      return;
    }
    const status = await exportJobState(run.name);
    if (status.state === "running") {
      if (Date.now() - run.startedAt > renderDeadlineMs(upload.duration)) return await failExport(id, run.name, new Error("the render took too long"));
      await nextExportStep(id, run);
      return;
    }
    if (status.state === "failed") return await failExport(id, run.name, new Error(`${run.stage} failed: ${(status.error ?? "").slice(0, 500)}`));
    if (status.state === "unknown") {
      // The instance restarted (a new image, or its host) and the job went with it.
      if (run.restarts >= MAX_RESTARTS) return await failExport(id, run.name, new Error("the render was interrupted too many times"));
      const again: ExportRun = { ...run, name: exportJobName(id), restarts: run.restarts + 1, startedAt: Date.now(), stage: run.stage === "render" ? "render" : "join" };
      await destroyExportJob(run.name);
      if (again.stage === "render") await startRender(again.name, upload);
      await nextExportStep(id, again);
      return;
    }
    const key = run.stage === "render" ? rendered : `uploads/${id}/export-full.mp4`;
    const output = await exportJobOutput(run.name);
    await streamToR2(key, output.body!);
    if (run.stage === "render" && (await bookendInputs(upload, rendered, run.endCard))) {
      await nextExportStep(id, { ...run, name: exportJobName(id), stage: "join", startedAt: Date.now() });
    } else await finishExport(id, run, key);
    // Only now that the result is recorded: until then a retried step can collect the file again.
    await destroyExportJob(run.name);
  } catch (error) {
    if (error instanceof ContainerBusyError) throw error;
    // A passing fault (D1, R2, the instance) shouldn't throw away hours of rendering: try the same step again.
    if (attempts < 5) throw new ContainerBusyError(`export step will be retried: ${error instanceof Error ? error.message : String(error)}`);
    await failExport(id, run.name, error);
  }
}

async function finishExport(id: string, run: ExportRun, key: string): Promise<void> {
  await db
    .update(uploads)
    .set({ exportKey: key, exportStatus: "done", exportSignature: run.signature })
    .where(and(eq(uploads.id, id), eq(uploads.exportStatus, "pending")));
}

const bookendInputs = async (_upload: Upload, _mainKey: string, _endCard: boolean): Promise<{ inputs: Array<string> } | null> => null;

export const atCapacity = (response: Response, text: string) =>
  response.status === 503 || response.status === 429 || (response.status === 500 && text.includes("Maximum number of running container instances"));

/** Every container instance was busy. The queue consumer hands the message back to the queue (see busyRetryDelay), so the job waits instead of failing. */
export class ContainerBusyError extends Error {}

/** Seconds a queued job waits after its `attempts`th delivery found every container busy: 30s, 60s, then 2 minutes, plus up to 15s so a burst doesn't return together. */
export const busyRetryDelay = (attempts: number, jitter = Math.random()) => Math.min(30 * 2 ** Math.max(0, attempts - 1), 120) + Math.floor(jitter * 15);

/** A job gets its own exporter instance, named for it. */
export const exportJobName = (id: string) => `${id}:${crypto.randomUUID()}`;

const exporterFor = (name: string) => getContainer(inRegion(env.EXPORTER), name);

/** Starts a background render or join in the job's instance; asking again with the same name changes nothing. */
export async function startExportJob(name: string, kind: "render" | "concat" | "blank", job: unknown): Promise<void> {
  const response = await exporterFor(name).fetch(new Request("http://exporter/jobs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: name, kind, job }) }));
  if (response.ok) return;
  const text = await response.text();
  if (atCapacity(response, text)) throw new ContainerBusyError(`every exporter instance is busy (${response.status})`);
  // During a deploy an instance may still run the image without background jobs; wait for the rollout.
  if (response.status === 404 || (response.status === 400 && text.includes("unknown kind"))) throw new ContainerBusyError("the exporter is still updating");
  throw new Error(`exporter refused the job (${response.status}): ${text.slice(0, 500)}`);
}

async function askExporter(name: string, path: string): Promise<Response> {
  const response = await exporterFor(name).fetch(new Request(`http://exporter${path}`));
  if (response.ok) return response;
  const text = await response.text();
  if (atCapacity(response, text)) throw new ContainerBusyError(`every exporter instance is busy (${response.status})`);
  throw new Error(`exporter ${path} failed (${response.status}): ${text.slice(0, 500)}`);
}

/** "unknown" means the instance no longer has the job (it restarted). */
export async function exportJobState(name: string): Promise<{ state: "running" | "done" | "failed" | "unknown"; error?: string }> {
  return (await askExporter(name, `/jobs/${encodeURIComponent(name)}`)).json();
}

export const exportJobOutput = (name: string) => askExporter(name, `/jobs/${encodeURIComponent(name)}/output`);

export async function destroyExportJob(name: string): Promise<void> {
  await exporterFor(name).destroy().catch(() => {});
}

/**
 * POSTs a job to a fresh exporter instance (so it always starts with the current image and network rules),
 * waits briefly (15s, then 30s) while every instance is busy, then throws ContainerBusyError so the queue retries it
 * later without holding a consumer. Destroys the instance once `read` is done with the response.
 */
export async function withExporter<T>(name: string, path: string, job: unknown, read: (response: Response) => Promise<T>): Promise<T> {
  const body = JSON.stringify(job);
  for (let attempt = 0; ; attempt++) {
    const container = getContainer(inRegion(env.EXPORTER), `${name}:${crypto.randomUUID()}`);
    try {
      const response = await container.fetch(new Request(`http://exporter/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body }));
      if (!response.ok) {
        const text = await response.text();
        if (atCapacity(response, text)) {
          if (attempt >= 2) throw new ContainerBusyError(`every exporter instance is busy (${response.status})`);
          await new Promise((resolve) => setTimeout(resolve, 15_000 * 2 ** attempt));
          continue;
        }
        return await read(new Response(text, { status: response.status, headers: response.headers }));
      }
      return await read(response);
    } finally {
      await container.destroy().catch(() => {});
    }
  }
}

/**
 * The exporter pool is small and shared by every workspace (max_instances in wrangler.jsonc), so one workspace may have
 * only a few MP4 renders waiting or running at once, and each person and workspace may start only so many an hour.
 */
export const EXPORT_LIMITS = { inFlightPerWorkspace: 3, perUserPerHour: 30, perWorkspacePerHour: 120 } as const;

/** Null when a new render of `upload` may be queued for `userId`; otherwise why not, for a 429. */
export async function exportAdmission(upload: Upload, userId: string): Promise<{ error: string; retryAfter: number } | null> {
  const scope = upload.workspaceId ? eq(uploads.workspaceId, upload.workspaceId) : eq(uploads.ownerId, upload.ownerId ?? userId);
  const [{ n: inFlight }] = await db.select({ n: count() }).from(uploads).where(and(scope, eq(uploads.exportStatus, "pending")));
  if (inFlight >= EXPORT_LIMITS.inFlightPerWorkspace) {
    return { error: `Up to ${EXPORT_LIMITS.inFlightPerWorkspace} videos render at once in a workspace. Try again when one finishes.`, retryAfter: 60 };
  }
  const allowed =
    (await allow(`export:u:${userId}`, EXPORT_LIMITS.perUserPerHour, 3600)) &&
    (!upload.workspaceId || (await allow(`export:w:${upload.workspaceId}`, EXPORT_LIMITS.perWorkspacePerHour, 3600)));
  return allowed ? null : { error: "Too many MP4 renders started this hour. Try again later.", retryAfter: 600 };
}

const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);

const PART = 10 * 1024 * 1024;

/** Thrown when a remote file is larger than it may be; the copy stops and nothing of it is kept. */
export class TooLargeError extends Error {}

/**
 * Fetches a remote URL, following at most `maxRedirects` redirects, each to an https address.
 * `signal` bounds the whole download, body included.
 */
export async function fetchRemote(url: string, init: { headers?: Record<string, string>; signal?: AbortSignal; maxRedirects?: number } = {}): Promise<Response> {
  let current = url;
  for (let hop = 0; ; hop++) {
    const response = await fetch(current, { headers: init.headers, signal: init.signal, redirect: "manual" });
    const location = response.status >= 300 && response.status < 400 ? response.headers.get("location") : null;
    if (!location) return response;
    await response.body?.cancel().catch(() => {});
    if (hop >= (init.maxRedirects ?? 5)) throw new Error("too many redirects");
    const next = new URL(location, current);
    if (next.protocol !== "https:") throw new Error("redirected to a non-https address");
    current = next.toString();
  }
}

/** A response body read whole, refusing one that says or turns out to be over `maxBytes`. */
export async function readCapped(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (declared > maxBytes) {
    await response.body?.cancel().catch(() => {});
    throw new TooLargeError(`larger than ${maxBytes} bytes`);
  }
  if (!response.body) return new Uint8Array(0);
  const reader = response.body.getReader();
  const chunks: Array<Uint8Array> = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new TooLargeError(`larger than ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  if (chunks.length === 1) return chunks[0];
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * Multipart upload of a stream of unknown length without holding it all in memory. A stream that passes `maxBytes` is
 * cancelled, the upload aborted, and TooLargeError thrown.
 */
export async function streamToR2(key: string, body: ReadableStream<Uint8Array>, contentType = "video/mp4", maxBytes = Number.POSITIVE_INFINITY): Promise<number> {
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
      if (total + value.length > maxBytes) throw new TooLargeError(`larger than ${maxBytes} bytes`);
      chunks.push(value);
      buffered += value.length;
      total += value.length;
      while (buffered >= PART) await flush(PART);
    }
    if (buffered > 0 || parts.length === 0) await flush(buffered);
    await upload.complete(parts);
    return total;
  } catch (error) {
    await reader.cancel().catch(() => {});
    await upload.abort().catch(() => {});
    throw error;
  }
}
