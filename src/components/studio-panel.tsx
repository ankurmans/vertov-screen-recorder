import { CaptionTranslations } from "@/components/caption-translations"
import { ZoomEditor } from "@/components/zoom-editor"
import type { ZoomFocusPicker } from "@/components/zoom-editor"
import { VertovIcon } from "@/components/vertov-icon"
import { useEffect, useRef, useState } from "react"
import type { BubbleShape, BubbleSize, StageLayout, StageStyle } from "@/lib/stage"
import type { CaptionStyle } from "@/lib/caption-styles"
import { CAPTION_STYLES } from "@/lib/caption-styles"
import { makeAnimatedThumbnail } from "@/lib/gif"
import { BACKGROUNDS } from "@/lib/stage"
import { formatDuration } from "@/lib/format"

export interface StudioState {
  style: StageStyle
  trimStart: number | null
  trimEnd: number | null
  ctaLabel: string | null
  ctaUrl: string | null
  socialEnabled: boolean
  hasPassword: boolean
  expiresAt: string | null
  downloadsEnabled: boolean
  requireEmail: boolean
  captionStyle: CaptionStyle
}

const EXPIRY_OPTIONS = [
  { label: "Never", days: 0 },
  { label: "1 day", days: 1 },
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
] as const

const LAYOUTS: Array<{ value: StageLayout; label: string; needsCamera: boolean }> = [
  { value: "bubble", label: "Bubble", needsCamera: true },
  { value: "side", label: "Side by side", needsCamera: true },
  { value: "screen", label: "Screen only", needsCamera: false },
  { value: "camera", label: "Camera only", needsCamera: true },
]

/**
 * The owner's edit panel under the video. Every change previews instantly
 * and saves on its own; nothing re-renders the video file.
 */
