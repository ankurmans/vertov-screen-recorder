// MediaRecorder writes WebM without a Duration, so browsers report Infinity until they scan the whole file. This
// writes one into the Segment Info without changing the file's size: it takes the place of the WritingApp string
// (Chrome's is 9 bytes), as a 7-byte float32 Duration followed by a Void element covering whatever is left over.
// Keeping the size matters because the recording is uploaded in fixed-size parts as it's made.

const SEGMENT = 0x18538067
const INFO = 0x1549a966
const TIMECODE_SCALE = 0x2ad7b1
const DURATION = 0x4489
const WRITING_APP = 0x5741
const MUXING_APP = 0x4d80
const HEADER_BYTES = 4096

function vintLength(first: number): number {
  for (let length = 1; length <= 8; length++) if (first & (0x80 >> (length - 1))) return length
  return 0
}

function readId(bytes: Uint8Array, pos: number): { id: number; length: number } | null {
  const length = vintLength(bytes[pos] ?? 0)
  if (length === 0 || length > 4 || pos + length > bytes.length) return null
  let id = 0
  for (let i = 0; i < length; i++) id = id * 256 + bytes[pos + i]
  return { id, length }
}

function readSize(bytes: Uint8Array, pos: number): { size: number; length: number; unknown: boolean } | null {
  const length = vintLength(bytes[pos] ?? 0)
  if (length === 0 || pos + length > bytes.length) return null
  let size = bytes[pos] & (0xff >> length)
  let allOnes = size === 0xff >> length
  for (let i = 1; i < length; i++) {
    size = size * 256 + bytes[pos + i]
    if (bytes[pos + i] !== 0xff) allOnes = false
  }
  return { size, length, unknown: allOnes }
}

/** The header with a Duration written in, or null when it already has one or there's no room for it. */
export function patchWebmHeader(header: Uint8Array, seconds: number): Uint8Array | null {
  if (!(seconds > 0)) return null
  const ebml = readId(header, 0)
  const ebmlSize = ebml && readSize(header, ebml.length)
  if (!ebml || !ebmlSize || ebml.id !== 0x1a45dfa3) return null
  let pos = ebml.length + ebmlSize.length + ebmlSize.size
  const segment = readId(header, pos)
  const segmentSize = segment && readSize(header, pos + segment.length)
  if (!segment || !segmentSize || segment.id !== SEGMENT) return null
  pos += segment.length + segmentSize.length

  // Find Segment Info among the Segment's first children (SeekHead and Void may come before it).
  while (pos < header.length) {
    const child = readId(header, pos)
    const childSize = child && readSize(header, pos + child.length)
    if (!child || !childSize || childSize.unknown) return null
    const start = pos + child.length + childSize.length
    if (child.id !== INFO) {
      if (child.id !== 0x114d9b74 && child.id !== 0xec) return null
      pos = start + childSize.size
      continue
    }
    const end = start + childSize.size
    if (end > header.length) return null
    let scale = 1_000_000
    let slot: { at: number; length: number } | null = null
    for (let at = start; at < end; ) {
      const field = readId(header, at)
      const fieldSize = field && readSize(header, at + field.length)
      if (!field || !fieldSize) return null
      const total = field.length + fieldSize.length + fieldSize.size
      const value = at + field.length + fieldSize.length
      if (field.id === DURATION) return null
      if (field.id === TIMECODE_SCALE) {
        scale = 0
        for (let i = 0; i < fieldSize.size; i++) scale = scale * 256 + header[value + i]
      }
      // Prefer WritingApp; MuxingApp only if WritingApp can't take it.
      if ((field.id === WRITING_APP || (field.id === MUXING_APP && !slot)) && total >= 7 && total - 7 !== 1 && total - 7 <= 128)
        slot = { at, length: total }
      at += total
    }
    if (!slot || !(scale > 0)) return null
    const patched = header.slice()
    const view = new DataView(patched.buffer, patched.byteOffset, patched.byteLength)
    patched.set([0x44, 0x89, 0x84], slot.at)
    view.setFloat32(slot.at + 3, (seconds * 1e9) / scale)
    const left = slot.length - 7
    // A Void element is its ID (0xEC) and a one-byte size, so it needs at least two bytes.
    if (left >= 2) patched.set([0xec, 0x80 | (left - 2)], slot.at + 7)
    return patched
  }
  return null
}

/** The blob with its WebM Duration set, or the same blob when it isn't WebM or can't be patched. */
export async function withWebmDuration(blob: Blob, seconds: number): Promise<Blob> {
  const head = new Uint8Array(await blob.slice(0, HEADER_BYTES).arrayBuffer())
  const patched = patchWebmHeader(head, seconds)
  return patched ? new Blob([patched as Uint8Array<ArrayBuffer>, blob.slice(head.length)], { type: blob.type }) : blob
}
