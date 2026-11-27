// On-page tools while recording a tab: a camera bubble you can drag and resize, a pen whose strokes
// fade after a few seconds, and a cursor highlight. They are real page elements, so tab capture
// records them. Torn down when the recording ends.
(() => {
  if (window.__vertovOverlay) return
  window.__vertovOverlay = true

  const SIZES = { s: 120, m: 180, l: 260 }
  let state = { camera: false, cameraId: "", background: "none", size: "m", x: null, y: null, pen: false, spot: false }

  const host = document.createElement("div")
  host.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none"
  const root = host.attachShadow({ mode: "closed" })
  root.innerHTML = `
    <style>
      * { box-sizing: border-box; font-family: system-ui, sans-serif; }
      canvas { position: fixed; inset: 0; width: 100vw; height: 100vh; pointer-events: none; }
      canvas.pen { pointer-events: auto; cursor: crosshair; }
      .bubble { position: fixed; pointer-events: auto; border-radius: 50%; overflow: hidden; background: #111; cursor: grab;
        box-shadow: 0 0 0 3px #fff, 0 6px 24px rgb(0 0 0 / .35); touch-action: none; }
      .bubble:active { cursor: grabbing; }
      .bubble iframe { width: 100%; height: 100%; border: 0; pointer-events: none; display: block; }
      .bar { position: fixed; pointer-events: auto; display: flex; gap: 2px; padding: 3px; border-radius: 99px; background: rgb(23 23 23 / .92);
        opacity: 0; transition: opacity .15s; }
      .wrap:hover .bar, .bar:hover, .bar.open { opacity: 1; }
      .bar button { all: unset; cursor: pointer; color: #fff; font-size: 12px; padding: 5px 9px; border-radius: 99px; line-height: 1; }
      .bar button:hover { background: rgb(255 255 255 / .18); }
      .bar button[aria-pressed="true"] { background: #fff; color: #111; }
      .bar .stop { background: #dc2626; }
      .spot { position: fixed; width: 54px; height: 54px; margin: -27px 0 0 -27px; border-radius: 50%; pointer-events: none; display: none;
        background: rgb(250 204 21 / .35); border: 2px solid rgb(250 204 21 / .9); }
    </style>
    <canvas id="draw"></canvas>
    <div class="spot" id="spot"></div>
    <div class="wrap" id="wrap">
      <div class="bubble" id="bubble"></div>
      <div class="bar" id="bar">
        <button data-act="pen" aria-pressed="false" title="Draw on the page (strokes fade)">Draw</button>
        <button data-act="spot" aria-pressed="false" title="Highlight the cursor">Spot</button>
        <button data-act="size" title="Bubble size">Size</button>
        <button data-act="stop" class="stop" title="Stop and share">Stop</button>
      </div>
    </div>`
  const $ = (id) => root.getElementById(id)
  const canvas = $("draw")
  const bubble = $("bubble")
  const bar = $("bar")
  const spot = $("spot")
  const ctx = canvas.getContext("2d")

  const px = () => SIZES[state.size] ?? SIZES.m
  const clamp = (value, max) => Math.max(8, Math.min(value, max - 8))

  function place() {
    const size = px()
    const x = clamp(state.x ?? 24, innerWidth - size)
    const y = clamp(state.y ?? innerHeight - size - 24, innerHeight - size)
    bubble.style.cssText = `left:${x}px;top:${y}px;width:${size}px;height:${size}px;display:${state.camera ? "block" : "none"}`
    const barTop = state.camera ? Math.max(8, y - 38) : 12
    bar.style.cssText = `left:${state.camera ? x : 12}px;top:${barTop}px`
  }

  function loadBubble() {
    if (!state.camera || bubble.firstChild) return
    const frame = document.createElement("iframe")
    frame.allow = "camera"
    frame.src = `${chrome.runtime.getURL("bubble.html")}?camera=${encodeURIComponent(state.cameraId || "")}&bg=${encodeURIComponent(state.background || "none")}`
    bubble.append(frame)
  }

  function resize() {
    canvas.width = innerWidth * devicePixelRatio
    canvas.height = innerHeight * devicePixelRatio
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)
    place()
  }

  // Drag the bubble.
  let drag = null
  bubble.addEventListener("pointerdown", (event) => {
    const rect = bubble.getBoundingClientRect()
    drag = { dx: event.clientX - rect.left, dy: event.clientY - rect.top }
    bubble.setPointerCapture(event.pointerId)
  })
  bubble.addEventListener("pointermove", (event) => {
    if (!drag) return
    state.x = event.clientX - drag.dx
    state.y = event.clientY - drag.dy
    place()
  })
  bubble.addEventListener("pointerup", () => {
    drag = null
    save()
  })

  // Pen: strokes fade out a few seconds after they're drawn.
  const strokes = []
  let current = null
  const LIFE = 4000
  canvas.addEventListener("pointerdown", (event) => {
    current = { points: [[event.clientX, event.clientY]], done: null }
    strokes.push(current)
    canvas.setPointerCapture(event.pointerId)
  })
  canvas.addEventListener("pointermove", (event) => current?.points.push([event.clientX, event.clientY]))
  canvas.addEventListener("pointerup", () => {
    if (current) current.done = performance.now()
    current = null
  })

  function frame(now) {
    ctx.clearRect(0, 0, innerWidth, innerHeight)
    for (let i = strokes.length - 1; i >= 0; i--) {
      const stroke = strokes[i]
      const age = stroke.done ? now - stroke.done : 0
      if (age > LIFE) {
        strokes.splice(i, 1)
        continue
      }
      ctx.globalAlpha = age > LIFE - 1000 ? (LIFE - age) / 1000 : 1
      ctx.strokeStyle = "#ef4444"
      ctx.lineWidth = 4
      ctx.lineCap = ctx.lineJoin = "round"
      ctx.beginPath()
      stroke.points.forEach(([x, y], index) => (index ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
      ctx.stroke()
    }
    requestAnimationFrame(frame)
  }

  // Cursor highlight and click pulse.
  addEventListener(
    "mousemove",
    (event) => {
      if (!state.spot) return
      spot.style.display = "block"
      spot.style.left = `${event.clientX}px`
      spot.style.top = `${event.clientY}px`
    },
    true,
  )

  function refreshButtons() {
    bar.querySelector('[data-act="pen"]').setAttribute("aria-pressed", String(state.pen))
    bar.querySelector('[data-act="spot"]').setAttribute("aria-pressed", String(state.spot))
    canvas.classList.toggle("pen", state.pen)
    if (!state.spot) spot.style.display = "none"
    bar.querySelector('[data-act="size"]').style.display = state.camera ? "" : "none"
  }

  bar.addEventListener("click", (event) => {
    const act = event.target.closest("button")?.dataset.act
    if (act === "pen") state.pen = !state.pen
    else if (act === "spot") state.spot = !state.spot
    else if (act === "size") {
      state.size = state.size === "s" ? "m" : state.size === "m" ? "l" : "s"
      place()
    } else if (act === "stop") chrome.runtime.sendMessage({ type: "stop" }).catch(() => {})
    refreshButtons()
    save()
  })
  addEventListener("keydown", (event) => {
    if (event.altKey && event.shiftKey && event.code === "KeyD") {
      state.pen = !state.pen
      refreshButtons()
    }
  })

  const save = () => chrome.runtime.sendMessage({ type: "overlay-save", state: { x: state.x, y: state.y, size: state.size, spot: state.spot } }).catch(() => {})

  function teardown() {
    host.remove()
    window.__vertovOverlay = false
    removeEventListener("resize", resize)
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "overlay-off") teardown()
  })

  addEventListener("resize", resize)
  // The service worker holds the options and where you last left the bubble.
  chrome.runtime.sendMessage({ type: "overlay-state" }).then((reply) => {
    if (!reply?.ok || !reply.overlay) return teardown()
    state = { ...state, ...reply.overlay }
    document.documentElement.append(host)
    loadBubble()
    resize()
    refreshButtons()
    requestAnimationFrame(frame)
  }).catch(teardown)
})()
