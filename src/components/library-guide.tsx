import { useEffect, useState } from "react"
import { CheckIcon, XIcon } from "@phosphor-icons/react"
import { Eye } from "@/components/eye"
import { CHROME_STORE_URL } from "@/lib/brand"
import { useT } from "@/lib/i18n/react"

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

/** Above the library grid: a short checklist for new libraries, nothing once that is done or hidden. */
export function LibraryGuide({ videoCount, firstReadyId }: { videoCount: number; firstReadyId: string | null }) {
  const t = useT()
  const [state, setState] = useState<{ done: Record<Step, boolean>; checklistHidden: boolean } | null>(null)
  useEffect(() => {
    const load = () =>
      setState({
        done: { copied: read("copied") === "1", customized: read("customized") === "1", extension: read("extension") === "1" },
        checklistHidden: read("hidden") === "1",
      })
    load()
    window.addEventListener(GUIDE_EVENT, load)
    return () => window.removeEventListener(GUIDE_EVENT, load)
  }, [])
  if (!state || videoCount === 0) return null

  const steps: Array<{ key: string; label: string; hint: string; done: boolean; href?: string; external?: boolean; onClick?: () => void }> = [
    { key: "record", label: t("library.guide.recordTitle"), hint: t("library.guide.recordHint"), done: true },
    { key: "copied", label: t("library.guide.copyTitle"), hint: t("library.guide.copyHint"), done: state.done.copied },
    {
      key: "customized",
      label: t("library.guide.cameraTitle"),
      hint: t("library.guide.cameraHint"),
      done: state.done.customized,
      href: firstReadyId ? `/${firstReadyId}?panel=customize` : undefined,
    },
    {
      key: "extension",
      label: t("library.guide.extensionTitle"),
      hint: t("library.guide.extensionHint"),
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
      <aside className="library-guide" aria-label={t("library.guide.label")}>
        <div className="library-guide-head">
          <span className="library-next-eye"><Eye size={36} tone="paper" /></span>
          <span className="flex-1">
            <strong className="block text-sm font-semibold text-neutral-800">{t("library.guide.title")}</strong>
            <span className="block text-xs text-neutral-500">{t("library.guide.progress", { done: finished, total: steps.length })}</span>
          </span>
          <button
            type="button"
            aria-label={t("library.guide.hide")}
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

  // The release-notes card that used to follow the checklist is gone: it sent people off the library to other pages.
  return null
}