export function StudioPanel({
  uploadId,
  state,
  onChange,
  hasCamera,
  currentTime,
  duration,
  getFrame,
  mediaSource,
  hasTranscript,
  onNotify,
  onSeek,
  onPickZoomFocus,
}: {
  uploadId: string
  state: StudioState
  onChange: (next: StudioState) => void
  hasCamera: boolean
  currentTime: number
  duration: number
  /** Grabs the current frame of the player as a JPEG, for the thumbnail. */
  getFrame: () => Promise<Blob | null>
  /** The video file's URL, sampled for the animated thumbnail. */
  mediaSource: string
  hasTranscript: boolean
  onNotify: (message: string, variant?: "error") => void
  onSeek: (time: number) => void
  onPickZoomFocus: (picker: ZoomFocusPicker) => void
}) {
  const [saving, setSaving] = useState<"idle" | "saving" | "saved">("idle")
  const [ctaLabel, setCtaLabel] = useState(state.ctaLabel ?? "")
  const [ctaUrl, setCtaUrl] = useState(state.ctaUrl ?? "")
  const [password, setPassword] = useState("")
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const styleWrites = useRef<Promise<unknown>>(Promise.resolve())

  useEffect(() => () => clearTimeout(timer.current), [])

  async function save(patch: Record<string, unknown>) {
    setSaving("saving")
    const response = await fetch(`/api/recordings/${uploadId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    }).catch(() => null)
    if (!response?.ok) {
      const body = response
        ? ((await response.json().catch(() => ({}))) as { error?: string })
        : {}
      onNotify(body.error ?? "Couldn't save that change", "error")
      setSaving("idle")
      return false
    }
    setSaving("saved")
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setSaving("idle"), 1600)
    return true
  }

  function setStyle(patch: Partial<StageStyle>) {
    const style = { ...state.style, ...patch }
    onChange({ ...state, style })
    styleWrites.current = styleWrites.current.then(() => save({ style }))
  }

  async function setTrim(patch: { trimStart?: number | null; trimEnd?: number | null }) {
    const next = { ...state, ...patch }
    if (await save(patch)) onChange(next)
  }

  async function useFrameAsThumbnail() {
    const frame = await getFrame()
    if (!frame) return onNotify("Couldn't grab this frame", "error")
    const response = await fetch(`/api/recordings/${uploadId}/sidecar?kind=poster`, {
      method: "PUT",
      headers: { "content-type": "image/jpeg" },
      body: frame,
    }).catch(() => null)
    onNotify(response?.ok ? "Thumbnail updated" : "Couldn't save the thumbnail", response?.ok ? undefined : "error")
  }

  const [makingGif, setMakingGif] = useState(false)
  async function makeGif() {
    setMakingGif(true)
    try {
      const from = Math.max(state.trimStart ?? 0, 0) + 0.5
      const blob = await makeAnimatedThumbnail(mediaSource, from, from + 6)
      const response = await fetch(`/api/recordings/${uploadId}/sidecar?kind=gif`, {
        method: "PUT",
        headers: { "content-type": "image/gif" },
        body: blob,
      })
      onNotify(response.ok ? "Animated thumbnail saved. \"Copy for email\" now uses it" : "Couldn't save the animated thumbnail", response.ok ? undefined : "error")
    } catch {
      onNotify("Couldn't make the animated thumbnail", "error")
    } finally {
      setMakingGif(false)
    }
  }

  const at = Math.round(currentTime * 10) / 10

  return (
    <section className="pop-in mt-4 rounded-xl border border-neutral-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-900">Customize</h2>
        <span className="inline-flex items-center gap-1 text-xs text-neutral-400">
          {saving === "saved" && <VertovIcon name="check" size={14} />}
          {saving === "saving" ? "Saving…" : saving === "saved" ? "Saved" : "Changes save automatically"}
        </span>
      </div>

      <label className="mt-4 flex gap-2 text-sm"><input type="checkbox" checked={Boolean(state.style.denoise)} onChange={(event) => setStyle({ denoise: event.target.checked })} /> Reduce background noise in MP4 exports</label>
      <ZoomEditor uploadId={uploadId} points={state.style.zooms ?? []} currentTime={currentTime} duration={duration} onChange={(zooms) => setStyle({ zooms })} onSeek={onSeek} onPickFocus={onPickZoomFocus} screenVisible={!hasCamera || state.style.layout !== "camera"} />
      <div className="mt-4 grid gap-5 md:grid-cols-2">
        <Field label="Layout">
          <div className="flex flex-wrap gap-1.5">
            {LAYOUTS.filter((layout) => hasCamera || !layout.needsCamera).map((layout) => (
              <Chip
                key={layout.value}
                active={(hasCamera ? state.style.layout : "screen") === layout.value}
                onClick={() => setStyle({ layout: layout.value })}
              >
                <LayoutIcon layout={layout.value} /> {layout.label}
              </Chip>
            ))}
          </div>
          {hasCamera && state.style.layout === "bubble" && (
            <p className="mt-1.5 text-xs text-neutral-500">Drag the bubble on the video to move it.</p>
          )}
          {!hasCamera && (
            <p className="mt-1.5 text-xs text-neutral-500">Record with your camera on to get bubble and side-by-side layouts.</p>
          )}
        </Field>

        {hasCamera && state.style.layout === "bubble" && (
          <Field label="Camera">
            <div className="flex flex-wrap gap-1.5">
              {(["s", "m", "l"] as Array<BubbleSize>).map((size) => (
                  <Chip key={size} active={state.style.size === size} onClick={() => setStyle({ size })}>
                    {size.toUpperCase()}
                  </Chip>
                ))}
              {(["circle", "rounded"] as Array<BubbleShape>).map((shape) => (
                <Chip key={shape} active={state.style.shape === shape} onClick={() => setStyle({ shape })}>
                    <VertovIcon name={shape} size={14} /> {shape === "circle" ? "Circle" : "Rounded"}
                </Chip>
              ))}
            </div>
          </Field>
        )}

        <Field label="Background">
          <div className="flex flex-wrap gap-2">
            {Object.entries(BACKGROUNDS).map(([key, background]) => (
              <button
                key={key}
                type="button"
                title={background.label}
                onClick={() => setStyle({ background: key })}
                className={`size-8 rounded-full ring-offset-2 transition-transform hover:scale-110 ${
                  state.style.background === key ? "ring-2 ring-indigo-600" : "ring-1 ring-neutral-200"
                }`}
                style={{ background: key === "none" ? "repeating-conic-gradient(#e5e5e5 0 25%,#fff 0 50%) 0 0/10px 10px" : background.css }}
              />
            ))}
          </div>
        </Field>

        <Field label="Trim">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <Chip onClick={() => void setTrim({ trimStart: at > 0.2 ? at : null })}>Start at {formatDuration(at)}</Chip>
            <Chip onClick={() => void setTrim({ trimEnd: at < duration - 0.2 ? at : null })}>End at {formatDuration(at)}</Chip>
            {(state.trimStart != null || state.trimEnd != null) && (
              <Chip onClick={() => void setTrim({ trimStart: null, trimEnd: null })}>Reset</Chip>
            )}
          </div>
          <p className="mt-1.5 text-xs text-neutral-500">
            Plays {formatDuration(state.trimStart ?? 0)} → {formatDuration(state.trimEnd ?? duration)}. Pause where you want to cut, then click.
          </p>
        </Field>

        <Field label="Button at the end">
          <form
            className="flex flex-wrap gap-1.5"
            onSubmit={(event) => {
              event.preventDefault()
              void save({ ctaLabel: ctaLabel || null, ctaUrl: ctaUrl || null }).then((ok) => {
                if (ok) onChange({ ...state, ctaLabel: ctaLabel && ctaUrl ? ctaLabel : null, ctaUrl: ctaLabel && ctaUrl ? (/^https?:\/\//i.test(ctaUrl) ? ctaUrl : `https://${ctaUrl}`) : null })
              })
            }}
          >
            <input
              value={ctaLabel}
              onChange={(event) => setCtaLabel(event.target.value)}
              placeholder="Book a call"
              maxLength={40}
              className="w-32 rounded-lg border border-neutral-300 px-2 py-1 text-sm"
            />
            <input
              value={ctaUrl}
              onChange={(event) => setCtaUrl(event.target.value)}
              placeholder="cal.com/you"
              className="min-w-0 flex-1 rounded-lg border border-neutral-300 px-2 py-1 text-sm"
            />
            <button type="submit" className="rounded-lg bg-neutral-900 px-3 py-1 text-sm font-medium text-white hover:bg-neutral-700">
              Save
            </button>
          </form>
        </Field>

        <Field label="Who can watch">
          <div className="space-y-2.5">
            {state.hasPassword ? (
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1 font-medium text-emerald-700"><VertovIcon name="lock" size={14} /> Password on</span>
                <Chip
                  onClick={() =>
                    void save({ password: null }).then((ok) => ok && onChange({ ...state, hasPassword: false }))
                  }
                >
                  Remove password
                </Chip>
              </div>
            ) : (
              <form
                className="flex flex-wrap gap-1.5"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (password.length < 4) return onNotify("Use at least 4 characters", "error")
                  void save({ password }).then((ok) => {
                    if (!ok) return
                    setPassword("")
                    onChange({ ...state, hasPassword: true })
                    onNotify("Password set. Viewers type it once per browser.")
                  })
                }}
              >
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Add a password"
                  aria-label="Video password"
                  autoComplete="new-password"
                  className="w-40 rounded-lg border border-neutral-300 px-2 py-1 text-sm"
                />
                <button type="submit" className="rounded-lg bg-neutral-900 px-3 py-1 text-sm font-medium text-white hover:bg-neutral-700">
                  Set
                </button>
              </form>
            )}
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-neutral-500">Link expires</span>
              {EXPIRY_OPTIONS.map((option) => {
                const active =
                  option.days === 0
                    ? !state.expiresAt
                    : Boolean(state.expiresAt) && Math.round((Date.parse(state.expiresAt!) - Date.now()) / 86_400_000) === option.days
                return (
                  <Chip
                    key={option.label}
                    active={active}
                    onClick={() => {
                      const expiresAt = option.days ? new Date(Date.now() + option.days * 86_400_000).toISOString() : null
                      void save({ expiresAt }).then((ok) => ok && onChange({ ...state, expiresAt }))
                    }}
                  >
                    {option.label}
                  </Chip>
                )
              })}
            </div>
            {state.expiresAt && (
              <p className="text-xs text-neutral-500">
                Expires {new Date(state.expiresAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}. You can still open it.
              </p>
            )}
            <Chip
              active={state.downloadsEnabled}
              onClick={() => {
                const downloadsEnabled = !state.downloadsEnabled
                onChange({ ...state, downloadsEnabled })
                void save({ downloadsEnabled })
              }}
            >
              <VertovIcon name="download" size={14} /> {state.downloadsEnabled ? "Viewers can download" : "Downloads off"}
            </Chip>
            <Chip
              active={state.requireEmail}
              onClick={() => {
                const requireEmail = !state.requireEmail
                onChange({ ...state, requireEmail })
                void save({ requireEmail })
              }}
            >
              <VertovIcon name="mail" size={14} /> {state.requireEmail ? "Viewers give their email" : "Ask viewers for email"}
            </Chip>
          </div>
        </Field>

        <Field label="Subtitles & captions">
          {hasTranscript ? <>
            <div className="flex flex-wrap gap-1.5">
              {CAPTION_STYLES.map((option) => (
                <Chip
                  key={option.value}
                  active={state.captionStyle === option.value}
                  onClick={() => {
                    onChange({ ...state, captionStyle: option.value })
                    void save({ captionStyle: option.value })
                  }}
                >
                  <VertovIcon name="subtitles" size={14} />
                  {option.label}
                </Chip>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-neutral-500">{CAPTION_STYLES.find((option) => option.value === state.captionStyle)?.hint}</p>
            <CaptionTranslations uploadId={uploadId} />
          </> : <p className="text-xs text-neutral-500">Auto subtitles become available after speech is transcribed. Silent recordings don’t have a subtitle track.</p>}
        </Field>

        <Field label="More">
          <div className="flex flex-wrap gap-1.5">
            <Chip onClick={() => void useFrameAsThumbnail()}><VertovIcon name="image" size={14} /> Use this frame as thumbnail</Chip>
            <Chip onClick={() => void makeGif()}><VertovIcon name="film" size={14} /> {makingGif ? "Making GIF…" : "Animated thumbnail for email"}</Chip>
            <Chip
              active={state.socialEnabled}
              onClick={() => {
                const socialEnabled = !state.socialEnabled
                onChange({ ...state, socialEnabled })
                void save({ socialEnabled })
              }}
            >
              <VertovIcon name="comment" size={14} /> {state.socialEnabled ? "Comments on" : "Comments off"}
            </Chip>
          </div>
        </Field>
      </div>
    </section>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium tracking-wide text-neutral-500 uppercase">{label}</p>
      {children}
    </div>
  )
}

function Chip({
  active,
  onClick,
  children,
}: {
  active?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
        active
          ? "border-[var(--brand-accent,#de2b14)] bg-neutral-50 text-[var(--brand-accent,#de2b14)]"
          : "border-neutral-200 text-neutral-700 hover:bg-neutral-50"
      }`}
    >
      {children}
    </button>
  )
}

function LayoutIcon({ layout }: { layout: StageLayout }) {
  return (
    <svg viewBox="0 0 20 14" className="h-3 w-4" aria-hidden>
      {layout !== "camera" && (
        <rect
          x={layout === "side" ? 1 : 1}
          y="1"
          width={layout === "side" ? 12 : 18}
          height="12"
          rx="1.5"
          fill="currentColor"
          opacity="0.35"
        />
      )}
      {layout === "bubble" && <circle cx="5" cy="9.5" r="2.6" fill="currentColor" />}
      {layout === "side" && <rect x="14" y="3" width="5" height="8" rx="1.2" fill="currentColor" />}
      {layout === "camera" && <rect x="1" y="1" width="18" height="12" rx="1.5" fill="currentColor" />}
    </svg>
  )
}
