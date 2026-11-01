import { NAME } from "./brand.js"

// The site's /connect-extension page sends the API key here in the URL fragment, which never leaves the browser.
const params = new URLSearchParams(location.hash.slice(1))
const server = params.get("server")
const token = params.get("token")
const workspace = params.get("workspace")
history.replaceState(null, "", location.pathname)

const title = document.getElementById("title")
const detail = document.getElementById("detail")
if (server && token && /^rk_[a-f0-9]{40}$/.test(token)) {
  await chrome.storage.local.set({ server: new URL(server).origin, token, workspace })
  title.textContent = `Connected to ${NAME}`
  detail.textContent = `Recordings go to ${workspace || "your workspace"}. Click the ${NAME} icon in the toolbar to record. You can close this tab.`
} else {
  title.textContent = "That didn't work"
  detail.textContent = `Open the ${NAME} extension and click Connect again.`
}
