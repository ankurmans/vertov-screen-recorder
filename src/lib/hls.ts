// Loom serves many videos only as an HLS stream (4 s MPEG-TS segments), with no MP4 to download.

export const isPlaylistUrl = (url: string) => /\.m3u8$/i.test(new URL(url).pathname)

// Loom's links are signed in the query string; relative playlist and segment names must carry it.
export function resolveRef(ref: string, base: string): string {
  const next = new URL(ref, base)
  if (!next.search) next.search = new URL(base).search
  return next.toString()
}

export interface HlsTrack {
  init: string | null
  segments: Array<string>
}

async function mediaTrack(url: string, getText: (url: string) => Promise<string>): Promise<HlsTrack> {
  const text = await getText(url)
  const map = /#EXT-X-MAP:.*URI="([^"]+)"/.exec(text)?.[1]
  const segments = text
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => resolveRef(line, url))
  if (segments.length === 0) throw new Error("Loom's stream has no segments")
  return { init: map ? resolveRef(map, url) : null, segments }
}

/**
 * The segments of a Loom stream: the highest-quality video variant, and the separate audio playlist when the
 * stream keeps audio apart from video (many Looms do), otherwise `audio` is null and the video carries the sound.
 */
export async function hlsSegments(
  playlistUrl: string,
  getText: (url: string) => Promise<string>,
): Promise<HlsTrack & { audio: HlsTrack | null }> {
  // Loom's raw link can point at the split master; the muxed one sits beside it.
  const url = playlistUrl.replace("playlist-split.m3u8", "playlist.m3u8")
  const text = await getText(url)
  if (text.includes("#EXTINF")) return { ...(await mediaTrack(url, async () => text)), audio: null }
  const lines = text.split(/\r?\n/)
  let best = { bandwidth: -1, uri: "" }
  lines.forEach((line, index) => {
    const match = /^#EXT-X-STREAM-INF:.*BANDWIDTH=(\d+)/.exec(line)
    const uri = lines.slice(index + 1).find((next) => next && !next.startsWith("#"))
    if (match && uri && Number(match[1]) > best.bandwidth) best = { bandwidth: Number(match[1]), uri }
  })
  if (!best.uri) throw new Error("Loom's stream has no video")
  const audioUri = lines.map((line) => (line.startsWith("#EXT-X-MEDIA:") && /TYPE=AUDIO/.test(line) ? /URI="([^"]+)"/.exec(line)?.[1] : undefined)).find(Boolean)
  const video = await mediaTrack(resolveRef(best.uri, url), getText)
  const audio = audioUri ? await mediaTrack(resolveRef(audioUri, url), getText) : null
  return { ...video, audio }
}
