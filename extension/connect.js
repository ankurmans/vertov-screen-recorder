import { NAME } from "./brand.js"
import { acceptHandoff } from "./lib/connect-binding.js"

// The site's /connect-extension page sends the API key here in the URL fragment, which never leaves the browser.
// It is stored only when the fragment carries the state of a Connect click made in the popup moments ago.
const params = new URLSearchParams(location.hash.slice(1))
history.replaceState(null, "", location.pathname)

const title = document.getElementById("title")
const detail = document.getElementById("detail")
const accepted = await acceptHandoff(chrome.storage.session, {
  server: params.get("server"),
  token: params.get("token"),
  workspace: params.get("workspace"),
  state: params.get("state"),
})
if (accepted) {
  await chrome.storage.local.set(accepted)
  title.textContent = `Connected to ${NAME}`
  detail.textContent = `Recordings go to ${accepted.workspace || "your workspace"}. Click the ${NAME} icon in the toolbar to record. You can close this tab.`
} else {
  title.textContent = "That didn't work"
  detail.textContent = `Open the ${NAME} extension and click Connect again.`
}
