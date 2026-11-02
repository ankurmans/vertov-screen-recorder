import { NAME } from "./brand.js"
import { BACKGROUNDS } from "./lib/effects.js"
import { disconnect, getConnection, setServer } from "./lib/settings.js"

const app = document.getElementById("app")
const ask = (type, extra = {}) => chrome.runtime.sendMessage({ type, ...extra })

const defaults = { mode: "tab", camera: false, cameraId: "", mic: true, micId: "", captureClicks: false, live: false, size: "auto", customWidth: 1280, customHeight: 720, background: "none" }
let options = { ...defaults }
let preview = null
let error = null
let ticker = null

const h = (tag, attrs = {}, ...children) => {
  const element = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value == null) continue
    if (key.startsWith("on")) element.addEventListener(key.slice(2), value)
    else if (key === "class") element.className = value
    else element.setAttribute(key, value === true ? "" : value)
  }
  element.append(...children.flat().filter((child) => child != null && child !== false))
  return element
}

/** append() that skips the false/null left by conditional children. */
const put = (...nodes) => app.append(...nodes.flat().filter((node) => node != null && node !== false))

const clock = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`

function header(connection) {
  return h(
    "div",
    { class: "head" },
    h("img", { src: "icons/icon32.png", alt: "" }),
    h("strong", {}, NAME),
    connection.token && h("a", { href: connection.server, target: "_blank" }, "Library ↗"),
  )
}

async function render() {
  stopPreview()
  clearInterval(ticker)
  const connection = await getConnection()
  const status = await ask("status").catch(() => null)
  app.replaceChildren(header(connection))
  if (!connection.token) return renderConnect(connection)
  if (status?.recording) return renderRecording(status.recording)
  return renderReady(connection)
}

function renderConnect(connection) {
  const server = h("input", { type: "url", value: connection.server, "aria-label": "Server address" })
  put(
    h("p", { class: "small" }, `Connect once and every recording lands in your ${NAME} library with a link ready to paste.`),
    h(
      "button",
      {
        class: "primary",
        onclick: async () => {
          await setServer(server.value)
          const { server: origin } = await getConnection()
          await chrome.tabs.create({ url: `${origin}/connect-extension?ext=${chrome.runtime.id}` })
          window.close()
        },
      },
      `Connect to ${NAME}`,
    ),
    h("details", {}, h("summary", {}, "Self-hosting? Change the server"), server),
  )
}

function renderRecording(recording) {
  const timer = h("div", { class: "timer" }, clock(recording.elapsed ?? 0))
  let paused = Boolean(recording.paused)
  const pauseButton = h("button", { class: "secondary", onclick: togglePause }, paused ? "Resume" : "Pause")
  async function togglePause() {
    const result = await ask("pause", { paused: !paused })
    paused = Boolean(result?.paused)
    pauseButton.textContent = paused ? "Resume" : "Pause"
  }
  put(
    timer,
    h("div", { class: "status" }, recording.capture ? "Recording · capturing clicks" : "Recording"),
    h(
      "button",
      {
        class: "primary record",
        onclick: async (event) => {
          event.currentTarget.disabled = true
          event.currentTarget.textContent = "Finishing upload…"
          const result = await ask("stop")
          if (!result?.ok) {
            error = result?.error
            return render()
          }
          window.close()
        },
      },
      "Stop and share",
    ),
    h(
      "div",
      { class: "actions" },
      pauseButton,
      h(
        "button",
        {
          class: "secondary",
          onclick: async () => {
            if (!confirm("Delete this recording?")) return
            await ask("discard")
            render()
          },
        },
        "Discard",
      ),
    ),
    h("p", { class: "hint" }, "The link is copied when you stop. Alt+Shift+R stops too."),
  )
  ticker = setInterval(async () => {
    const status = await ask("status").catch(() => null)
    if (!status?.recording) return render()
    timer.textContent = clock(status.recording.elapsed ?? 0)
  }, 1000)
}

async function devices() {
  const list = await navigator.mediaDevices.enumerateDevices().catch(() => [])
  const labelled = list.filter((device) => device.label)
  return {
    granted: labelled.length > 0,
    cameras: labelled.filter((device) => device.kind === "videoinput"),
    mics: labelled.filter((device) => device.kind === "audioinput"),
  }
}

async function renderReady(connection) {
  const { lastOptions } = await chrome.storage.local.get("lastOptions")
  options = { ...defaults, ...lastOptions }
  const { granted, cameras, mics } = await devices()
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  const recordableTab = /^https?:/.test(tab?.url ?? "")
  if (options.mode === "tab" && !recordableTab) options.mode = "screen"
  const save = () => chrome.storage.local.set({ lastOptions: options })

  const modes = h(
    "div",
    { class: "modes", role: "group", "aria-label": "What to record" },
    ...[
      ["tab", "This tab"],
      ["screen", "Screen"],
      ["camera", "Camera"],
    ].map(([value, label]) =>
      h(
        "button",
        {
          "aria-pressed": String(options.mode === value),
          disabled: value === "tab" && !recordableTab,
          title: value === "tab" && !recordableTab ? "Chrome doesn't allow recording this page" : null,
          onclick: () => {
            options.mode = value
            if (value === "camera") options.camera = true
            void save()
            render()
          },
        },
        label,
      ),
    ),
  )

  const select = (items, value, onchange) =>
    h("select", { onchange: (event) => onchange(event.target.value) }, ...items.map((device) => h("option", { value: device.deviceId, selected: device.deviceId === value }, device.label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)$/i, ""))))

  const toggle = (label, checked, onchange, extra) =>
    h(
      "div",
      { class: "row" },
      h("label", {}, h("input", { type: "checkbox", class: "toggle", checked, onchange: (event) => onchange(event.target.checked) }), label),
      extra,
    )

  const SIZES = [
    ["auto", "Original, up to 1080p"],
    ["720", "720p"],
    ["4k", "4K (needs a 4K display)"],
    ["square", "Square 1080×1080"],
    ["vertical", "Vertical 1080×1920"],
    ["custom", "Custom size…"],
  ]
  const sizeRow = h(
    "div",
    { class: "row" },
    h("label", {}, "Quality"),
    h("select", { "aria-label": "Recording size", onchange: (event) => { options.size = event.target.value; void save(); render() } }, ...SIZES.map(([value, label]) => h("option", { value, selected: options.size === value }, label))),
  )
  const numberInput = (key, label) =>
    h("input", {
      type: "number", min: 320, max: 3840, step: 2, value: options[key], "aria-label": label, style: "width:72px",
      onchange: (event) => { options[key] = Math.min(3840, Math.max(320, Math.round(Number(event.target.value)) || options[key])); void save(); render() },
    })
  const customRow = options.size === "custom" && h("div", { class: "row" }, h("label", {}, "Width × height"), h("span", {}, numberInput("customWidth", "Width"), " × ", numberInput("customHeight", "Height")))
  const backgroundRow = h(
    "div",
    { class: "row" },
    h("label", {}, "Background"),
    h("select", { "aria-label": "Camera background", onchange: (event) => { options.background = event.target.value; void save(); render() } }, ...BACKGROUNDS.map((item) => h("option", { value: item.value, selected: options.background === item.value }, item.label))),
  )
  const imageRow = options.background === "image" && h(
    "div",
    { class: "row" },
    h("label", {}, "Image"),
    h("input", { type: "file", accept: "image/*", "aria-label": "Background image", onchange: async (event) => {
      const file = event.target.files?.[0]
      if (!file) return
      const bitmap = await createImageBitmap(file)
      const scale = Math.min(1, 1280 / bitmap.width)
      const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale))
      canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 })
      const dataUrl = await new Promise((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(blob) })
      await chrome.storage.local.set({ bgImage: dataUrl })
      render()
    } }),
  )
  const cameraOn = options.mode === "camera" || options.camera
  const video = cameraOn && granted ? h("video", { class: "preview", muted: true, autoplay: true, playsinline: true }) : null

  put(
    modes,
    options.mode !== "camera" &&
      toggle("Camera bubble", options.camera, (value) => {
        options.camera = value
        void save()
        render()
      }, granted && cameras.length > 1 && options.camera ? select(cameras, options.cameraId, (value) => { options.cameraId = value; void save(); render() }) : null),
    options.mode === "camera" && granted && cameras.length > 1 && h("div", { class: "row" }, h("label", {}, "Camera"), select(cameras, options.cameraId, (value) => { options.cameraId = value; void save(); render() })),
    video,
    toggle("Microphone", options.mic, (value) => {
      options.mic = value
      void save()
    }, granted && mics.length > 1 && options.mic ? select(mics, options.micId, (value) => { options.micId = value; void save() }) : null),
    toggle("Let viewers watch live", options.live, (value) => {
      options.live = value
      void save()
    }),
    options.mode !== "camera" && sizeRow,
    options.mode !== "camera" && customRow,
    cameraOn && backgroundRow,
    cameraOn && imageRow,
    options.mode !== "camera" &&
      toggle("Capture clicks for AI agents", options.captureClicks, (value) => {
        options.captureClicks = value
        void save()
      }),
    !granted && (options.mic || cameraOn) &&
      h("p", { class: "hint" }, "Chrome needs your OK once. ", h("button", { class: "link", onclick: () => chrome.tabs.create({ url: "permissions.html" }) }, "Allow camera and microphone")),
    h(
      "button",
      {
        class: "primary record",
        style: "margin-top:10px",
        onclick: async (event) => {
          event.currentTarget.disabled = true
          error = null
          stopPreview()
          // Pen, spotlight, camera bubble and click capture are injected into whichever tab is active, so ask once for every site.
          // Declining still records: the tab you start on is covered by activeTab.
          await chrome.permissions.request({ origins: ["<all_urls>"] }).catch(() => false)
          const { bgImage } = options.background === "image" ? await chrome.storage.local.get("bgImage") : {}
          if (options.background === "image" && !bgImage) options = { ...options, background: "none" }
          const result = await ask("start", { options: { ...options, camera: cameraOn, bgImage }, tab })
          if (!result?.ok) {
            error = result?.error ?? "Recording didn't start."
            return render()
          }
          // Tab and camera recordings start straight away; close so the popup isn't in the way.
          window.close()
        },
      },
      h("span", { class: "dot" }),
      "Start recording",
    ),
    error && h("p", { class: "error" }, error),
    h("p", { class: "hint" }, options.captureClicks ? "Clicks and pages go into the video's AI brief. Nothing you type is recorded." : options.mode === "tab" ? (cameraOn ? "Your camera shows as a bubble on the page. Hover it for Draw, Spot and Stop." : "Hover the page's top-left while recording for Draw and Spot. Alt+Shift+R stops.") : "Alt+Shift+R records this tab without opening this."),
    loomSection(tab),
    h(
      "div",
      { class: "foot" },
      h("span", {}, connection.workspace || connection.server.replace(/^https?:\/\//, "")),
      h("button", { class: "link", onclick: async () => { await disconnect(); render() } }, "Disconnect"),
    ),
  )
  error = null
  if (video) startPreview(video, options.cameraId)
}

function loomSection(tab) {
  const onLoom = /loom\.com\/share\/[a-f0-9]{32}/i.test(tab?.url ?? "")
  const links = h("textarea", { rows: 3, placeholder: "Loom links, one per line" })
  const results = h("ul", { class: "results" })
  async function run(urls) {
    results.replaceChildren(h("li", {}, "Starting…"))
    const response = await ask("import-looms", { urls })
    if (!response?.ok) return results.replaceChildren(h("li", {}, response?.error ?? "Import failed"))
    results.replaceChildren(
      ...response.results.map((item) =>
        h("li", {}, item.error ? `${item.loomId.slice(0, 8)}…: ${item.error}` : h("a", { href: item.url, target: "_blank" }, item.title || item.url)),
      ),
    )
  }
  return h(
    "details",
    { open: onLoom },
    h("summary", {}, "Bring your Looms"),
    h("p", { class: "hint" }, "Copies them with your Loom sign-in in this browser, private ones included. Old Loom links then open the copy for anyone with this extension."),
    onLoom && h("button", { class: "secondary", style: "width:100%;margin-top:6px", onclick: () => run([tab.url]) }, "Copy this Loom"),
    links,
    h("button", { class: "secondary", style: "width:100%;margin-top:6px", onclick: () => run(links.value.split(/\s+/).filter(Boolean)) }, "Copy these Looms"),
    results,
  )
}

async function startPreview(video, cameraId) {
  try {
    preview = await navigator.mediaDevices.getUserMedia({ video: { deviceId: cameraId ? { exact: cameraId } : undefined, width: { ideal: 640 } } })
    video.srcObject = preview
  } catch {
    video.remove()
  }
}

function stopPreview() {
  for (const track of preview?.getTracks() ?? []) track.stop()
  preview = null
}

window.addEventListener("pagehide", stopPreview)
void render()
