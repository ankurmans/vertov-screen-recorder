import { createFileRoute, redirect } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import { getRequest } from "@tanstack/react-start/server"
import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import type { BackupTake } from "@/lib/local-backup"
import { getSessionUser } from "@/lib/auth.server"
import { APP_NAME } from "@/lib/brand"
import { formatDuration } from "@/lib/format"
import { backupChunk, readTake, removeBackup, startBackup, unfinishedTakes } from "@/lib/local-backup"
import {
  PartUploader,
  pickAudioMimeType,
  pickCameraMimeType,
  pickVideoMimeType,
} from "@/lib/part-uploader"

const loadRecorder = createServerFn({ method: "GET" }).handler(async () => {
  const user = await getSessionUser(getRequest())
  return { signedIn: Boolean(user) }
})

const EMBED_ORIGINS = ["https://donezoinbox.com", "https://www.donezoinbox.com"]

/** Tells the app that opened this window which video was just recorded, then closes. False when nobody is listening. */
function handBack(id: string): boolean {
  if (!window.opener) return false
  const origin = location.origin
  const message = { type: "vertov:recorded", id, url: `${origin}/${id}`, title: `${APP_NAME} recording`, gif: `${origin}/api/gif/${id}`, poster: `${origin}/api/poster/${id}` }
  for (const target of EMBED_ORIGINS) window.opener.postMessage(message, target)
  window.close()
  return true
}

export const Route = createFileRoute("/record")({
  // ?space=<id> records straight into a shared space.
  validateSearch: (search: Record<string, unknown>) => ({
    space: typeof search.space === "string" ? search.space : undefined,
    // Set when someone is recording for a "Request a video" link.
    request: typeof search.request === "string" ? search.request : undefined,
    // Set when another app (like Donezo Inbox) opened this window to get a finished recording back.
    embed: search.embed === "1" || search.embed === 1 ? true : undefined,
  }),
  loader: async () => {
    const { signedIn } = await loadRecorder()
    if (!signedIn) throw redirect({ to: "/signin", search: { redirect: "/record" } })
  },
  head: () => ({ meta: [{ title: `Record — ${APP_NAME}` }] }),
  component: RecordPage,
})

type Phase = "setup" | "ready" | "countdown" | "recording" | "finishing" | "error"
type Mode = "screen" | "camera"
type Surface = "monitor" | "window" | "browser"

interface Prefs {
  mode: Mode
  cameraOn: boolean
  micOn: boolean
  cameraId: string
  micId: string
  notes: string
}

const DEFAULT_PREFS: Prefs = { mode: "screen", cameraOn: true, micOn: true, cameraId: "", micId: "", notes: "" }
const PREFS_KEY = "reelay_recorder"

function loadPrefs(): Prefs {
  try {
    return { ...DEFAULT_PREFS, ...(JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Partial<Prefs>) }
  } catch {
    return DEFAULT_PREFS
  }
}

interface Session {
  id: string
  url: string
  recorder: MediaRecorder
  cameraRecorder: MediaRecorder | null
  audioRecorder: MediaRecorder | null
  audioChunks: Array<Blob>
  uploader: PartUploader
  cameraUploader: PartUploader | null
  streams: Array<MediaStream>
  audioContext: AudioContext | null
  analyser: AnalyserNode | null
  startedAt: number
  pausedAt: number | null
  pausedTotal: number
  width: number | null
  height: number | null
}

declare global {
  interface Window {
    documentPictureInPicture?: {
      requestWindow: (options: { width: number; height: number }) => Promise<Window>
    }
  }
}

function stopStreams(streams: Array<MediaStream>) {
  for (const stream of streams) for (const track of stream.getTracks()) track.stop()
}

/** 0–1 loudness from an analyser, for the mic meter. */
function readLevel(analyser: AnalyserNode, buffer: Uint8Array<ArrayBuffer>): number {
  analyser.getByteTimeDomainData(buffer)
  let peak = 0
  for (const value of buffer) peak = Math.max(peak, Math.abs(value - 128))
  return Math.min(1, peak / 64)
}

