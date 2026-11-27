import { backgroundTrack, fitTrack } from "./lib/effects.js"
import { enforcedCap, limitState, reportedDuration } from "./lib/recording-limit.js"
import { LiveUploader, PartUploader, pickAudioMimeType, pickCameraMimeType, pickVideoMimeType } from "./lib/part-uploader.js"

// Offscreen documents only get chrome.runtime, so the server and key arrive with each start.
let connection = null
const api = (path, init = {}) => {
  const headers = new Headers(init.headers)
  headers.set("authorization", `Bearer ${connection.token}`)
  return fetch(`${connection.server}${path}`, { ...init, headers })
}
const errorFrom = async (response, fallback) => (await response.json().catch(() => null))?.error || fallback

/** Runs one setup step, naming it in the error so a failure says what broke. */
async function step(name, run) {
  try {
    return await run()
  } catch (error) {
    throw new Error(`${name}: ${error?.message || error}`)
  }
}

/**
 * The recorder. Runs in an offscreen document so recording survives the popup closing.
 * Mirrors the web recorder: the screen (or camera) and mixed audio stream into the
 * recording's multipart upload as you record, the camera is its own track so the layout can
 * change afterwards, and an audio-only copy goes up at the end for the transcript.
 */

let session = null

const send = (message) => chrome.runtime.sendMessage({ target: "background", ...message }).catch(() => {})

chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (message.target !== "offscreen") return
  const handle = {
    start: () => start(message.options),
    pause: () => togglePause(true),
    resume: () => togglePause(false),
    stop: () => stop(),
    discard: () => discard(),
    event: () => recordEvent(message.event),
    narrate: () => narrate(message.audio),
    elapsed: () => ({ seconds: elapsedSeconds() }),
    hold: () => hold(message.streamId),
    release: () => releaseHeld(),
  }[message.type]
  if (!handle) return
  Promise.resolve(handle())
    .then((result) => reply({ ok: true, ...result }))
    .catch((error) => reply({ ok: false, error: error?.message || String(error) }))
  return true
})

function elapsedSeconds() {
  if (!session) return 0
  const pausedNow = session.pausedAt ? performance.now() - session.pausedAt : 0
  return (performance.now() - session.startedAt - session.pausedTotal - pausedNow) / 1000
}

/** What to capture at, and the fixed output shape when the recording is reshaped (null keeps the source's own). */
function sizing(options) {
  const clamp = (value, fallback) => Math.min(3840, Math.max(320, Math.round(Number(value)) || fallback))
  switch (options.size) {
    case "720":
      return { cap: [1280, 720], out: null }
    case "4k":
      return { cap: [3840, 2160], out: null }
    case "square":
      return { cap: [2560, 1440], out: [1080, 1080] }
    case "vertical":
      return { cap: [2560, 1440], out: [1080, 1920] }
    case "custom":
      return { cap: [3840, 2160], out: [clamp(options.customWidth, 1280), clamp(options.customHeight, 720)] }
    default:
      return { cap: [1920, 1080], out: null }
  }
}

// Agent mode takes the tab's stream when the run starts, while the click that opened it still counts as invoking the
// extension on that tab, and keeps it until the recording: the agent's page loads in between would end that grant.
let held = null

async function hold(streamId) {
  releaseHeld()
  held = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId } },
    video: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId } },
  })
  // Tab capture mutes the tab; keep it audible while the agent works.
  const context = new AudioContext()
  context.createMediaStreamSource(held).connect(context.destination)
  held.context = context
  return {}
}

function releaseHeld() {
  if (!held) return {}
  for (const track of held.getTracks()) track.stop()
  void held.context?.close()
  held = null
  return {}
}

async function displayStream(options) {
  const { cap } = sizing(options)
  if (options.mode === "tab" && options.useHeld && held?.getVideoTracks()[0]?.readyState === "live") {
    const stream = held
    void stream.context?.close()
    held = null
    return stream
  }
  if (options.mode === "tab") {
    if (!options.streamId) throw new Error("no tab stream")
    const sized = options.size && options.size !== "auto" ? { maxWidth: cap[0], maxHeight: cap[1] } : {}
    return navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: options.streamId } },
      video: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: options.streamId, ...sized } },
    })
  }
  if (options.mode === "screen") {
    // Chrome's own picker: a screen, a window or a tab, with system or tab audio where offered.
    return navigator.mediaDevices.getDisplayMedia({
      video: { width: { max: cap[0] }, height: { max: cap[1] }, frameRate: { max: 30 } },
      audio: true,
      selfBrowserSurface: "exclude",
      systemAudio: "include",
      monitorTypeSurfaces: "include",
    })
  }
  return null
}

