/**
 * Streams MediaRecorder output into the recording's R2 multipart upload while recording.
 * R2 needs every part except the last to be exactly the same size, so chunks are buffered
 * and cut into fixed 5 MiB parts; the remainder goes up as the final part on stop.
 * Same logic as the web recorder's src/lib/part-uploader.ts.
 */
export const PART_BYTES = 5 * 1024 * 1024
const MAX_ATTEMPTS = 6

export class PartUploader {
  /** `call(path, init)` is a fetch against the server with the API key attached. */
  constructor(call, id, track = "screen") {
    this.call = call
    this.id = id
    this.track = track
    this.chunks = []
    this.buffered = 0
    this.queue = []
    this.nextPart = 1
    this.running = null
    this.failure = null
    this.uploadedBytes = 0
    this.totalBytes = 0
  }

  get partCount() {
    return this.nextPart - 1
  }

  get pendingBytes() {
    return this.totalBytes - this.uploadedBytes
  }

  push(chunk) {
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

  async finish() {
    if (this.buffered > 0 || this.nextPart === 1) {
      this.enqueue(new Blob(this.chunks))
      this.chunks = []
      this.buffered = 0
    }
    while (this.running) await this.running
    if (this.failure) throw this.failure
    return this.partCount
  }

  enqueue(blob) {
    this.queue.push({ partNumber: this.nextPart++, blob })
    if (!this.running) {
      this.running = this.drain().finally(() => {
        this.running = null
      })
    }
  }

  async drain() {
    while (this.queue.length > 0 && !this.failure) {
      const part = this.queue[0]
      try {
        await this.send(part.partNumber, part.blob)
        this.queue.shift()
        this.uploadedBytes += part.blob.size
      } catch (error) {
        this.failure = error instanceof Error ? error : new Error(String(error))
      }
    }
  }

  async send(partNumber, blob) {
    for (let attempt = 1; ; attempt++) {
      try {
        const response = await this.call(`/api/recordings/${this.id}/parts?part=${partNumber}&track=${this.track}`, { method: "PUT", body: blob })
        if (response.ok) return
        // Client errors won't fix themselves on retry.
        if (response.status < 500 && response.status !== 429) throw new Error(`Part ${partNumber} was rejected (${response.status})`)
        if (attempt >= MAX_ATTEMPTS) throw new Error(`Part ${partNumber} failed`)
      } catch (error) {
        if (attempt >= MAX_ATTEMPTS || String(error?.message).includes("rejected")) throw error
      }
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt))
    }
  }
}

/** Best container Chrome can record: H.264 MP4 plays everywhere, WebM is the fallback. */
export function pickVideoMimeType() {
  const candidates = ["video/mp4;codecs=avc1.64001F,mp4a.40.2", "video/mp4;codecs=avc1,mp4a", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? "video/webm"
}

export function pickCameraMimeType() {
  const candidates = ["video/mp4;codecs=avc1.64001F", "video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"]
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? "video/webm"
}

export function pickAudioMimeType() {
  const candidates = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"]
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? null
}

/**
 * Sends a second copy of the recording a few seconds at a time so viewers can watch (and rewind)
 * before it ends. Best effort: a chunk that won't go is skipped and the real upload is unaffected.
 */
export class LiveUploader {
  constructor(call, id, mime) {
    this.call = call
    this.id = id
    this.mime = mime
    this.chunks = []
    this.since = performance.now()
    this.next = 1
    this.chain = Promise.resolve()
  }

  push(chunk) {
    if (chunk.size === 0) return
    this.chunks.push(chunk)
    if (performance.now() - this.since >= 3000) this.flush()
  }

  flush() {
    if (this.chunks.length === 0) return
    const blob = new Blob(this.chunks)
    const n = this.next++
    this.chunks = []
    this.since = performance.now()
    this.chain = this.chain.then(() => this.send(n, blob))
  }

  async send(n, blob) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await this.call(`/api/recordings/${this.id}/live?n=${n}`, { method: "PUT", headers: { "x-live-mime": this.mime }, body: blob })
        if (response.ok || (response.status < 500 && response.status !== 429)) return
      } catch {
        // retry
      }
      await new Promise((resolve) => setTimeout(resolve, 400 * attempt))
    }
  }
}