function RecordPage() {
  const { space: spaceId, request: requestId, embed } = Route.useSearch()
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS)
  const [phase, setPhase] = useState<Phase>("setup")
  const [cameras, setCameras] = useState<Array<MediaDeviceInfo>>([])
  const [mics, setMics] = useState<Array<MediaDeviceInfo>>([])
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null)
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null)
  const [surface, setSurface] = useState<Surface | null>(null)
  const [countdown, setCountdown] = useState(3)
  const [elapsed, setElapsed] = useState(0)
  const [paused, setPaused] = useState(false)
  const [level, setLevel] = useState(0)
  const [pending, setPending] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [pipWindow, setPipWindow] = useState<Window | null>(null)
  const [savedTakes, setSavedTakes] = useState<Array<BackupTake>>([])
  const [recovering, setRecovering] = useState<string | null>(null)
  const [failedId, setFailedId] = useState<string | null>(null)
  const session = useRef<Session | null>(null)
  const finishing = useRef(false)
  const skipCountdown = useRef<(() => void) | null>(null)
  const pipRef = useRef<Window | null>(null)
  const screenRef = useRef<MediaStream | null>(null)
  pipRef.current = pipWindow
  screenRef.current = screenStream

  const { mode, cameraOn, micOn, cameraId, micId, notes } = prefs
  const update = (patch: Partial<Prefs>) =>
    setPrefs((current) => {
      const next = { ...current, ...patch }
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next))
      } catch {
        // Private mode: settings just won't stick.
      }
      return next
    })

  useEffect(() => setPrefs(loadPrefs()), [])
  useEffect(() => void unfinishedTakes().then(setSavedTakes), [])

  // Device lists only carry labels once permission is granted, so ask up front.
  const refreshDevices = useCallback(async () => {
    const devices = await navigator.mediaDevices.enumerateDevices()
    setCameras(devices.filter((device) => device.kind === "videoinput"))
    setMics(devices.filter((device) => device.kind === "audioinput"))
  }, [])

  useEffect(() => {
    void navigator.mediaDevices
      .getUserMedia({ audio: true, video: true })
      .then((stream) => stopStreams([stream]))
      .catch(() => {})
      .finally(() => void refreshDevices())
    navigator.mediaDevices.addEventListener("devicechange", refreshDevices)
    return () => navigator.mediaDevices.removeEventListener("devicechange", refreshDevices)
  }, [refreshDevices])

  // Live camera preview; also the bubble and the camera track while recording.
  const wantCamera = cameraOn || mode === "camera"
  const done = phase === "finishing"
  useEffect(() => {
    if (!wantCamera || done) return
    let cancelled = false
    let stream: MediaStream | null = null
    void navigator.mediaDevices
      .getUserMedia({
        video: {
          deviceId: cameraId ? { exact: cameraId } : undefined,
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
        },
      })
      .then((next) => {
        if (cancelled) return stopStreams([next])
        stream = next
        setCameraStream(next)
        setError(null)
      })
      .catch(() => setError("Couldn't open the camera. Check the browser's camera permission, or turn the camera off."))
    return () => {
      cancelled = true
      if (stream) stopStreams([stream])
      setCameraStream(null)
    }
  }, [wantCamera, cameraId, done])

  // Mic meter before recording, so you know you're being heard.
  useEffect(() => {
    if (!micOn || (phase !== "setup" && phase !== "ready")) return
    let stream: MediaStream | null = null
    let context: AudioContext | null = null
    let frame = 0
    let cancelled = false
    void navigator.mediaDevices
      .getUserMedia({ audio: { deviceId: micId ? { exact: micId } : undefined } })
      .then((next) => {
        if (cancelled) return stopStreams([next])
        stream = next
        context = new AudioContext()
        const analyser = context.createAnalyser()
        analyser.fftSize = 512
        context.createMediaStreamSource(next).connect(analyser)
        const buffer = new Uint8Array(analyser.fftSize)
        const tick = () => {
          setLevel(readLevel(analyser, buffer))
          frame = requestAnimationFrame(tick)
        }
        tick()
      })
      .catch(() => setLevel(0))
    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
      if (stream) stopStreams([stream])
      void context?.close()
      setLevel(0)
    }
  }, [micOn, micId, phase])

  // Timer, mic level and upload health while recording. Ticks from the floating
  // window when there is one: a hidden tab's timers get throttled hard.
  useEffect(() => {
    if (phase !== "recording") return
    const host = pipWindow ?? window
    const buffer = new Uint8Array(512)
    const timer = host.setInterval(() => {
      const current = session.current
      if (!current) return
      const pausedNow = current.pausedAt ? performance.now() - current.pausedAt : 0
      setElapsed((performance.now() - current.startedAt - current.pausedTotal - pausedNow) / 1000)
      if (current.analyser) setLevel(readLevel(current.analyser, buffer))
      setPending(current.uploader.pendingBytes + (current.cameraUploader?.pendingBytes ?? 0))
    }, 150)
    return () => host.clearInterval(timer)
  }, [phase, pipWindow])

  useEffect(() => {
    if (phase !== "recording" && phase !== "countdown" && phase !== "finishing") return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [phase])

  async function chooseScreen() {
    setError(null)
    try {
      const Controller = (window as unknown as { CaptureController?: new () => { setFocusBehavior: (b: string) => void } })
        .CaptureController
      const controller = Controller ? new Controller() : undefined
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30 }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: true,
        ...(controller ? { controller } : {}),
        selfBrowserSurface: "exclude",
        systemAudio: "include",
        surfaceSwitching: "include",
      } as DisplayMediaStreamOptions)
      try {
        // Keep focus here so Start is one click away.
        controller?.setFocusBehavior("no-focus-change")
      } catch {
        // Only valid for tab and window captures.
      }
      const track = stream.getVideoTracks()[0]
      const kind =
        (track.getSettings() as MediaTrackSettings & { displaySurface?: Surface }).displaySurface ?? "monitor"
      track.addEventListener("ended", () => {
        if (session.current) void stop()
        else {
          setScreenStream(null)
          setPhase("setup")
        }
      })
      if (screenRef.current) stopStreams([screenRef.current])
      setSurface(kind)
      setScreenStream(stream)
      setPhase("ready")
    } catch {
      // Picker dismissed.
    }
  }

  /**
   * The floating window. Sharing a tab or window doesn't capture it, so it
   * shows your camera bubble. Sharing the whole screen would bake it into the
   * video next to the real camera track, so then it's just a slim control bar.
   */
  async function openFloating(): Promise<Window | null> {
    if (!window.documentPictureInPicture) return null
    const bubble = cameraOn && surface !== "monitor"
    const size = bubble ? { width: 240, height: notes.trim() ? 420 : 280 } : { width: 340, height: 64 }
    try {
      const win = await window.documentPictureInPicture.requestWindow(size)
      for (const sheet of document.querySelectorAll("link[rel=stylesheet], style")) {
        win.document.head.appendChild(sheet.cloneNode(true))
      }
      win.document.body.style.margin = "0"
      win.document.body.style.background = "#0a0a0a"
      win.addEventListener("keydown", (event) => {
        if (event.code === "Space") {
          event.preventDefault()
          togglePause()
        }
      })
      win.addEventListener("pagehide", () => setPipWindow(null))
      pipRef.current = win
      setPipWindow(win)
      return win
    } catch {
      return null
    }
  }

  async function start() {
    setError(null)
    setPaused(false)
    if (mode === "screen" && !pipRef.current) await openFloating()
    setPhase("countdown")
    try {
      const streams: Array<MediaStream> = []
      let micStream: MediaStream | null = null
      if (micOn) {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: micId ? { exact: micId } : undefined,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        })
        streams.push(micStream)
      }

      const screenTrack = mode === "screen" ? screenStream?.getVideoTracks()[0] : null
      const cameraTrack = cameraStream?.getVideoTracks()[0] ?? null
      const mainTrack = mode === "screen" ? screenTrack : cameraTrack
      if (!mainTrack) throw new Error("Nothing to record. Pick a screen or turn the camera on.")
      // Recorded on its own track so the layout can change after recording.
      const separateCamera = mode === "screen" && cameraOn && cameraTrack ? cameraTrack : null

      // Mic and tab/system audio mixed into one track.
      const audioSources = [
        ...(micStream ? [micStream] : []),
        ...(mode === "screen" && screenStream?.getAudioTracks().length ? [screenStream] : []),
      ]
      let audioContext: AudioContext | null = null
      let audioTrack: MediaStreamTrack | null = null
      let analyser: AnalyserNode | null = null
      if (audioSources.length > 0) {
        audioContext = new AudioContext()
        const destination = audioContext.createMediaStreamDestination()
        analyser = audioContext.createAnalyser()
        analyser.fftSize = 512
        for (const source of audioSources) {
          const node = audioContext.createMediaStreamSource(source)
          node.connect(destination)
          if (source === micStream) node.connect(analyser)
        }
        audioTrack = destination.stream.getAudioTracks()[0]
      }

      const mimeType = pickVideoMimeType()
      const cameraMimeType = separateCamera ? pickCameraMimeType() : null
      const settings = mainTrack.getSettings()
      const response = await fetch("/api/recordings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mimeType,
          cameraMimeType,
          surface: mode === "camera" ? "camera" : surface,
          width: settings.width ?? null,
          height: settings.height ?? null,
          spaceId: spaceId ?? null,
        }),
      })
      if (!response.ok) throw new Error(await startError(response, "Couldn't start the recording. Are you still signed in?"))
      const { id, url }: { id: string; url: string } = await response.json()
      startBackup({
        id,
        startedAt: Date.now(),
        mimeType,
        cameraMimeType,
        surface: mode === "camera" ? "camera" : surface,
        width: settings.width ?? null,
        height: settings.height ?? null,
      })

      const uploader = new PartUploader(id, "screen")
      const recorder = new MediaRecorder(new MediaStream([mainTrack, ...(audioTrack ? [audioTrack] : [])]), {
        mimeType,
        videoBitsPerSecond: mode === "screen" ? 3_500_000 : 2_500_000,
        audioBitsPerSecond: 128_000,
      })
      recorder.ondataavailable = (event) => {
        backupChunk(id, "screen", event.data)
        uploader.push(event.data)
      }

      const cameraUploader = separateCamera ? new PartUploader(id, "camera") : null
      const cameraRecorder =
        separateCamera && cameraMimeType && cameraUploader
          ? new MediaRecorder(new MediaStream([separateCamera]), {
              mimeType: cameraMimeType,
              videoBitsPerSecond: 1_200_000,
            })
          : null
      if (cameraRecorder && cameraUploader) {
        cameraRecorder.ondataavailable = (event) => {
          backupChunk(id, "camera", event.data)
          cameraUploader.push(event.data)
        }
      }

      const audioMime = audioTrack ? pickAudioMimeType() : null
      const audioChunks: Array<Blob> = []
      const audioRecorder =
        audioTrack && audioMime
          ? new MediaRecorder(new MediaStream([audioTrack]), { mimeType: audioMime, audioBitsPerSecond: 32_000 })
          : null
      if (audioRecorder) {
        audioRecorder.ondataavailable = (event) => {
          backupChunk(id, "audio", event.data)
          audioChunks.push(event.data)
        }
      }

      await new Promise<void>((resolve) => {
        let n = 3
        setCountdown(n)
        const finish = () => {
          clearInterval(timer)
          skipCountdown.current = null
          resolve()
        }
        const timer = setInterval(() => {
          n -= 1
          if (n <= 0) finish()
          else setCountdown(n)
        }, 1000)
        skipCountdown.current = finish
      })

      // Same tick, so the screen and camera tracks line up on playback.
      recorder.start(1000)
      cameraRecorder?.start(1000)
      audioRecorder?.start(1000)
      session.current = {
        id,
        url,
        recorder,
        cameraRecorder,
        audioRecorder,
        audioChunks,
        uploader,
        cameraUploader,
        streams,
        audioContext,
        analyser,
        startedAt: performance.now(),
        pausedAt: null,
        pausedTotal: 0,
        width: settings.width ?? null,
        height: settings.height ?? null,
      }
      setElapsed(0)
      setPhase("recording")
      // The first second is usually this page; by 4s you've switched to what you're showing,
      // and 20s in is a more typical frame still.
      setTimeout(() => void capturePoster(id, mainTrack), 4000)
      setTimeout(() => void capturePoster(id, mainTrack), 20000)
    } catch (err) {
      pipRef.current?.close()
      setError(err instanceof Error ? err.message : "Recording failed to start.")
      setPhase(mode === "screen" && screenRef.current ? "ready" : "setup")
    }
  }

  const recorders = (current: Session) =>
    [current.recorder, current.cameraRecorder, current.audioRecorder].filter(
      (recorder): recorder is MediaRecorder => recorder !== null,
    )

  function togglePause() {
    const current = session.current
    if (!current) return
    if (current.recorder.state === "recording") {
      for (const recorder of recorders(current)) recorder.pause()
      current.pausedAt = performance.now()
      setPaused(true)
    } else if (current.recorder.state === "paused") {
      for (const recorder of recorders(current)) recorder.resume()
      if (current.pausedAt) current.pausedTotal += performance.now() - current.pausedAt
      current.pausedAt = null
      setPaused(false)
    }
  }

  const stopRecorders = (current: Session) =>
    Promise.all(
      recorders(current)
        .filter((recorder) => recorder.state !== "inactive")
        .map(
          (recorder) =>
            new Promise<void>((resolve) => {
              recorder.addEventListener("stop", () => resolve(), { once: true })
              recorder.stop()
            }),
        ),
    )

  function releaseDevices(current: Session, keepScreen = false) {
    stopStreams(current.streams)
    void current.audioContext?.close()
    if (!keepScreen) {
      if (screenRef.current) stopStreams([screenRef.current])
      setScreenStream(null)
    }
  }

  /** Hands a finished recording to the person who requested it. */
  async function submitToRequest(uploadId: string) {
    let name = ""
    try {
      name = sessionStorage.getItem("vertov_request_name") ?? ""
    } catch {
      // The name is optional.
    }
    const sent = await fetch(`/api/requests/${requestId}/submit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ uploadId, name: name || null }),
    })
    if (!sent.ok) {
      const body = (await sent.json().catch(() => null)) as { error?: string } | null
      throw new Error(body?.error ?? "The video couldn't be sent.")
    }
  }

  async function stop(copyFrom?: Window) {
    const current = session.current
    if (!current || finishing.current) return
    finishing.current = true
    const pausedNow = current.pausedAt ? performance.now() - current.pausedAt : 0
    const duration = (performance.now() - current.startedAt - current.pausedTotal - pausedNow) / 1000
    // Copy while the click that stopped us still counts as a user gesture.
    void (copyFrom ?? window).navigator.clipboard.writeText(current.url).catch(() => {})
    setPhase("finishing")
    await stopRecorders(current)
    releaseDevices(current)
    pipRef.current?.close()
    try {
      const [partCount, cameraPartCount] = await Promise.all([
        current.uploader.finish(),
        current.cameraUploader ? current.cameraUploader.finish().catch(() => 0) : Promise.resolve(0),
      ])
      if (current.audioChunks.length > 0) {
        const audio = new Blob(current.audioChunks, { type: current.audioChunks[0].type })
        await fetch(`/api/recordings/${current.id}/sidecar?kind=audio`, {
          method: "PUT",
          headers: { "content-type": audio.type.split(";")[0] },
          body: audio,
        }).catch(() => {})
      }
      const response = await fetch(`/api/recordings/${current.id}/complete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ duration, partCount, cameraPartCount, width: current.width, height: current.height }),
      })
      if (!response.ok) throw new Error("The upload couldn't be finished.")
      if (requestId) {
        await submitToRequest(current.id)
        await removeBackup(current.id)
        window.location.href = `/request/${requestId}?done=1`
        return
      }
      await removeBackup(current.id)
      if (embed && handBack(current.id)) return
      window.location.href = `/${current.id}?new=1`
    } catch (err) {
      setError(`${err instanceof Error ? err.message : "Upload failed."} Your recording is safe in this browser, so you can upload it again.`)
      setFailedId(current.id)
      setPhase("error")
    } finally {
      session.current = null
      finishing.current = false
    }
  }

  /** Throws the take away. With `again`, starts a fresh one on the same screen. */
  async function discard(again = false) {
    const current = session.current
    if (!current) return
    if (!again && !confirm("Delete this recording?")) return
    session.current = null
    await stopRecorders(current)
    releaseDevices(current, again)
    // Restarting keeps the floating window: reopening it would need another click.
    if (!again) pipRef.current?.close()
    await fetch(`/api/recordings/${current.id}`, { method: "DELETE" }).catch(() => {})
    void removeBackup(current.id)
    setPaused(false)
    if (again) void start()
    else setPhase(screenRef.current ? "ready" : "setup")
  }

  /** Sends a take saved in this browser up as a fresh recording. */
  async function recoverTake(take: BackupTake) {
    setRecovering(take.id)
    setError(null)
    try {
      const tracks = await readTake(take.id)
      if (!tracks.screen) throw new Error("That recording has nothing in it.")
      const response = await fetch("/api/recordings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mimeType: take.mimeType,
          cameraMimeType: tracks.camera ? take.cameraMimeType : null,
          surface: take.surface,
          width: take.width,
          height: take.height,
        }),
      })
      if (!response.ok) throw new Error(await startError(response, "Couldn't start the upload. Are you still signed in?"))
      const { id }: { id: string } = await response.json()
      const send = (track: "screen" | "camera", blob: Blob) => {
        const uploader = new PartUploader(id, track)
        uploader.push(blob)
        return uploader.finish()
      }
      const [partCount, cameraPartCount] = await Promise.all([
        send("screen", tracks.screen),
        tracks.camera ? send("camera", tracks.camera).catch(() => 0) : Promise.resolve(0),
      ])
      if (tracks.audio) {
        await fetch(`/api/recordings/${id}/sidecar?kind=audio`, {
          method: "PUT",
          headers: { "content-type": tracks.audio.type.split(";")[0] },
          body: tracks.audio,
        }).catch(() => {})
      }
      const completed = await fetch(`/api/recordings/${id}/complete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ duration: take.seconds, partCount, cameraPartCount, width: take.width, height: take.height }),
      })
      if (!completed.ok) throw new Error("The upload couldn't be finished.")
      // The half-finished original is replaced by this one.
      await fetch(`/api/recordings/${take.id}`, { method: "DELETE" }).catch(() => {})
      if (requestId) await submitToRequest(id)
      await removeBackup(take.id)
      if (requestId) {
        window.location.href = `/request/${requestId}?done=1`
        return
      }
      window.location.href = `/${id}?new=1`
    } catch (err) {
      setError(`${err instanceof Error ? err.message : "Upload failed."} It's still saved here; try again in a moment.`)
      setRecovering(null)
    }
  }

  async function downloadTake(take: BackupTake) {
    const tracks = await readTake(take.id)
    for (const [track, blob] of [["screen", tracks.screen], ["camera", tracks.camera]] as const) {
      if (!blob) continue
      const link = document.createElement("a")
      link.href = URL.createObjectURL(blob)
      link.download = `${APP_NAME} ${new Date(take.startedAt).toLocaleString()} ${track}.${blob.type.includes("webm") ? "webm" : "mp4"}`
      link.click()
      setTimeout(() => URL.revokeObjectURL(link.href), 10_000)
    }
  }

  async function discardTake(take: BackupTake) {
    if (!confirm("Delete this saved recording from this browser?")) return
    await removeBackup(take.id)
    setSavedTakes((takes) => takes.filter((item) => item.id !== take.id))
  }

  const uploadNote =
    pending > 6 * 1024 * 1024 ? `Catching up · ${Math.round(pending / 1024 / 1024)} MB to send` : "Uploading live"

  const controls = (where: "page" | "bubble") => (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={(event) => void stop(where === "bubble" ? (event.view as unknown as Window) : undefined)}
        title="Stop and copy link"
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-red-600 transition-transform hover:scale-105 hover:bg-red-500"
      >
        <span className="size-3 rounded-[3px] bg-white" />
      </button>
      <span className="min-w-11 font-mono text-sm text-white tabular-nums">{formatDuration(elapsed)}</span>
      <LevelBars level={paused ? 0 : level} />
      <IconButton title={paused ? "Resume (Space)" : "Pause (Space)"} onClick={togglePause}>
        {paused ? "▶" : "❚❚"}
      </IconButton>
      <IconButton title="Restart" onClick={() => void discard(true)}>
        ↺
      </IconButton>
      <IconButton title="Delete" onClick={() => void discard()}>
        🗑
      </IconButton>
    </div>
  )

  const bubbleMode = cameraOn && surface !== "monitor"

  return (
    <main className="min-h-dvh bg-neutral-950 text-white">
      <header className="flex h-14 items-center justify-between border-b border-white/10 px-4">
        <a href="/" className="font-semibold tracking-tight">
          {APP_NAME}
        </a>
        <a href="/" className="text-sm text-neutral-400 hover:text-white">
          My library
        </a>
      </header>

      <div className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-8">
        {(phase === "setup" || phase === "ready") &&
          savedTakes.map((take) => (
            <div key={take.id} className="rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4">
              <p className="text-sm font-semibold text-amber-100">
                We saved a recording that didn't finish uploading
              </p>
              <p className="mt-0.5 text-sm text-amber-200/80">
                {new Date(take.startedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })} ·{" "}
                {formatDuration(take.seconds)}. It's kept in this browser until it's safely uploaded.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={recovering !== null}
                  onClick={() => void recoverTake(take)}
                  className="rounded-lg bg-amber-300 px-3 py-1.5 text-sm font-semibold text-neutral-950 hover:bg-amber-200 disabled:opacity-60"
                >
                  {recovering === take.id ? "Uploading…" : "Upload it now"}
                </button>
                <button type="button" onClick={() => void downloadTake(take)} className="rounded-lg bg-white/10 px-3 py-1.5 text-sm hover:bg-white/20">
                  Download
                </button>
                <button type="button" onClick={() => void discardTake(take)} className="rounded-lg px-3 py-1.5 text-sm text-amber-200/80 hover:bg-white/10">
                  Delete
                </button>
              </div>
            </div>
          ))}
        {(phase === "setup" || phase === "ready") && (
          <>
            <div className="flex gap-2">
              {(["screen", "camera"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => update({ mode: option })}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                    mode === option ? "bg-white text-neutral-900" : "bg-white/10 hover:bg-white/20"
                  }`}
                >
                  {option === "screen" ? "🖥  Screen + camera" : "🙂  Camera only"}
                </button>
              ))}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <DeviceRow
                label="Camera"
                enabled={mode === "camera" || cameraOn}
                canToggle={mode === "screen"}
                onToggle={() => update({ cameraOn: !cameraOn })}
                devices={cameras}
                value={cameraId}
                onChange={(value) => update({ cameraId: value })}
              />
              <DeviceRow
                label="Mic"
                enabled={micOn}
                canToggle
                onToggle={() => update({ micOn: !micOn })}
                devices={mics}
                value={micId}
                onChange={(value) => update({ micId: value })}
                meter={micOn ? level : null}
              />
            </div>

            <StagePreview
              screen={mode === "screen" ? screenStream : null}
              camera={wantCamera ? cameraStream : null}
              cameraOnly={mode === "camera"}
            />

            {mode === "screen" && (
              <details className="rounded-xl bg-white/5 px-4 py-3 text-sm open:pb-4">
                <summary className="cursor-pointer text-neutral-300 select-none">
                  📝 Speaker notes {notes.trim() ? "· ready" : "(optional)"}
                </summary>
                <textarea
                  value={notes}
                  onChange={(event) => update({ notes: event.target.value })}
                  rows={4}
                  placeholder="Talking points. They float under your camera bubble while you record and aren't in the video."
                  className="mt-3 w-full rounded-lg bg-neutral-900 p-3 text-sm text-white placeholder:text-neutral-500"
                />
              </details>
            )}

            {mode === "screen" && surface && (
              <p className="text-sm text-neutral-400">
                {surface === "monitor"
                  ? "Sharing your whole screen. A slim control bar floats on top; your camera is recorded separately and placed on playback."
                  : `Sharing a ${surface === "browser" ? "tab" : "window"}.${cameraOn ? " Your camera bubble floats on top and is recorded separately." : ""}`}
              </p>
            )}

            <div className="flex flex-wrap gap-3">
              {mode === "screen" && (
                <button
                  type="button"
                  onClick={() => void chooseScreen()}
                  className={`rounded-xl px-5 py-3 text-sm font-semibold transition-colors ${
                    screenStream ? "bg-white/10 hover:bg-white/20" : "bg-indigo-600 hover:bg-indigo-500"
                  }`}
                >
                  {screenStream ? "Change what you share" : "Choose what to share"}
                </button>
              )}
              <button
                type="button"
                disabled={mode === "screen" ? !screenStream : !cameraStream}
                onClick={() => void start()}
                className="flex items-center gap-2 rounded-xl bg-red-600 px-5 py-3 text-sm font-semibold transition-colors hover:bg-red-500 disabled:opacity-40"
              >
                <span className="size-2.5 rounded-full bg-white" /> Start recording
              </button>
            </div>
          </>
        )}

        {phase === "countdown" && (
          <button
            type="button"
            onClick={() => skipCountdown.current?.()}
            className="flex h-80 flex-col items-center justify-center gap-3"
          >
            <span key={countdown} className="pop-in text-9xl font-bold tabular-nums">
              {countdown}
            </span>
            <span className="text-sm text-neutral-400">Click to skip</span>
          </button>
        )}

        {phase === "recording" && (
          <div className="flex flex-col items-center gap-6 py-8">
            <div className="flex items-center gap-2 text-sm text-neutral-300">
              <span className={`size-2.5 rounded-full ${paused ? "bg-yellow-400" : "animate-pulse bg-red-500"}`} />
              {paused ? "Paused" : "Recording"} · <span className="text-neutral-400">{uploadNote}</span>
            </div>
            {mode === "camera" && <StagePreview screen={null} camera={cameraStream} cameraOnly />}
            <div className="rounded-full bg-white/10 px-3 py-2">{controls("page")}</div>
            {mode === "screen" && (
              <p className="max-w-md text-center text-sm text-neutral-400">
                Go show what you want to show. Stop from the floating {pipWindow && bubbleMode ? "bubble" : "bar"} or
                here; the link is copied the moment you stop.
              </p>
            )}
          </div>
        )}

        {phase === "finishing" && (
          <div className="flex h-80 flex-col items-center justify-center gap-2">
            <span className="size-8 animate-spin rounded-full border-2 border-white/20 border-t-white" />
            <p className="mt-2 text-lg font-semibold">Finishing up…</p>
            <p className="text-sm text-neutral-400">Your link is on the clipboard. Opening it now.</p>
          </div>
        )}

        {error && <p className="rounded-lg bg-red-950 px-4 py-3 text-sm text-red-200">{error}</p>}
        {phase === "error" && failedId && (
          <button
            type="button"
            disabled={recovering !== null}
            onClick={() =>
              void unfinishedTakes().then((takes) => {
                const take = takes.find((item) => item.id === failedId)
                if (take) void recoverTake(take)
                else setError("The saved copy isn't in this browser anymore.")
              })
            }
            className="self-start rounded-xl bg-white px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-neutral-200 disabled:opacity-60"
          >
            {recovering ? "Uploading…" : "Upload it again"}
          </button>
        )}
        {phase === "error" && (
          <button
            type="button"
            onClick={() => {
              setError(null)
              setPhase("setup")
            }}
            className="self-start rounded-xl bg-white/10 px-4 py-2 text-sm hover:bg-white/20"
          >
            Record again
          </button>
        )}
      </div>

      {pipWindow &&
        createPortal(
          bubbleMode && cameraStream ? (
            <div className="group relative flex h-dvh w-full flex-col items-center bg-neutral-950 pt-2">
              <Bubble stream={cameraStream} />
              {phase === "recording" && (
                <div className="absolute inset-x-0 top-[170px] flex justify-center opacity-0 transition-opacity group-hover:opacity-100">
                  <div className="rounded-full bg-black/75 px-1.5 py-1 backdrop-blur">{controls("bubble")}</div>
                </div>
              )}
              {phase === "recording" && (
                <span
                  className={`absolute top-3 right-3 size-2.5 rounded-full ${paused ? "bg-yellow-400" : "animate-pulse bg-red-500"}`}
                />
              )}
              {notes.trim() && (
                <div className="mt-2 min-h-0 w-full flex-1 overflow-y-auto px-3 pb-3 text-[13px] leading-snug whitespace-pre-wrap text-neutral-200">
                  {notes}
                </div>
              )}
              {phase === "countdown" && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-6xl font-bold text-white">
                  {countdown}
                </div>
              )}
            </div>
          ) : (
            <div className="flex h-dvh w-full items-center justify-center bg-neutral-950 px-2">
              {phase === "recording" ? (
                controls("bubble")
              ) : (
                <span className="text-sm text-white">Starting in {countdown}…</span>
              )}
            </div>
          ),
          pipWindow.document.body,
        )}
    </main>
  )
}

function IconButton({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs text-white transition-colors hover:bg-white/25"
    >
      {children}
    </button>
  )
}

function LevelBars({ level }: { level: number }) {
  return (
    <div className="flex h-4 items-end gap-0.5" aria-hidden>
      {[0.15, 0.35, 0.6, 0.85].map((threshold, index) => (
        <span
          key={index}
          className={`w-1 rounded-sm transition-colors ${level >= threshold ? "bg-green-400" : "bg-white/20"}`}
          style={{ height: `${40 + index * 20}%` }}
        />
      ))}
    </div>
  )
}

function DeviceRow(props: {
  label: string
  enabled: boolean
  canToggle: boolean
  onToggle: () => void
  devices: Array<MediaDeviceInfo>
  value: string
  onChange: (value: string) => void
  meter?: number | null
}) {
  return (
    <div className="flex items-center gap-2 rounded-xl bg-white/5 p-2.5">
      <button
        type="button"
        disabled={!props.canToggle}
        onClick={props.onToggle}
        className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${props.enabled ? "bg-green-600" : "bg-white/10 text-neutral-400"}`}
      >
        {props.label} {props.enabled ? "on" : "off"}
      </button>
      <select
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        disabled={!props.enabled}
        className="min-w-0 flex-1 rounded-lg bg-neutral-900 px-2 py-1.5 text-sm disabled:opacity-40"
      >
        <option value="">Default {props.label.toLowerCase()}</option>
        {props.devices.map((device) => (
          <option key={device.deviceId} value={device.deviceId}>
            {device.label || props.label}
          </option>
        ))}
      </select>
      {props.meter != null && <LevelBars level={props.meter} />}
    </div>
  )
}