async function start(options) {
  if (session) throw new Error("Already recording.")
  connection = options.connection
  const streams = []
  try {
    const display = await step(options.mode === "tab" ? "Tab capture" : "Screen capture", () => displayStream(options))
    if (display) streams.push(display)
    const camera = options.camera || options.mode === "camera"
      ? await step("Camera", () => navigator.mediaDevices.getUserMedia({
          video: { deviceId: options.cameraId ? { exact: options.cameraId } : undefined, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
        }))
      : null
    if (camera) streams.push(camera)
    // Not allowed yet: record without the voice rather than wait on Chrome's prompt, which a browsing agent can't answer.
    let noMic = false
    const mic = options.mic
      ? await step("Microphone", () => navigator.mediaDevices.getUserMedia({
          audio: { deviceId: options.micId ? { exact: options.micId } : undefined, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        }).catch((error) => {
          if (error?.name !== "NotAllowedError") throw error
          noMic = true
          return null
        }))
      : null
    if (mic) streams.push(mic)

    let cameraTrack = camera?.getVideoTracks()[0] ?? null
    if (cameraTrack && options.background && options.background !== "none") {
      cameraTrack = await step("Background effect", () => backgroundTrack(cameraTrack, options.background, options.bgImage))
      if (cameraTrack !== camera.getVideoTracks()[0]) streams.push(new MediaStream([cameraTrack]))
    }
    // The source track is what Chrome's "Stop sharing" ends; the recorded one may be a reshaped copy of it.
    const sourceTrack = display ? display.getVideoTracks()[0] : cameraTrack
    if (!sourceTrack) throw new Error("Nothing to record.")
    const { out } = sizing(options)
    let mainTrack = sourceTrack
    if (out) {
      mainTrack = fitTrack(sourceTrack, out[0], out[1])
      streams.push(new MediaStream([mainTrack]))
    }
    const separateCamera = display && cameraTrack ? cameraTrack : null

    // Tab capture mutes the tab for you; play it back so you still hear it.
    const audioContext = new AudioContext()
    // A context made without a click can start suspended, and a suspended one records silence.
    await audioContext.resume().catch(() => {})
    if (options.mode === "tab" && display?.getAudioTracks().length) {
      audioContext.createMediaStreamSource(display).connect(audioContext.destination)
    }
    const audioSources = [...(mic ? [mic] : []), ...(display?.getAudioTracks().length ? [display] : [])]
    let audioTrack = null
    // Agent recordings: the narration clips play into the mix (and the speakers) through this node.
    const narration = options.narration ? audioContext.createGain() : null
    if (audioSources.length || narration) {
      const destination = audioContext.createMediaStreamDestination()
      for (const source of audioSources) audioContext.createMediaStreamSource(source).connect(destination)
      if (narration) {
        narration.connect(destination)
        narration.connect(audioContext.destination)
        await audioContext.resume().catch(() => {})
      }
      audioTrack = destination.stream.getAudioTracks()[0]
    }

    const mimeType = pickVideoMimeType()
    const cameraMimeType = separateCamera ? pickCameraMimeType() : null
    const sourceSettings = mainTrack.getSettings()
    const settings = out ? { width: out[0], height: out[1] } : sourceSettings
    // Bits per second scale with the pixels recorded: about 1080p at 4.5 Mbps, 4K at 18 Mbps.
    const pixels = (settings.width || 1920) * (settings.height || 1080)
    const videoBitrate = Math.round(Math.min(24_000_000, Math.max(1_500_000, pixels * 30 * 0.07)))
    const created = await api("/api/recordings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mimeType,
        cameraMimeType,
        surface: options.mode === "tab" ? "browser" : options.mode === "camera" ? "camera" : "monitor",
        width: settings.width ?? null,
        height: settings.height ?? null,
      }),
    })
    if (!created.ok) throw new Error(await errorFrom(created, "Couldn't start the recording."))
    const { id, url, capSeconds = null, enforce = false } = await created.json()
    const cap = enforcedCap(capSeconds, enforce)

    const uploader = new PartUploader(api, id, "screen")
    const recorder = new MediaRecorder(new MediaStream([mainTrack, ...(audioTrack ? [audioTrack] : [])]), {
      mimeType,
      videoBitsPerSecond: display ? videoBitrate : Math.min(videoBitrate, 2_500_000),
      audioBitsPerSecond: 128_000,
    })
    // Live viewing sends the same chunks again; without audio the codec string must not name any.
    const liveMime = options.live ? (audioTrack ? recorder.mimeType : recorder.mimeType.replace(/,\s*(mp4a\.[0-9.]+|opus)/i, "")) : null
    const live = liveMime ? new LiveUploader(api, id, liveMime) : null
    recorder.ondataavailable = (event) => {
      uploader.push(event.data)
      live?.push(event.data)
    }

    const cameraUploader = separateCamera ? new PartUploader(api, id, "camera") : null
    const cameraRecorder = separateCamera
      ? new MediaRecorder(new MediaStream([separateCamera]), { mimeType: cameraMimeType, videoBitsPerSecond: 1_200_000 })
      : null
    if (cameraRecorder) cameraRecorder.ondataavailable = (event) => cameraUploader.push(event.data)

    const audioMime = audioTrack ? pickAudioMimeType() : null
    const audioChunks = []
    const audioRecorder = audioTrack && audioMime ? new MediaRecorder(new MediaStream([audioTrack]), { mimeType: audioMime, audioBitsPerSecond: 32_000 }) : null
    if (audioRecorder) audioRecorder.ondataavailable = (event) => audioChunks.push(event.data)

    // Same tick, so the screen and camera tracks line up on playback.
    recorder.start(1000)
    cameraRecorder?.start(1000)
    audioRecorder?.start(1000)
    session = {
      id,
      url,
      cap,
      recorder,
      cameraRecorder,
      audioRecorder,
      audioChunks,
      uploader,
      cameraUploader,
      streams,
      audioContext,
      narration,
      events: [],
      pointer: [],
      startedAt: performance.now(),
      pausedAt: null,
      pausedTotal: 0,
      width: settings.width ?? null,
      height: settings.height ?? null,
      ticker: setInterval(() => {
        if (!session) return
        const elapsed = elapsedSeconds()
        const limit = limitState(elapsed, Math.max(session.uploader.partCount, session.cameraUploader?.partCount ?? 0), cap)
        send({ type: "tick", elapsed, paused: Boolean(session.pausedAt), level: limit.level, remaining: limit.remaining, capped: cap != null })
        // Finish just before the server's six-hour limit, or at a Free plan's length rule, instead of letting the upload be refused.
        if (limit.stop && session.id === id) void stop(limit.by === "limit").then((result) => send({ type: "finished", ...result }), (error) => send({ type: "failed", error: error.message }))
      }, 1000),
    }
    // The recorder's data events are not throttled the way timers can be, so they check the limit too.
    recorder.addEventListener("dataavailable", () => {
      if (session?.id !== id) return
      const limit = limitState(elapsedSeconds(), Math.max(session.uploader.partCount, session.cameraUploader?.partCount ?? 0), cap)
      if (limit.stop) void stop(limit.by === "limit").then((result) => send({ type: "finished", ...result }), (error) => send({ type: "failed", error: error.message }))
    })
    // Chrome's own "Stop sharing" button ends the track: treat it as stop.
    sourceTrack.addEventListener("ended", () => {
      if (session?.id === id) void stop().then((result) => send({ type: "finished", ...result }), (error) => send({ type: "failed", error: error.message }))
    })
    setTimeout(() => void capturePoster(id, mainTrack), 3000)
    setTimeout(() => void capturePoster(id, mainTrack), 20000)
    return { id, url, capSeconds, enforce, ...(noMic ? { noMic } : {}) }
  } catch (error) {
    for (const stream of streams) for (const track of stream.getTracks()) track.stop()
    throw error
  }
}

