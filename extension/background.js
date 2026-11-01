import { NAME } from "./brand.js"
import { api, errorFrom, getConnection } from "./lib/settings.js"

/**
 * Service worker: starts and stops recordings (the recording itself runs in offscreen.html),
 * keeps the toolbar badge in sync, forwards captured clicks to the recorder, sends old Loom
 * links to their copies, and brings Looms over using the browser's own Loom sign-in.
 */

const LOOM = "https://www.loom.com"

// --- recording state, kept in session storage because the worker sleeps between events ---

const getState = async () => (await chrome.storage.session.get("recording")).recording ?? null
const setState = (recording) => chrome.storage.session.set({ recording })

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] })
  if (contexts.length) return
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["USER_MEDIA", "DISPLAY_MEDIA", "CLIPBOARD"],
    justification: "Record the screen, camera and microphone, and copy the share link.",
  })
}

const toOffscreen = (type, extra = {}) => chrome.runtime.sendMessage({ target: "offscreen", type, ...extra })

async function startRecording(options, tab) {
  if (await getState()) throw new Error("Already recording.")
  const connection = await getConnection()
  if (!connection.token) throw new Error(`Connect the extension to ${NAME} first.`)
  // The offscreen document has to exist before the tab's stream id is minted for it to use.
  await ensureOffscreen()
  let capture = {}
  if (options.mode === "tab") {
    if (!tab?.id) throw new Error("No tab to record.")
    capture = { streamId: await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }) }
  }
  // In a tab recording the bubble is a real page element, so the recording already contains it:
  // no separate camera track (it would show twice). Screen recordings keep the track, composited on the share page.
  const bubbleInPage = options.mode === "tab" && Boolean(options.camera)
  if (bubbleInPage) options = { ...options, camera: false }
  const withConnection = (extra) => ({ options: { ...options, ...extra, connection: { server: connection.server, token: connection.token } } })
  let result = await toOffscreen("start", withConnection(capture))
  // If Chrome refuses the direct tab stream, its picker still lets you choose this tab.
  if (!result?.ok && options.mode === "tab" && String(result?.error).startsWith("Tab capture")) {
    console.warn("Tab capture failed, falling back to the picker:", result.error)
    result = await toOffscreen("start", withConnection({ mode: "screen" }))
  }
  if (!result?.ok) throw new Error(result?.error || "Recording didn't start.")
  const overlay = { camera: bubbleInPage, cameraId: options.cameraId || "", background: options.background || "none", size: "m", x: null, y: null, spot: false }
  await setState({ id: result.id, url: result.url, startedAt: Date.now(), elapsed: 0, paused: false, capture: Boolean(options.captureClicks), tabId: tab?.id ?? null, overlay: options.mode === "tab" ? overlay : null })
  await chrome.action.setIcon({ path: { 16: "icons/rec16.png", 32: "icons/rec32.png" } })
  await chrome.action.setBadgeBackgroundColor({ color: "#dc2626" })
  await chrome.action.setBadgeText({ text: "0:00" })
  if (options.captureClicks) await startClickCapture(tab)
  if (options.mode === "tab") await startOverlay()
  return result
}

async function finishUi() {
  await stopOverlay()
  await setState(null)
  await stopClickCapture()
  await chrome.action.setIcon({ path: { 16: "icons/icon16.png", 32: "icons/icon32.png" } })
  await chrome.action.setBadgeText({ text: "" })
}

async function stopRecording() {
  const state = await getState()
  if (!state) throw new Error("Not recording.")
  await chrome.action.setBadgeText({ text: "…" })
  const result = await toOffscreen("stop")
  await finishUi()
  if (!result?.ok) {
    await chrome.tabs.create({ url: state.url })
    throw new Error(result?.error || "The upload didn't finish.")
  }
  await chrome.tabs.create({ url: `${result.url}?new=1` })
  return result
}

async function discardRecording() {
  await toOffscreen("discard").catch(() => {})
  await finishUi()
}