/** What the video will look like: the shared screen with the camera bubble where playback puts it. */
function StagePreview({
  screen,
  camera,
  cameraOnly,
}: {
  screen: MediaStream | null
  camera: MediaStream | null
  cameraOnly: boolean
}) {
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-white/5">
      {cameraOnly ? (
        camera && <StreamVideo stream={camera} mirror className="size-full object-cover" />
      ) : screen ? (
        <StreamVideo stream={screen} className="size-full object-contain" />
      ) : (
        <div className="flex size-full items-center justify-center text-sm text-neutral-500">
          Choose a screen, window or tab to preview it here
        </div>
      )}
      {!cameraOnly && camera && (
        <div className="absolute bottom-[4%] left-[2.5%] aspect-square w-[20%] overflow-hidden rounded-full shadow-xl ring-2 ring-white/80">
          <StreamVideo stream={camera} mirror className="size-full object-cover" />
        </div>
      )}
    </div>
  )
}

function StreamVideo({ stream, mirror, className }: { stream: MediaStream; mirror?: boolean; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream
  }, [stream])
  return <video ref={ref} autoPlay muted playsInline className={`${className ?? ""} ${mirror ? "-scale-x-100" : ""}`} />
}

function Bubble({ stream }: { stream: MediaStream }) {
  return (
    <div className="aspect-square w-[92%] max-w-[224px] shrink-0 overflow-hidden rounded-full ring-2 ring-white/70">
      <StreamVideo stream={stream} mirror className="size-full object-cover" />
    </div>
  )
}

/** First frame of the recording as the poster, so the link unfurls with a picture immediately. */
async function capturePoster(id: string, track: MediaStreamTrack) {
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
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85))
    if (blob) {
      await fetch(`/api/recordings/${id}/sidecar?kind=poster`, {
        method: "PUT",
        headers: { "content-type": "image/jpeg" },
        body: blob,
      })
    }
  } catch {
    // A missing poster only means a plainer link preview.
  } finally {
    video.srcObject = null
  }
}

/** The server's reason when it gave one (a full library, say), else the fallback. */
async function startError(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null
  return response.status === 402 && body?.error ? body.error : fallback
}