/** Starts one narration clip (base64 MP3) in an agent recording and says how long it runs. */
async function narrate(audio) {
  if (!session?.narration) throw new Error("Not recording with narration.")
  const bytes = Uint8Array.from(atob(audio), (c) => c.charCodeAt(0))
  const buffer = await session.audioContext.decodeAudioData(bytes.buffer)
  const source = session.audioContext.createBufferSource()
  source.buffer = buffer
  source.connect(session.narration)
  source.start()
  return { seconds: buffer.duration }
}

function togglePause(pause) {
  if (!session) return {}
  const recorders = [session.recorder, session.cameraRecorder, session.audioRecorder].filter(Boolean)
  if (pause && session.recorder.state === "recording") {
    for (const recorder of recorders) recorder.pause()
    session.pausedAt = performance.now()
    // A narration clip waits with the picture instead of talking on unrecorded.
    if (session.narration) void session.audioContext.suspend().catch(() => {})
  } else if (!pause && session.recorder.state === "paused") {
    if (session.narration) void session.audioContext.resume().catch(() => {})
    for (const recorder of recorders) recorder.resume()
    session.pausedTotal += performance.now() - session.pausedAt
    session.pausedAt = null
  }
  return { paused: Boolean(session.pausedAt) }
}

function recordEvent(event) {
  if (!session || session.pausedAt || !event) return {}
  // The mouse path is its own, larger sidecar; it never crowds out the click and page events.
  if (event.type === "pointer") {
    if (event.coordinateSpace === "recorded-tab" && session.pointer.length < 40000) session.pointer.push({ t: Math.round(elapsedSeconds() * 100) / 100, x: event.x, y: event.y, vw: event.viewportWidth, vh: event.viewportHeight })
    return {}
  }
  // Tab switches and reloads repeat the page you're already on.
  const lastPage = session.events.findLast((item) => item.type === "page")
  if (event.type === "page" && lastPage?.url === event.url) return {}
  session.events.push({ ...event, t: Math.round(elapsedSeconds() * 10) / 10 })
  return {}
}

