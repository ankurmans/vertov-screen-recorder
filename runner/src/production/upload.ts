import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import { Readable } from "node:stream"
import { apiFetch } from "../api"
import type { ProducedVideo } from "../types"

/** Sends the finished MP4 through the normal agent upload path; the video is private to the workspace policy until reviewed. */
export async function uploadVideo(input: { produced: ProducedVideo; title: string }): Promise<{ id: string; url: string }> {
  const { size } = await stat(input.produced.path)
  const query = new URLSearchParams({ title: input.title.slice(0, 200), duration: input.produced.durationSeconds.toFixed(2) })
  const body = Readable.toWeb(createReadStream(input.produced.path)) as unknown as BodyInit
  const response = await apiFetch(`/api/v1/videos?${query}`, {
    method: "POST",
    headers: { "content-type": "video/mp4", "content-length": String(size) },
    body,
    // Node's fetch needs this to send a streamed body.
    ...({ duplex: "half" } as object),
  })
  if (!response.ok) throw new Error(`Upload failed (${response.status}): ${(await response.text().catch(() => "")).slice(0, 300)}`)
  const video = (await response.json()) as { id?: string; url?: string }
  if (!video.id || !video.url) throw new Error("The upload response had no video id")
  return { id: video.id, url: video.url }
}
