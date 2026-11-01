import { PartUploader } from "@/lib/part-uploader"

const MAX_AUDIO_BYTES = 25 * 1024 * 1024

function videoMeta(url: string): Promise<{ width: number; height: number; duration: number; element: HTMLVideoElement }> {
  return new Promise((resolve, reject) => {
    const element = document.createElement("video")
    element.preload = "auto"
    element.muted = true
    element.playsInline = true
    element.onloadedmetadata = () =>
      resolve({ width: element.videoWidth, height: element.videoHeight, duration: element.duration, element })
    element.onerror = () => reject(new Error("This browser can't read that video"))
    element.src = url
  })
}

async function posterFrom(element: HTMLVideoElement): Promise<Blob | null> {
  const at = Math.min(2, (element.duration || 0) / 3)
  await new Promise<void>((resolve) => {
    element.onseeked = () => resolve()
    element.currentTime = at
    setTimeout(resolve, 4000)
  })
  const scale = Math.min(1, 1280 / (element.videoWidth || 1280))
  const canvas = document.createElement("canvas")
  canvas.width = Math.round((element.videoWidth || 1280) * scale)
  canvas.height = Math.round((element.videoHeight || 720) * scale)
  canvas.getContext("2d")?.drawImage(element, 0, 0, canvas.width, canvas.height)
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85))
}

/** 16 kHz mono WAV of the file's sound, small enough for transcription; null if there's no audio. */
async function speechTrack(file: File): Promise<Blob | null> {
  try {
    const decoded = await new AudioContext().decodeAudioData(await file.arrayBuffer())
    const rate = 16_000
    const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * rate), rate)
    const source = offline.createBufferSource()
    source.buffer = decoded
    source.connect(offline.destination)
    source.start()
    const samples = (await offline.startRendering()).getChannelData(0)
    const bytes = 44 + samples.length * 2
    if (bytes > MAX_AUDIO_BYTES) return null
    const view = new DataView(new ArrayBuffer(bytes))
    const text = (offset: number, value: string) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)))
    text(0, "RIFF")
    view.setUint32(4, bytes - 8, true)
    text(8, "WAVEfmt ")
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true)
    view.setUint16(22, 1, true)
    view.setUint32(24, rate, true)
    view.setUint32(28, rate * 2, true)
    view.setUint16(32, 2, true)
    view.setUint16(34, 16, true)
    text(36, "data")
    view.setUint32(40, samples.length * 2, true)
    for (let i = 0; i < samples.length; i += 1) {
      view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 0x7fff, true)
    }
    return new Blob([view], { type: "audio/wav" })
  } catch {
    return null
  }
}

/** Uploads a video file from disk the same way a recording streams up, then finishes it. */
export async function uploadVideoFile(file: File, onProgress: (fraction: number) => void): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const meta = await videoMeta(url)
    const response = await fetch("/api/recordings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mimeType: file.type || "video/mp4",
        width: meta.width || null,
        height: meta.height || null,
        surface: "upload",
        title: file.name.replace(/\.[^.]+$/, "").slice(0, 200) || null,
      }),
    })
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string }
      throw new Error(body.error === "Unsupported recording format" ? "Use an MP4, MOV or WebM file" : (body.error ?? "Upload failed"))
    }
    const { id }: { id: string } = await response.json()
    const uploader = new PartUploader(id, "screen", () => onProgress(uploader.uploadedBytes / Math.max(1, file.size)))
    uploader.push(file)
    const [partCount, poster, audio] = await Promise.all([uploader.finish(), posterFrom(meta.element), speechTrack(file)])
    if (poster) {
      await fetch(`/api/recordings/${id}/sidecar?kind=poster`, { method: "PUT", headers: { "content-type": "image/jpeg" }, body: poster })
    }
    if (audio) {
      await fetch(`/api/recordings/${id}/sidecar?kind=audio`, { method: "PUT", headers: { "content-type": "audio/wav" }, body: audio })
    }
    const completed = await fetch(`/api/recordings/${id}/complete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ duration: meta.duration, partCount, cameraPartCount: 0, width: meta.width, height: meta.height }),
    })
    if (!completed.ok) throw new Error("The upload couldn't be finished")
    return id
  } finally {
    URL.revokeObjectURL(url)
  }
}