async function stopRecorders(current) {
  await Promise.all(
    [current.recorder, current.cameraRecorder, current.audioRecorder]
      .filter((recorder) => recorder && recorder.state !== "inactive")
      .map((recorder) => new Promise((resolve) => {
        recorder.addEventListener("stop", resolve, { once: true })
        recorder.stop()
      })),
  )
}

function release(current) {
  clearInterval(current.ticker)
  for (const stream of current.streams) for (const track of stream.getTracks()) track.stop()
  void current.audioContext.close()
}

async function stop(atLimit = false) {
  const current = session
  if (!current) throw new Error("Not recording.")
  session = null
  const duration = reportedDuration((performance.now() - current.startedAt - current.pausedTotal - (current.pausedAt ? performance.now() - current.pausedAt : 0)) / 1000)
  copyToClipboard(current.url)
  await stopRecorders(current)
  release(current)
  const [partCount, cameraPartCount] = await Promise.all([
    current.uploader.finish(),
    current.cameraUploader ? current.cameraUploader.finish().catch(() => 0) : Promise.resolve(0),
  ])
  if (current.audioChunks.length) {
    const audio = new Blob(current.audioChunks, { type: current.audioChunks[0].type })
    await api(`/api/recordings/${current.id}/sidecar?kind=audio`, { method: "PUT", headers: { "content-type": audio.type.split(";")[0] }, body: audio }).catch(() => {})
  }
  if (current.events.length) {
    await api(`/api/recordings/${current.id}/sidecar?kind=events`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(current.events.slice(0, 5000)),
    }).catch(() => {})
  }
  if (current.pointer.length > 1) {
    const clicks = current.events.filter((e) => e.type === "click" && e.coordinateSpace === "recorded-tab").map((e) => [e.t, e.x, e.y])
    await api(`/api/recordings/${current.id}/sidecar?kind=cursor`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ v: 1, points: current.pointer.map((p) => [p.t, p.x, p.y]), clicks, vw: current.pointer.at(-1).vw, vh: current.pointer.at(-1).vh }),
    }).catch(() => {})
  }
  const done = await api(`/api/recordings/${current.id}/complete`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ duration, partCount, cameraPartCount, width: current.width, height: current.height }),
  })
  if (!done.ok) throw new Error(await errorFrom(done, "The upload couldn't be finished."))
  const completed = await done.json().catch(() => null)
  return { id: current.id, url: current.url, ...(atLimit ? { limit: true } : {}), ...(completed?.long ? { long: true, capped: cap != null } : {}) }
}

async function discard() {
  const current = session
  if (!current) return {}
  session = null
  await stopRecorders(current)
  release(current)
  await api(`/api/recordings/${current.id}`, { method: "DELETE" }).catch(() => {})
  return {}
}

function copyToClipboard(text) {
  const area = document.getElementById("clipboard")
  area.value = text
  area.select()
  document.execCommand("copy")
}

async function capturePoster(id, track) {
  if (track.readyState !== "live") return
  const video = document.createElement("video")
  video.muted = true
  video.srcObject = new MediaStream([track])
  try {
    await video.play()
    const scale = Math.min(1, 1280 / (video.videoWidth || 1280))
    const canvas = document.createElement("canvas")
    canvas.width = Math.round(video.videoWidth * scale)
    canvas.height = Math.round(video.videoHeight * scale)
    canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85))
    if (blob) await api(`/api/recordings/${id}/sidecar?kind=poster`, { method: "PUT", headers: { "content-type": "image/jpeg" }, body: blob })
  } catch {
    // A missing poster only means a plainer link preview.
  } finally {
    video.srcObject = null
  }
}