const clock = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`

// --- on-page tools: camera bubble, pen, cursor highlight (tab recordings) ---

const OVERLAY_ID = "overlay"

async function startOverlay() {
  await chrome.scripting.unregisterContentScripts({ ids: [OVERLAY_ID] }).catch(() => {})
  await chrome.scripting.registerContentScripts([
    { id: OVERLAY_ID, js: ["overlay.js"], matches: ["<all_urls>"], runAt: "document_idle", persistAcrossSessions: false },
  ])
  const tabs = await chrome.tabs.query({ active: true })
  for (const open of tabs) {
    if (open.id && /^https?:/.test(open.url ?? "")) await chrome.scripting.executeScript({ target: { tabId: open.id }, files: ["overlay.js"] }).catch(() => {})
  }
}

async function stopOverlay() {
  await chrome.scripting.unregisterContentScripts({ ids: [OVERLAY_ID] }).catch(() => {})
  const tabs = await chrome.tabs.query({})
  for (const open of tabs) {
    if (open.id) chrome.tabs.sendMessage(open.id, { type: "overlay-off" }).catch(() => {})
  }
}

// --- click and page capture for agent briefs ---

const CAPTURE_ID = "capture"

async function startClickCapture(tab) {
  await chrome.scripting.unregisterContentScripts({ ids: [CAPTURE_ID] }).catch(() => {})
  await chrome.scripting.registerContentScripts([
    { id: CAPTURE_ID, js: ["capture.js"], matches: ["<all_urls>"], runAt: "document_idle", persistAcrossSessions: false },
  ])
  // Pages already open don't get registered scripts until they reload.
  const tabs = await chrome.tabs.query({})
  for (const open of tabs) {
    if (!open.id || !/^https?:/.test(open.url ?? "")) continue
    await chrome.scripting.executeScript({ target: { tabId: open.id }, files: ["capture.js"] }).catch(() => {})
  }
  if (tab?.url) await toOffscreen("event", { event: { type: "page", url: tab.url, title: tab.title } }).catch(() => {})
}

async function stopClickCapture() {
  await chrome.scripting.unregisterContentScripts({ ids: [CAPTURE_ID] }).catch(() => {})
  const tabs = await chrome.tabs.query({})
  for (const open of tabs) {
    if (open.id) chrome.tabs.sendMessage(open.id, { type: "capture-off" }).catch(() => {})
  }
}

// Switching tabs is part of the story too.
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const state = await getState()
  // The bubble follows you to the tab you switch to.
  if (state?.overlay) await chrome.scripting.executeScript({ target: { tabId }, files: ["overlay.js"] }).catch(() => {})
  if (!state?.capture) return
  const tab = await chrome.tabs.get(tabId).catch(() => null)
  if (tab?.url && /^https?:/.test(tab.url)) await toOffscreen("event", { event: { type: "page", url: tab.url, title: tab.title } }).catch(() => {})
})

// --- Loom: old links open the copies, and Looms come over with the browser's Loom sign-in ---

async function refreshRedirects() {
  const { token } = await getConnection()
  const { loomRedirects } = await chrome.storage.local.get("loomRedirects")
  const existing = await chrome.declarativeNetRequest.getDynamicRules()
  const remove = existing.map((rule) => rule.id)
  if (!token || loomRedirects === false) {
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: remove })
    return 0
  }
  const response = await api("/api/v1/redirects")
  if (!response.ok) return 0
  const { redirects } = await response.json()
  const rules = redirects.slice(0, 4000).map((item, index) => ({
    id: index + 1,
    priority: 1,
    action: { type: "redirect", redirect: { url: item.url } },
    condition: { urlFilter: `||loom.com/share/${item.loomId}`, resourceTypes: ["main_frame"] },
  }))
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: remove, addRules: rules })
  return rules.length
}

const loomIdFrom = (url) => /loom\.com\/(?:share|embed)\/([a-f0-9]{32})/i.exec(url)?.[1]?.toLowerCase() ?? null

async function loomTitle(loomId) {
  const page = await fetch(`${LOOM}/share/${loomId}`, { credentials: "include" }).catch(() => null)
  const html = page?.ok ? await page.text() : ""
  const raw = /<meta[^>]+property="og:title"[^>]+content="([^"]*)"/i.exec(html)?.[1] ?? /<title>([^<]*)<\/title>/i.exec(html)?.[1] ?? ""
  const text = raw.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/\s*\|\s*Loom\s*$/i, "").trim()
  return text && text !== "Loom" ? text.slice(0, 200) : null
}

/** Copies Looms (private ones too: the request carries this browser's Loom sign-in). */
async function importLooms(urls) {
  const ids = [...new Set(urls.map(loomIdFrom).filter(Boolean))].slice(0, 50)
  if (!ids.length) throw new Error("Those don't look like Loom links.")
  const results = []
  for (const loomId of ids) {
    try {
      const source = await fetch(`${LOOM}/api/campaigns/sessions/${loomId}/transcoded-url`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" } })
      const body = await source.json().catch(() => ({}))
      if (!source.ok || !body.url) throw new Error("Loom wouldn't hand it over. Are you signed in to Loom in this browser?")
      const created = await api("/api/v1/videos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: body.url, title: await loomTitle(loomId), sourceUrl: `${LOOM}/share/${loomId}` }),
      })
      if (!created.ok) throw new Error(await errorFrom(created, "Couldn't start the copy."))
      results.push({ loomId, ...(await created.json()) })
    } catch (error) {
      results.push({ loomId, error: error.message })
    }
  }
  // The copies finish in the background; pick up their redirects once they're ready.
  chrome.alarms.create("redirects-soon", { delayInMinutes: 2 })
  return results
}

// --- wiring ---

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message.target === "offscreen") return
  if (message.target === "background") {
    void (async () => {
      if (message.type === "tick") {
        const state = await getState()
        if (!state) return
        await setState({ ...state, elapsed: message.elapsed, paused: message.paused })
        await chrome.action.setBadgeText({ text: message.paused ? "❚❚" : clock(message.elapsed) })
      } else if (message.type === "finished") {
        await finishUi()
        await chrome.tabs.create({ url: `${message.url}?new=1` })
      } else if (message.type === "failed") {
        const state = await getState()
        await finishUi()
        if (state?.url) await chrome.tabs.create({ url: state.url })
      }
    })()
    return
  }
  if (message.type === "overlay-state") {
    void getState().then((state) => reply({ ok: true, overlay: state?.overlay ?? null }))
    return true
  }
  if (message.type === "overlay-save") {
    void getState().then((state) => state?.overlay && setState({ ...state, overlay: { ...state.overlay, ...message.state } }))
    return
  }
  if (message.type === "screen-event") {
    void getState().then((state) => {
      if (state?.capture) return toOffscreen("event", { event: { ...message.event, url: message.event.url ?? sender.tab?.url } })
    }).catch(() => {})
    return
  }
  const actions = {
    status: async () => ({ recording: await getState() }),
    start: async () => startRecording(message.options, message.tab),
    stop: () => stopRecording(),
    pause: async () => {
      const result = await toOffscreen(message.paused ? "pause" : "resume")
      const state = await getState()
      if (state) await setState({ ...state, paused: Boolean(result?.paused) })
      return { paused: Boolean(result?.paused) }
    },
    discard: () => discardRecording(),
    "import-looms": async () => ({ results: await importLooms(message.urls) }),
    "refresh-redirects": async () => ({ count: await refreshRedirects() }),
  }
  const action = actions[message.type]
  if (!action) return
  action()
    .then((result) => reply({ ok: true, ...result }))
    .catch((error) => reply({ ok: false, error: error?.message || String(error) }))
  return true
})

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== "toggle-recording") return
  try {
    if (await getState()) await stopRecording()
    else {
      const { lastOptions } = await chrome.storage.local.get("lastOptions")
      await startRecording({ mic: true, camera: false, captureClicks: false, ...lastOptions, mode: "tab" }, tab)
    }
  } catch (error) {
    console.error(error)
  }
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "redirects" || alarm.name === "redirects-soon") void refreshRedirects().catch(() => {})
})

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("redirects", { periodInMinutes: 60 })
  void refreshRedirects().catch(() => {})
})
chrome.runtime.onStartup.addListener(() => void refreshRedirects().catch(() => {}))
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.token || changes.loomRedirects)) void refreshRedirects().catch(() => {})
})
