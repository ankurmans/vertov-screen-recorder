// The camera preview shown inside the on-page bubble. Runs in an iframe on the extension's own origin,
// which already has camera access from permissions.html, so the host page never sees a prompt.
// In a tab recording the bubble is part of the page, so a background effect applied here is recorded.
import { backgroundTrack } from "./lib/effects.js"

const params = new URLSearchParams(location.search)
const cameraId = params.get("camera")
const background = params.get("bg") || "none"
try {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { deviceId: cameraId ? { exact: cameraId } : undefined, width: { ideal: 640 }, height: { ideal: 640 }, frameRate: { ideal: 30 } },
  })
  let shown = stream
  if (background !== "none") {
    const { bgImage } = await chrome.storage.local.get("bgImage")
    const processed = await backgroundTrack(stream.getVideoTracks()[0], background, bgImage)
    shown = new MediaStream([processed])
  }
  document.getElementById("v").srcObject = shown
  addEventListener("pagehide", () => {
    stream.getTracks().forEach((track) => track.stop())
    shown.getTracks().forEach((track) => track.stop())
  })
} catch {
  document.body.style.background = "#262626"
}
