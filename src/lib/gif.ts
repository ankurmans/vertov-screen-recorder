/**
 * A small animated-GIF encoder for the thumbnail: one fixed 252-colour palette with ordered
 * dithering, so there is no palette search and 12 frames encode in well under a second.
 */

const R = 6
const G = 7
const B = 6
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]

function palette(): Uint8Array {
  const out = new Uint8Array(256 * 3)
  let index = 0
  for (let r = 0; r < R; r++) {
    for (let g = 0; g < G; g++) {
      for (let b = 0; b < B; b++) {
        out[index * 3] = Math.round((r * 255) / (R - 1))
        out[index * 3 + 1] = Math.round((g * 255) / (G - 1))
        out[index * 3 + 2] = Math.round((b * 255) / (B - 1))
        index++
      }
    }
  }
  return out
}

function indexed(data: Uint8ClampedArray, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4
      const bias = (BAYER[(y & 3) * 4 + (x & 3)] / 16 - 0.5) * 51
      const level = (value: number, steps: number) => Math.max(0, Math.min(steps - 1, Math.round(((value + bias) / 255) * (steps - 1))))
      out[y * width + x] = level(data[at], R) * G * B + level(data[at + 1], G) * B + level(data[at + 2], B)
    }
  }
  return out
}

/** GIF's variable-width LZW. */
function lzw(pixels: Uint8Array): Array<number> {
  const minCode = 8
  const clear = 1 << minCode
  const end = clear + 1
  const bytes: Array<number> = []
  let bits = 0
  let bitCount = 0
  let codeSize = minCode + 1
  let next = end + 1
  let dictionary = new Map<number, number>()
  const emit = (code: number) => {
    bits |= code << bitCount
    bitCount += codeSize
    while (bitCount >= 8) {
      bytes.push(bits & 255)
      bits >>>= 8
      bitCount -= 8
    }
  }
  emit(clear)
  let prefix = pixels[0]
  for (let i = 1; i < pixels.length; i++) {
    const value = pixels[i]
    const key = (prefix << 8) | value
    const found = dictionary.get(key)
    if (found !== undefined) {
      prefix = found
      continue
    }
    emit(prefix)
    if (next < 4096) {
      dictionary.set(key, next++)
      if (next > 1 << codeSize && codeSize < 12) codeSize++
    } else {
      emit(clear)
      dictionary = new Map()
      codeSize = minCode + 1
      next = end + 1
    }
    prefix = value
  }
  emit(prefix)
  emit(end)
  if (bitCount > 0) bytes.push(bits & 255)
  return bytes
}

export function encodeGif(frames: Array<ImageData>, delayMs: number): Uint8Array<ArrayBuffer> {
  const { width, height } = frames[0]
  const out: Array<number> = []
  const word = (value: number) => out.push(value & 255, (value >> 8) & 255)
  out.push(...[..."GIF89a"].map((char) => char.charCodeAt(0)))
  word(width)
  word(height)
  out.push(0xf7, 0, 0) // global palette, 256 colours
  out.push(...palette())
  // Loop forever.
  out.push(0x21, 0xff, 0x0b, ...[..."NETSCAPE2.0"].map((char) => char.charCodeAt(0)), 3, 1, 0, 0, 0)
  for (const frame of frames) {
    out.push(0x21, 0xf9, 4, 0x04) // graphic control: restore nothing, no transparency
    word(Math.round(delayMs / 10))
    out.push(0, 0)
    out.push(0x2c)
    word(0)
    word(0)
    word(width)
    word(height)
    out.push(0)
    out.push(8)
    const data = lzw(indexed(frame.data, width, height))
    for (let i = 0; i < data.length; i += 255) {
      const chunk = data.slice(i, i + 255)
      out.push(chunk.length, ...chunk)
    }
    out.push(0)
  }
  out.push(0x3b)
  return Uint8Array.from(out)
}

/**
 * Samples `count` frames of the video between `from` and `to` seconds into a looping GIF,
 * using a throwaway player so the one on the page isn't disturbed.
 */
export async function makeAnimatedThumbnail(src: string, from: number, to: number, width = 480, count = 14): Promise<Blob> {
  const video = document.createElement("video")
  video.crossOrigin = "anonymous"
  video.muted = true
  video.preload = "auto"
  video.src = src
  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve()
    video.onerror = () => reject(new Error("The video wouldn't load"))
  })
  const scale = Math.min(1, width / (video.videoWidth || width))
  const w = Math.max(2, Math.round(video.videoWidth * scale))
  const h = Math.max(2, Math.round(video.videoHeight * scale))
  const canvas = document.createElement("canvas")
  canvas.width = w
  canvas.height = h
  const context = canvas.getContext("2d", { willReadFrequently: true })
  if (!context) throw new Error("No canvas")
  const end = Math.min(to, video.duration || to)
  const start = Math.min(from, Math.max(0, end - 0.5))
  const frames: Array<ImageData> = []
  for (let i = 0; i < count; i++) {
    const target = start + ((end - start) * i) / Math.max(1, count - 1)
    await new Promise<void>((resolve) => {
      video.onseeked = () => resolve()
      video.currentTime = Math.min(target, Math.max(0, (video.duration || target) - 0.05))
    })
    context.drawImage(video, 0, 0, w, h)
    frames.push(context.getImageData(0, 0, w, h))
  }
  video.removeAttribute("src")
  video.load()
  const delay = Math.max(120, Math.round(((end - start) * 1000) / count))
  return new Blob([encodeGif(frames, delay)], { type: "image/gif" })
}
