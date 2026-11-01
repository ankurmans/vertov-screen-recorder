// Video track effects that run in extension pages: resizing a screen capture to a chosen shape, and
// replacing the background behind the camera. Both read frames from a track, draw them on a canvas and
// hand back a new track, so MediaRecorder and the on-page bubble treat the result like any camera.

/** Preset backgrounds besides "none", "blur" and "image". */
export const BACKGROUNDS = [
  { value: "none", label: "No effect" },
  { value: "blur", label: "Blur" },
  { value: "night", label: "Night", colors: ["#0f172a", "#312e81"] },
  { value: "sunrise", label: "Sunrise", colors: ["#fda4af", "#fdba74"] },
  { value: "studio", label: "Studio", colors: ["#e5e5e5", "#a3a3a3"] },
  { value: "forest", label: "Forest", colors: ["#14532d", "#4d7c0f"] },
  { value: "image", label: "My image" },
]

let segmenterPromise = null

/** The person segmenter (MediaPipe, bundled with the extension); the GPU path first, then the CPU. */
function loadSegmenter() {
  segmenterPromise ??= (async () => {
    const { FilesetResolver, ImageSegmenter } = await import("../vendor/mediapipe/vision_bundle.mjs")
    const base = chrome.runtime.getURL("vendor/mediapipe")
    const fileset = await FilesetResolver.forVisionTasks(base)
    const make = (delegate) =>
      ImageSegmenter.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: `${base}/selfie_segmenter.tflite`, delegate },
        runningMode: "VIDEO",
        outputConfidenceMasks: true,
        outputCategoryMask: false,
      })
    return make("GPU").catch(() => make("CPU"))
  })()
  segmenterPromise.catch(() => {
    segmenterPromise = null
  })
  return segmenterPromise
}

/** Wraps `draw(frame)` (returns a canvas) as a new live track. Stopping the source ends it. */
function transformTrack(track, draw) {
  const processor = new MediaStreamTrackProcessor({ track })
  const generator = new MediaStreamTrackGenerator({ kind: "video" })
  processor.readable
    .pipeThrough(
      new TransformStream({
        async transform(frame, controller) {
          try {
            const canvas = await draw(frame)
            controller.enqueue(new VideoFrame(canvas, { timestamp: frame.timestamp }))
          } finally {
            frame.close()
          }
        },
      }),
    )
    .pipeTo(generator.writable)
    .catch(() => {})
  return generator
}

const even = (value) => Math.max(2, Math.round(value / 2) * 2)

/** Fits the frame inside width×height on black, keeping its shape. */
export function fitTrack(track, width, height) {
  const w = even(width)
  const h = even(height)
  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext("2d")
  return transformTrack(track, (frame) => {
    const scale = Math.min(w / frame.displayWidth, h / frame.displayHeight)
    const dw = frame.displayWidth * scale
    const dh = frame.displayHeight * scale
    ctx.fillStyle = "#000"
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(frame, (w - dw) / 2, (h - dh) / 2, dw, dh)
    return canvas
  })
}

async function loadImage(dataUrl) {
  const blob = await (await fetch(dataUrl)).blob()
  return createImageBitmap(blob)
}

/** Covers the canvas with the image, cropping the overflow. */
function drawCover(ctx, image, w, h) {
  const scale = Math.max(w / image.width, h / image.height)
  const dw = image.width * scale
  const dh = image.height * scale
  ctx.drawImage(image, (w - dw) / 2, (h - dh) / 2, dw, dh)
}

/**
 * Puts the person in front of a new background: a blur of the room, a gradient or your own image.
 * Resolves to the original track when segmentation can't start, so recording still works.
 */
export async function backgroundTrack(track, background, imageDataUrl) {
  if (!background || background === "none") return track
  let segmenter
  try {
    segmenter = await loadSegmenter()
  } catch (error) {
    console.warn("Background effect unavailable:", error)
    return track
  }
  const preset = BACKGROUNDS.find((item) => item.value === background)
  const image = background === "image" && imageDataUrl ? await loadImage(imageDataUrl).catch(() => null) : null
  if (background === "image" && !image) return track

  let out = null
  let person = null
  let mask = null
  let lastStamp = 0
  const maskSize = 256
  const maskImage = new ImageData(maskSize, maskSize)
  let maskCtx = null
  let personCtx = null
  let outCtx = null

  return transformTrack(track, (frame) => {
    const w = frame.displayWidth
    const h = frame.displayHeight
    if (!out || out.width !== w || out.height !== h) {
      out = new OffscreenCanvas(w, h)
      person = new OffscreenCanvas(w, h)
      mask = new OffscreenCanvas(maskSize, maskSize)
      outCtx = out.getContext("2d")
      personCtx = person.getContext("2d")
      maskCtx = mask.getContext("2d")
    }
    lastStamp = Math.max(lastStamp + 1, Math.round(performance.now()))
    const result = segmenter.segmentForVideo(frame, lastStamp)
    const confidence = result.confidenceMasks?.[0]
    if (!confidence) {
      outCtx.drawImage(frame, 0, 0, w, h)
      result.close()
      return out
    }
    const values = confidence.getAsFloat32Array()
    const data = maskImage.data
    for (let i = 0; i < values.length && i < maskSize * maskSize; i++) {
      // Steepen the edge a little so hair and shoulders stay crisp but not jagged.
      const v = Math.min(1, Math.max(0, (values[i] - 0.35) * 2.2))
      data[i * 4 + 3] = v * 255
    }
    maskCtx.putImageData(maskImage, 0, 0)
    result.close()

    // Background first.
    outCtx.globalCompositeOperation = "source-over"
    outCtx.filter = "none"
    if (background === "blur") {
      outCtx.filter = `blur(${Math.max(8, Math.round(w / 60))}px)`
      outCtx.drawImage(frame, 0, 0, w, h)
      outCtx.filter = "none"
    } else if (image) {
      drawCover(outCtx, image, w, h)
    } else if (preset?.colors) {
      const gradient = outCtx.createLinearGradient(0, 0, w, h)
      gradient.addColorStop(0, preset.colors[0])
      gradient.addColorStop(1, preset.colors[1])
      outCtx.fillStyle = gradient
      outCtx.fillRect(0, 0, w, h)
    } else {
      outCtx.drawImage(frame, 0, 0, w, h)
    }

    // Then the person, cut out by the mask.
    personCtx.globalCompositeOperation = "source-over"
    personCtx.clearRect(0, 0, w, h)
    personCtx.drawImage(frame, 0, 0, w, h)
    personCtx.globalCompositeOperation = "destination-in"
    personCtx.filter = "blur(1.5px)"
    personCtx.drawImage(mask, 0, 0, w, h)
    personCtx.filter = "none"
    outCtx.drawImage(person, 0, 0, w, h)
    return out
  })
}
