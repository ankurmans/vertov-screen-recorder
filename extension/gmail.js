// Content script for mail.google.com: a Vertov button in every compose window. Gmail's markup changes
// without notice, so everything here searches loosely and quietly does nothing when it finds no match.
;(() => {
  if (window.__vertovGmail) return
  window.__vertovGmail = true

  const BODY = '[contenteditable="true"][aria-label*="Message Body" i], [contenteditable="true"][g_editable="true"], div[role="textbox"][g_editable="true"]'
  const SEND = '[role="button"][aria-label^="Send" i], [role="button"][data-tooltip^="Send" i], .aoO[role="button"]'
  const LABEL = "Vertov"
  let counter = 0
  const saved = new WeakMap() // editable -> last caret position inside it

  const toast = (text, ms = 4000) => {
    document.querySelectorAll(".vertov-gmail-toast").forEach((node) => node.remove())
    const node = document.createElement("div")
    node.className = "vertov-gmail-toast"
    node.textContent = text
    document.body.appendChild(node)
    setTimeout(() => node.remove(), ms)
  }

  const send = (message) =>
    new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (reply) => resolve(chrome.runtime.lastError ? { ok: false, error: "The extension was updated. Reload this tab." } : reply))
      } catch {
        resolve({ ok: false, error: "The extension was updated. Reload this tab." })
      }
    })

  // The compose window around a message body: the nearest ancestor that also holds a Send button.
  const composeOf = (body) => {
    for (let node = body.parentElement, depth = 0; node && depth < 25; node = node.parentElement, depth++) {
      if (node.querySelector(SEND)) return node
    }
    return null
  }

  const decorate = (body) => {
    const root = composeOf(body)
    if (!root) return // maybe not fully drawn yet; the observer calls again
    const sendButton = root.querySelector(SEND)
    if (!sendButton || root.querySelector(".vertov-gmail-btn")) return
    root.dataset.vertovCompose ||= `v${Date.now().toString(36)}${++counter}`
    body.dataset.vertovBody = root.dataset.vertovCompose
    if (!body.dataset.vertovWatching) {
      body.dataset.vertovWatching = "1"
      for (const name of ["keyup", "mouseup", "blur"]) body.addEventListener(name, () => remember(body))
    }

    const button = document.createElement("button")
    button.type = "button"
    button.className = "vertov-gmail-btn"
    button.title = "Record a video and add it to this email"
    const icon = document.createElement("img")
    icon.src = chrome.runtime.getURL("icons/icon32.png")
    icon.alt = ""
    button.append(icon, document.createTextNode(LABEL))
    button.addEventListener("mousedown", (event) => event.preventDefault()) // keep the caret in the message
    button.addEventListener("click", () => void onClick(button, root.dataset.vertovCompose))

    // Beside Send: after its table cell when Gmail uses one, otherwise right after the button.
    const cell = sendButton.closest("td")
    if (cell?.parentElement) {
      const wrapper = document.createElement("td")
      wrapper.appendChild(button)
      cell.after(wrapper)
    } else {
      sendButton.after(button)
    }
    void refresh(button)
  }

  const remember = (body) => {
    const selection = window.getSelection()
    if (selection?.rangeCount && body.contains(selection.anchorNode)) saved.set(body, selection.getRangeAt(0).cloneRange())
  }

  const refresh = async (button) => {
    const status = await send({ type: "gmail-status" })
    button.dataset.recording = String(Boolean(status?.active))
    button.lastChild.textContent = status?.active ? "Stop" : LABEL
  }

  const onClick = async (button, composeId) => {
    const reply = await send({ type: "gmail-start", composeId })
    if (!reply?.ok) return toast(reply?.error || "Couldn't start recording.")
    if (reply.stopped) {
      button.dataset.recording = "false"
      button.lastChild.textContent = LABEL
      return toast("Finishing your video…")
    }
    button.dataset.recording = "true"
    button.lastChild.textContent = "Stop"
    toast("Recording. Click Stop here, or use the Vertov icon or Alt+Shift+R. The video is added to this email.", 6000)
  }

  const bodyFor = (composeId) => document.querySelector(`[data-vertov-body="${CSS.escape(composeId || "")}"]`)

  const html = (url, poster) => {
    const safe = (value) => String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;")
    const picture = poster
      ? `<div><a href="${safe(url)}" target="_blank"><img src="${safe(poster)}" alt="Watch the video" width="480" style="max-width:100%;border:1px solid #d4d4d8;border-radius:8px"></a></div>`
      : ""
    return `${picture}<div><a href="${safe(url)}" target="_blank">${safe(url)}</a></div><br>`
  }

  const insert = (body, markup) => {
    body.focus()
    const selection = window.getSelection()
    const range = saved.get(body)
    selection.removeAllRanges()
    if (range && body.contains(range.startContainer)) selection.addRange(range)
    else {
      const end = document.createRange()
      end.selectNodeContents(body)
      end.collapse(false)
      selection.addRange(end)
    }
    if (!document.execCommand("insertHTML", false, markup)) {
      body.insertAdjacentHTML("beforeend", markup)
      body.dispatchEvent(new InputEvent("input", { bubbles: true }))
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, reply) => {
    if (message.type !== "gmail-insert") return
    const body = bodyFor(message.composeId)
    if (!body || !body.isConnected) return reply({ ok: false })
    try {
      insert(body, html(message.url, message.poster))
      const button = body.closest("[data-vertov-compose]")?.querySelector(".vertov-gmail-btn")
      if (button) void refresh(button)
      toast("Added to your email")
      reply({ ok: true })
    } catch {
      reply({ ok: false })
    }
  })

  let queued = false
  const scan = () => {
    queued = false
    try {
      document.querySelectorAll(BODY).forEach(decorate)
    } catch {
      // Gmail changed under us: do nothing.
    }
  }
  new MutationObserver(() => {
    if (!queued) {
      queued = true
      setTimeout(scan, 300)
    }
  }).observe(document.body, { childList: true, subtree: true })
  scan()
})()
