const title = document.getElementById("title")
const detail = document.getElementById("detail")
const button = document.getElementById("allow")

button.addEventListener("click", async () => {
  button.disabled = true
  const granted = []
  for (const kind of ["audio", "video"]) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ [kind]: true })
      for (const track of stream.getTracks()) track.stop()
      granted.push(kind === "audio" ? "microphone" : "camera")
    } catch {
      // Someone without a camera can still record their voice.
    }
  }
  if (granted.length) {
    title.textContent = "All set"
    detail.textContent = `The extension can use your ${granted.join(" and ")}. Close this tab and click the icon again.`
    button.hidden = true
  } else {
    title.textContent = "Chrome blocked it"
    detail.textContent = "Click the camera icon in the address bar, allow camera and microphone, then try again."
    button.disabled = false
  }
})
