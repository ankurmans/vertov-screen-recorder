/**
 * Trims and cuts are playback metadata, but a viewer must not receive the footage they remove. For an edited video the
 * exporter makes a copy of each track with the removed stretches painted black and silenced (exporter/blank.py), on the
 * same timeline, and viewers are served that. These are the rules for which file they get.
 */
import { parseCuts } from "@/lib/cuts"
import type { Cut } from "@/lib/cuts"
import { masksCover, trackMasks } from "@/lib/viewer-masks"
import type { Masks } from "@/lib/viewer-masks"

export type Track = "screen" | "camera"

/** One copied track: where it is, and which source file it was made from. */
export type CopyFile = { key: string; from: string }

export type ViewerCopy = { token: string; spans: Array<Cut>; masks?: Masks; screen: CopyFile; camera?: CopyFile }

type Edits = { trimStart: number | null; trimEnd: number | null; cuts: string | null }
type Sources = Edits & {
  id: string; mediaType: string; r2Key: string; cameraKey: string | null
  style: string | null; overlays: string | null; width: number | null; height: number | null
}

/** The end of a trim to the end of the video. */
export const TO_END = Number.MAX_SAFE_INTEGER

/** Everything viewers must not get, in source seconds, sorted and merged. */
export function removedSpans(video: Edits): Array<Cut> {
  const spans: Array<Cut> = [
    ...(video.trimStart ? [[0, video.trimStart] as Cut] : []),
    ...parseCuts(video.cuts),
    ...(video.trimEnd != null ? [[video.trimEnd, TO_END] as Cut] : []),
  ]
  const merged: Array<Cut> = []
  for (const [start, end] of spans.sort((a, b) => a[0] - b[0])) {
    const last = merged.at(-1)
    if (last && start <= last[1]) last[1] = Math.max(last[1], end)
    else merged.push([start, end])
  }
  return merged
}

/** Whether any part of what the video holds is kept from viewers: removed stretches, or areas hidden in the picture. */
export const needsCopy = (video: Sources): boolean => removedSpans(video).length > 0 || Object.keys(trackMasks(video)).length > 0

/** The tracks a video has now, each named by what a copy of it depends on. */
export function trackSources(video: Sources): Partial<Record<Track, string>> {
  return {
    screen: video.r2Key,
    ...(video.cameraKey ? { camera: video.cameraKey } : {}),
  }
}

export function parseViewerCopy(stored: string | null | undefined): ViewerCopy | null {
  if (!stored) return null
  try {
    const copy = JSON.parse(stored) as ViewerCopy
    return typeof copy.token === "string" && Array.isArray(copy.spans) && typeof copy.screen?.key === "string" ? copy : null
  } catch {
    return null
  }
}

const SLACK = 0.001
const within = (spans: Array<Cut>, [start, end]: Cut) => spans.some(([a, b]) => start >= a - SLACK && end <= b + SLACK)

/** Whether the copy holds nothing viewers must not get and was made from the tracks the video has now. It may hide more. */
export function copyCovers(copy: ViewerCopy, video: Sources): boolean {
  const sources = trackSources(video)
  return (
    removedSpans(video).every((span) => within(copy.spans, span)) &&
    masksCover(copy.masks, trackMasks(video)) &&
    (Object.keys(sources) as Array<Track>).every((track) => copy[track]?.from === sources[track])
  )
}

/** Whether the copy is exactly what the current edits call for, so there is nothing to render. */
export const copyIsCurrent = (copy: ViewerCopy, video: Sources) =>
  copyCovers(copy, video) && copy.spans.every((span) => within(removedSpans(video), span)) && JSON.stringify(copy.masks ?? {}) === JSON.stringify(trackMasks(video))

/**
 * What viewers get: the original (nothing kept from them), the copy, or nothing until a copy that keeps it from them exists.
 * Images have no timeline and always get the original.
 */
export function viewerChoice(video: Sources & { viewerCopy: string | null }): { kind: "original" } | { kind: "copy"; copy: ViewerCopy } | { kind: "held" } {
  if (video.mediaType !== "video" || !needsCopy(video)) return { kind: "original" }
  const copy = parseViewerCopy(video.viewerCopy)
  return copy && copyCovers(copy, video) ? { kind: "copy", copy } : { kind: "held" }
}

/** A stretch of kept footage to make the animated thumbnail from: the first of at least two seconds, else the longest. */
export function keptWindow(video: Edits, duration: number, length = 6): Cut {
  const kept: Array<Cut> = []
  let at = 0
  for (const [start, end] of removedSpans(video)) {
    if (start > at) kept.push([at, Math.min(start, duration)])
    at = Math.max(at, end)
  }
  if (at < duration) kept.push([at, duration])
  const best = kept.find(([a, b]) => b - a >= 2) ?? kept.sort((a, b) => b[1] - b[0] - (a[1] - a[0]))[0] ?? [0, duration]
  const from = Math.min(best[0] + 0.3, best[1])
  return [from, Math.min(from + length, best[1])]
}

/** What a page knows about the file viewers get. */
export type Playback = { enabled: boolean; state: "original" | "copy" | "held"; token: string | null; failed: boolean }

/**
 * Where a player loads a track from: the original for the people who edit the video, and a URL naming the copy for
 * viewers, so nothing cached from before an edit is reused.
 */
export function trackUrl(base: string, playback: Playback | null | undefined, editor: boolean, version?: string | null): string {
  const query = new URLSearchParams()
  const named = !editor && playback?.token ? playback.token : version
  if (named) query.set("v", named)
  if (editor) query.set("original", "1")
  return query.size ? `${base}?${query}` : base
}

const COPY_FPS = 30

/**
 * Where playback of a copy comes back after a removed stretch ending at `end`: just inside the first frame the exporter
 * leaves unpainted (first_clean_frame in exporter/blank.py), so the jump never shows a black frame.
 */
export const copyResume = (end: number): number => Math.ceil(end * COPY_FPS + 1 - 1e-6) / COPY_FPS + 0.001
