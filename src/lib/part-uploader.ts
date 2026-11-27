/**
 * Streams MediaRecorder output into the recording's R2 multipart upload
 * while recording. R2 needs every part except the last to be exactly the
 * same size, so chunks are buffered and cut into fixed 5 MiB parts; the
 * remainder goes up as the final part on stop.
 */
import { withWebmDuration } from "@/lib/webm-duration"

export const PART_BYTES = 5 * 1024 * 1024

const MAX_ATTEMPTS = 6

export class PartUploader {
  private chunks: Array<Blob> = []
  private buffered = 0
  private queue: Array<{ partNumber: number; blob: Blob }> = []
  private nextPart = 1
  private running: Promise<void> | null = null
  private failure: Error | null = null
  // Kept so the length can be written into the file's header once recording ends (see webm-duration.ts).
  private firstPart: Blob | null = null
  uploadedBytes = 0
  totalBytes = 0

  constructor(
    private readonly id: string,
    private readonly track: "screen" | "camera" = "screen",
    private readonly onProgress?: () => void,
  ) {}

  /** Bytes recorded but not yet safely in R2. */
  get pendingBytes(): number {
    return this.totalBytes - this.uploadedBytes
  }

  get partCount(): number {
    return this.nextPart - 1
  }

  get error(): Error | null {
    return this.failure
  }

  push(chunk: Blob): void {
    if (chunk.size === 0) return
    this.chunks.push(chunk)
    this.buffered += chunk.size
    this.totalBytes += chunk.size
    while (this.buffered >= PART_BYTES) {
      const all = new Blob(this.chunks)
      this.enqueue(all.slice(0, PART_BYTES))
      const rest = all.slice(PART_BYTES)
      this.chunks = rest.size > 0 ? [rest] : []
      this.buffered = rest.size
    }
  }

  /**
   * Sends whatever is buffered as the last part and waits for every part to land. With the recording's length,
   * a WebM file gets it written into its header: in the last part if it's the only one, otherwise by sending the
   * first part again (same size, so R2's equal-part rule still holds).
   */
  async finish(seconds?: number): Promise<number> {
    if (this.buffered > 0 || this.nextPart === 1) {
      let last = new Blob(this.chunks)
      if (this.nextPart === 1 && seconds) last = await withWebmDuration(last, seconds).catch(() => last)
      this.enqueue(last)
      this.chunks = []
      this.buffered = 0
    }
    while (this.running) await this.running
    if (this.failure) throw this.failure
    const first = this.firstPart
    if (seconds && first && this.partCount > 1) {
      const patched = await withWebmDuration(first, seconds).catch(() => first)
      // Best effort: the original first part is already in place, and the player copes without a length.
      if (patched !== first) await this.send(1, patched).catch(() => {})
    }
    return this.partCount
  }

  private enqueue(blob: Blob): void {
    if (this.nextPart === 1) this.firstPart = blob
    this.queue.push({ partNumber: this.nextPart++, blob })
    if (!this.running) {
      this.running = this.drain().finally(() => {
        this.running = null
      })
    }
  }

  private async drain(): Promise<void> {
    while (this.queue.length > 0 && !this.failure) {
      const part = this.queue[0]
      try {
        await this.send(part.partNumber, part.blob)
        this.queue.shift()
        this.uploadedBytes += part.blob.size
        this.onProgress?.()
      } catch (error) {
        this.failure = error instanceof Error ? error : new Error(String(error))
      }
    }
  }

  private async send(partNumber: number, blob: Blob): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      try {
        const response = await fetch(
          `/api/recordings/${this.id}/parts?part=${partNumber}&track=${this.track}`,
          { method: "PUT", body: blob },
        )
        if (response.ok) return
        // Client errors won't fix themselves on retry.
        if (response.status < 500 && response.status !== 429) {
          throw new Error(`Part ${partNumber} was rejected (${response.status})`)
        }
        if (attempt >= MAX_ATTEMPTS) throw new Error(`Part ${partNumber} failed`)
      } catch (error) {
        if (attempt >= MAX_ATTEMPTS || (error instanceof Error && error.message.includes("rejected"))) {
          throw error
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt))
    }
  }
}

/** Prefer WebM: Chrome's hardware MP4 encoder can produce screen captures its own player can't decode. */
export function pickVideoMimeType(): string {
  const candidates = [
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=vp9,opus",
    "video/webm",
    "video/mp4;codecs=avc1,mp4a",
    "video/mp4",
  ]
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? "video/webm"
}

/** Video-only container for the separate camera track. */
export function pickCameraMimeType(): string {
  const candidates = ["video/mp4;codecs=avc1.64001F", "video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"]
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? "video/webm"
}

export function pickAudioMimeType(): string | null {
  const candidates = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"]
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? null
}
