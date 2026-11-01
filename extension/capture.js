// Click and page capture while a recording with "capture clicks" is running. Logs what was
// clicked (its visible label and a selector) and which page it was on, never what was typed.
(() => {
  if (window.__vertovCapture) return
  window.__vertovCapture = true

  const send = (event) => {
    try {
      chrome.runtime.sendMessage({ type: "screen-event", event: { ...event, url: location.href } }).catch(() => {})
    } catch {
      // The extension was reloaded; this page's copy of the script is orphaned.
      stop()
    }
  }

  const INTERACTIVE = "a, button, [role=button], [role=link], [role=tab], [role=menuitem], [role=checkbox], [role=option], input, select, textarea, label, summary, [onclick], [contenteditable=true]"

  function labelOf(element) {
    const aria = element.getAttribute("aria-label") || element.getAttribute("title") || element.getAttribute("alt")
    if (aria) return aria
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
      const byFor = element.id ? document.querySelector(`label[for="${CSS.escape(element.id)}"]`)?.textContent : null
      return byFor || element.getAttribute("placeholder") || element.getAttribute("name") || element.type
    }
    return (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim()
  }

  function selectorOf(element) {
    const parts = [element.tagName.toLowerCase()]
    if (element.id && !/\d{3,}/.test(element.id)) parts.push(`#${element.id}`)
    for (const name of ["data-testid", "data-test", "name", "role", "type"]) {
      const value = element.getAttribute(name)
      if (value) {
        parts.push(`[${name}="${value.slice(0, 40)}"]`)
        break
      }
    }
    const classes = [...element.classList].filter((name) => name.length < 30 && !/\d{2,}|^(css|sc|jsx)-/.test(name)).slice(0, 2)
    if (classes.length) parts.push(`.${classes.join(".")}`)
    return parts.join("")
  }

  const isSecret = (element) =>
    element instanceof HTMLInputElement && (element.type === "password" || /card|cvc|cvv|ssn|secret|token/i.test(element.name + element.autocomplete))

  function onClick(event) {
    const target = event.target instanceof Element ? event.target.closest(INTERACTIVE) || event.target : null
    if (!target || isSecret(target)) return
    send({ type: "click", text: labelOf(target).slice(0, 120), selector: selectorOf(target) })
  }

  let lastField = null
  function onInput(event) {
    const target = event.target
    if (!(target instanceof Element) || target === lastField || isSecret(target)) return
    lastField = target
    send({ type: "input", text: labelOf(target).slice(0, 120), selector: selectorOf(target) })
  }

  function stop() {
    document.removeEventListener("click", onClick, true)
    document.removeEventListener("input", onInput, true)
    window.__vertovCapture = false
  }

  document.addEventListener("click", onClick, true)
  document.addEventListener("input", onInput, true)
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "capture-off") stop()
  })
  // Only the page you're looking at; the extension injects this into every open tab at the start.
  if (document.visibilityState === "visible" && document.hasFocus()) send({ type: "page", title: document.title })
})()
