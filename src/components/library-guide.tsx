import { useEffect, useState } from "react"
import { CheckIcon, XIcon } from "@phosphor-icons/react"
import { Eye } from "@/components/eye"
import { CHROME_STORE_URL } from "@/lib/brand"

const WHATS_NEW = "2026-11-06"
const GUIDE_EVENT = "vertov:guide"

type Step = "copied" | "customized" | "extension"

function read(key: string) {
  try {
    return localStorage.getItem(`vertov.guide.${key}`)
  } catch {
    return null
  }
}

/** Remembers a first-run step as done. Called from the places the step happens; the guide updates without a reload. */
export function markGuide(step: Step) {
  try {
    localStorage.setItem(`vertov.guide.${step}`, "1")
  } catch {
    // Private mode: the step just won't tick off.
  }
  window.dispatchEvent(new Event(GUIDE_EVENT))
}

/** Above the library grid: a short checklist for new libraries, then a "What's new" card once that is done or hidden. */
export function LibraryGuide({ videoCount, firstReadyId }: { videoCount: number; firstReadyId: string | null }) {
  const [state, setState] = useState<{ done: Record<Step, boolean>; checklistHidden: boolean; newSeen: boolean } | null>(null)
  useEffect(() => {
    const load = () =>
      setState({
        done: { copied: read("copied") === "1", customized: read("customized") === "1", extension: read("extension") === "1" },
        checklistHidden: read("hidden") === "1",
        newSeen: read("new") === WHATS_NEW,
      })
    load()
    window.addEventListener(GUIDE_EVENT, load)
    return () => window.removeEventListener(GUIDE_EVENT, load)
  }, [])
  if (!state || videoCount === 0) return null

  const steps: Array<{ key: string; label: string; hint: string; done: boolean; href?: string; external?: boolean; onClick?: () => void }> = [
    { key: "record", label: "Record your first video", hint: "Screen, camera or both.", done: true },
    { key: "copied", label: "Copy its link and send it", hint: "Use Copy link on the video.", done: state.done.copied },
    {
      key: "customized",
      label: "Make the camera yours",
      hint: "Move it, resize it, change its shape.",
      done: state.done.customized,
      href: firstReadyId ? `/${firstReadyId}?panel=customize` : undefined,
    },
    {
      key: "extension",
      label: "Add the Chrome extension",
      hint: "Record from any tab in one click.",
      done: state.done.extension,
      href: CHROME_STORE_URL,
      external: true,
      onClick: () => markGuide("extension"),
    },
  ]
  const finished = steps.filter((step) => step.done).length
  const showChecklist = !state.checklistHidden && finished < steps.length && videoCount < 3

  if (showChecklist) {
    return (
      <aside className="library-guide" aria-label="Getting started">
        <div className="library-guide-head">
          <span className="library-next-eye"><Eye size={36} tone="paper" /></span>
          <span className="flex-1">
            <strong className="block text-sm font-semibold text-neutral-800">Your first reel</strong>
            <span className="block text-xs text-neutral-500">{finished} of {steps.length} done</span>
          </span>
          <button
            type="button"
            aria-label="Hide getting started"
            onClick={() => {
              try { localStorage.setItem("vertov.guide.hidden", "1") } catch { /* see markGuide */ }
              window.dispatchEvent(new Event(GUIDE_EVENT))
            }}
            className="rounded-md p-1 text-neutral-500 hover:bg-white"
          >
            <XIcon size={14} />
          </button>
        </div>
        <ol className="library-guide-steps">
          {steps.map((step) => {
            const body = (
              <>
                <span className={`library-guide-tick ${step.done ? "is-done" : ""}`} aria-hidden="true">
                  {step.done && <CheckIcon size={11} weight="bold" />}
                </span>
                <span>
                  <strong className={step.done ? "text-neutral-400 line-through" : "text-neutral-800"}>{step.label}</strong>
                  <small>{step.hint}</small>
                </span>
              </>
            )
            return (
              <li key={step.key}>
                {step.href && !step.done ? (
                  <a
                    href={step.href}
                    {...(step.external ? { target: "_blank", rel: "noreferrer" } : {})}
                    onClick={step.onClick}
                    className="library-guide-step"
                  >
                    {body}
                  </a>
                ) : (
                  <div className="library-guide-step">{body}</div>
                )}
              </li>
            )
          })}
        </ol>
      </aside>
    )
  }

  if (state.newSeen) return null
  const dismiss = () => {
    try { localStorage.setItem("vertov.guide.new", WHATS_NEW) } catch { /* see markGuide */ }
    window.dispatchEvent(new Event(GUIDE_EVENT))
  }
  const customize = firstReadyId ? `/${firstReadyId}?panel=customize` : undefined
  const items: Array<{ title: string; hint: string; href?: string }> = [
    { title: "Add a voiceover", hint: "Type a script, pick a voice, and it narrates the video in the player and in the MP4.", href: customize },
    { title: "Put the camera anywhere", hint: "Drag it, resize it, make it a portrait, or split the frame.", href: customize },
    { title: "Download with your layout", hint: "Open a video and press Download: the MP4 comes with the camera and cuts built in.", href: firstReadyId ? `/${firstReadyId}` : undefined },
    { title: "Ask Claude about a video", hint: "Connect Vertov so Claude or ChatGPT can read and search your recordings.", href: "/docs/mcp" },
  ]
  return (
    <aside className="library-guide" aria-label="What's new">
      <div className="library-guide-head">
        <span className="library-next-eye"><Eye size={36} tone="paper" /></span>
        <span className="flex-1">
          <strong className="block text-sm font-semibold text-neutral-800">New in the reel</strong>
          <span className="block text-xs text-neutral-500">A few things that just landed.</span>
        </span>
        <button type="button" aria-label="Dismiss what's new" onClick={dismiss} className="rounded-md p-1 text-neutral-500 hover:bg-white">
          <XIcon size={14} />
        </button>
      </div>
      <ul className="library-guide-steps">
        {items.map((item) => (
          <li key={item.title}>
            {item.href ? (
              <a href={item.href} className="library-guide-step">
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.hint}</small>
                  <small className="mt-0.5 font-semibold text-red-600">Try it →</small>
                </span>
              </a>
            ) : (
              <div className="library-guide-step">
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.hint}</small>
                </span>
              </div>
            )}
          </li>
        ))}
      </ul>
    </aside>
  )
}
