import { CaptionTranslations } from "@/components/caption-translations"
import { WatchHow } from "@/components/tutorial-row"
import { VoiceoverPanel } from "@/components/voiceover"
import { useCursorTrack } from "@/components/cursor-layer"
import { ZoomEditor } from "@/components/zoom-editor"
import { CURSOR_ART, CURSOR_FX, CURSOR_STYLES, DEFAULT_CURSOR } from "@/lib/cursor"
import type { ZoomFocusPicker } from "@/components/zoom-editor"
import { VertovIcon } from "@/components/vertov-icon"
import { useEffect, useRef, useState } from "react"
import type { BubbleShape, CameraSide, StageLayout, StageStyle } from "@/lib/stage"
import type { CaptionStyle } from "@/lib/caption-styles"
import { CAPTION_STYLES } from "@/lib/caption-styles"
import { makeAnimatedThumbnail } from "@/lib/gif"
import { BACKGROUNDS, BUBBLE_SIZES, SCALE_RANGE, SPLIT_RANGE } from "@/lib/stage"
import { formatDuration } from "@/lib/format"
import { HOSTED_EDITION } from "@/lib/edition"

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
  searchIndexing: boolean
  /** Link sharing (not members-only); search indexing needs it. */
  openLink: boolean
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
  { value: "split", label: "Split", needsCamera: true },
  { value: "screen", label: "Screen only", needsCamera: false },
  { value: "camera", label: "Camera only", needsCamera: true },
]

const SHAPES: Array<{ value: BubbleShape; label: string }> = [
  { value: "circle", label: "Circle" },
  { value: "rounded", label: "Rounded" },
  { value: "portrait", label: "Portrait" },
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
  hasVoiceover,
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
  hasVoiceover: boolean
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

  // Sliders preview every step and save once, when let go.
  function previewStyle(patch: Partial<StageStyle>) {
    onChange({ ...state, style: { ...state.style, ...patch } })
  }

  async function setTrim(patch: { trimStart?: number | null; trimEnd?: number | null }) {
    const next = { ...state, ...patch }
    if (await save(patch)) onChange(next)
  }

  async function useFrameAsThumbnail() {
    const frame = await getFrame()
    if (!frame) return onNotify("Couldn't grab this frame", "error")
    const response = await fetch(`/api/recordings/${uploadId}/sidecar?kind=poster&source=custom`, {
      method: "PUT",
      headers: { "content-type": "image/jpeg" },
      body: frame,
    }).catch(() => null)
    onNotify(response?.ok ? "Thumbnail updated" : "Couldn't save the thumbnail", response?.ok ? undefined : "error")
  }

  const [makingAiCover, setMakingAiCover] = useState(false)
  async function makeAiCover() {
    setMakingAiCover(true)
    const response = await fetch(`/api/recordings/${uploadId}/ai-cover`, { method: "POST" }).catch(() => null)
    setMakingAiCover(false)
    const body = (await response?.json().catch(() => null)) as { error?: string } | null
    onNotify(response?.ok ? "AI cover made. It shows in your library and link previews" : (body?.error ?? "Couldn't make the cover"), response?.ok ? undefined : "error")
  }

  const [pickingPoster, setPickingPoster] = useState(false)
  async function pickThumbnail() {
    setPickingPoster(true)
    const response = await fetch(`/api/recordings/${uploadId}/poster`, { method: "POST" }).catch(() => null)
    setPickingPoster(false)
    onNotify(response?.ok ? "Thumbnail picked. It shows in your library and link previews" : "Couldn't pick a thumbnail", response?.ok ? undefined : "error")
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
  const cursorTrack = useCursorTrack(HOSTED_EDITION ? `/api/cursor/${uploadId}` : undefined)
  const cursor = state.style.cursor

  return (
    <section className="pop-in mt-4 rounded-xl border border-neutral-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-900">Customize</h2>
        <span className="inline-flex items-center gap-1 text-xs text-neutral-400">
          {saving === "saved" && <VertovIcon name="check" size={14} />}
          {saving === "saving" ? "Saving…" : saving === "saved" ? "Saved" : "Changes save automatically"}
        </span>
      </div>

      {HOSTED_EDITION && <label className="mt-4 flex gap-2 text-sm"><input type="checkbox" checked={Boolean(state.style.denoise)} onChange={(event) => setStyle({ denoise: event.target.checked })} /> Reduce background noise in MP4 exports</label>}
      {HOSTED_EDITION && <VoiceoverPanel uploadId={uploadId} currentTime={currentTime} hasVoiceover={hasVoiceover} />}
      {HOSTED_EDITION && <ZoomEditor uploadId={uploadId} points={state.style.zooms ?? []} currentTime={currentTime} duration={duration} onChange={(zooms) => setStyle({ zooms })} onSeek={onSeek} onPickFocus={onPickZoomFocus} screenVisible={!hasCamera || state.style.layout !== "camera"} />}
      {HOSTED_EDITION && cursorTrack && (
        <div className="mt-4 rounded-lg border border-neutral-200 p-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-neutral-900">Cursor</span>
            <label className="flex items-center gap-2 text-xs text-neutral-600"><input type="checkbox" checked={Boolean(cursor)} onChange={(event) => setStyle({ cursor: event.target.checked ? DEFAULT_CURSOR : undefined })} /> Show in video</label>
          </div>
          {cursor && (
            <div className="mt-3 grid gap-3">
              <div className="flex flex-wrap gap-1.5">
                {CURSOR_STYLES.map((name) => (
                  <button key={name} type="button" aria-label={CURSOR_ART[name].label} title={CURSOR_ART[name].label} onClick={() => setStyle({ cursor: { ...cursor, style: name } })} className={`grid size-11 place-items-center rounded-lg border bg-neutral-800 ${cursor.style === name ? "border-red-600 ring-2 ring-red-600/30" : "border-neutral-200"}`}>
                    <svg viewBox="0 0 128 128" width="30" height="30" dangerouslySetInnerHTML={{ __html: CURSOR_ART[name].idle }} />
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                {(["S", "M", "L", "XL"] as const).map((label, index) => <Chip key={label} active={cursor.size === index} onClick={() => setStyle({ cursor: { ...cursor, size: index as 0 | 1 | 2 | 3 } })}>{label}</Chip>)}
                <span className="mx-1 text-neutral-300">|</span>
                {CURSOR_FX.map((name) => <Chip key={name} active={cursor.fx === name} onClick={() => setStyle({ cursor: { ...cursor, fx: name } })}>{name === "none" ? "No click effect" : name === "ring" ? "Ring" : "Pulse"}</Chip>)}
              </div>
              <div className="flex flex-wrap gap-4 text-xs text-neutral-700">
                <label className="flex gap-1.5"><input type="checkbox" checked={cursor.smooth} onChange={(event) => setStyle({ cursor: { ...cursor, smooth: event.target.checked } })} /> Smooth motion</label>
                <label className="flex gap-1.5"><input type="checkbox" checked={cursor.idle} onChange={(event) => setStyle({ cursor: { ...cursor, idle: event.target.checked } })} /> Hide when idle</label>
                <label className="flex gap-1.5"><input type="checkbox" checked={cursor.spot} onChange={(event) => setStyle({ cursor: { ...cursor, spot: event.target.checked } })} /> Spotlight</label>
              </div>
            </div>
          )}
        </div>
      )}
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
            <p className="mt-1.5 text-xs text-neutral-500">Drag the camera anywhere on the video, and drag its corner handle to resize it.</p>
          )}
          {hasCamera && (state.style.layout === "side" || state.style.layout === "split") && (
            <p className="mt-1.5 text-xs text-neutral-500">Drag the camera on the video to move it to the other side.</p>
          )}
          {!hasCamera && (
            <p className="mt-1.5 text-xs text-neutral-500">Record with your camera on to get bubble and side-by-side layouts.</p>
          )}
        </Field>

        {hasCamera && state.style.layout === "bubble" && (
          <Field label="Camera">
            <div className="flex flex-wrap gap-1.5">
              {SHAPES.map(({ value, label }) => (
                <Chip key={value} active={state.style.shape === value} onClick={() => setStyle({ shape: value })}>
                  <ShapeIcon shape={value} /> {label}
                </Chip>
              ))}
            </div>
            <label className="mt-3 flex items-center gap-3 text-xs text-neutral-600">
              Size
              <input
                type="range"
                min={SCALE_RANGE.min}
                max={SCALE_RANGE.max}
                step={0.005}
                value={state.style.scale ?? BUBBLE_SIZES[state.style.size]}
                onChange={(event) => previewStyle({ scale: Number(event.target.value) })}
                onPointerUp={(event) => setStyle({ scale: Number(event.currentTarget.value) })}
                onKeyUp={(event) => setStyle({ scale: Number(event.currentTarget.value) })}
                className="flex-1"
                aria-label="Camera size"
              />
            </label>
            {(state.style.x !== undefined || state.style.scale !== undefined) && (
              <button
                type="button"
                onClick={() => setStyle({ x: undefined, y: undefined, scale: undefined })}
                className="mt-2 text-xs font-medium text-neutral-500 underline-offset-2 hover:text-neutral-900 hover:underline"
              >
                Reset size and position
              </button>
            )}
          </Field>
        )}

        {hasCamera && (state.style.layout === "side" || state.style.layout === "split") && (
          <Field label="Camera">
            <div className="flex flex-wrap gap-1.5">
              {(["left", "right"] as Array<CameraSide>).map((side) => (
                <Chip key={side} active={(state.style.side ?? "right") === side} onClick={() => setStyle({ side })}>
                  {side === "left" ? "On the left" : "On the right"}
                </Chip>
              ))}
            </div>
            {state.style.layout === "split" && (
              <label className="mt-3 flex items-center gap-3 text-xs text-neutral-600">
                Width
                <input
                  type="range"
                  min={SPLIT_RANGE.min}
                  max={SPLIT_RANGE.max}
                  step={0.01}
                  value={state.style.split ?? SPLIT_RANGE.default}
                  onChange={(event) => previewStyle({ split: Number(event.target.value) })}
                  onPointerUp={(event) => setStyle({ split: Number(event.currentTarget.value) })}
                  onKeyUp={(event) => setStyle({ split: Number(event.currentTarget.value) })}
                  className="flex-1"
                  aria-label="Camera width"
                />
              </label>
            )}
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

        {HOSTED_EDITION && (
          <Field label="Intro & outro">
            <BookendPicker uploadId={uploadId} intro={state.style.intro} outro={state.style.outro} onPick={(patch) => setStyle(patch)} />
          </Field>
        )}

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

        <Field label="Button at the end" tutorial="cta">
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
            {HOSTED_EDITION && (
            <Chip
              active={state.searchIndexing}
              onClick={() => {
                const searchIndexing = !state.searchIndexing
                onChange({ ...state, searchIndexing })
                void save({ searchIndexing })
              }}
            >
              <VertovIcon name="search" size={14} /> {state.searchIndexing ? "Shown in Google search" : "Hidden from search"}
            </Chip>
            )}
            {HOSTED_EDITION && state.searchIndexing && (!state.openLink || state.hasPassword || state.expiresAt || state.requireEmail) && (
              <p className="text-xs text-neutral-500">Search engines only see videos anyone with the link can watch, with no password, expiry or email gate.</p>
            )}
          </div>
        </Field>

        <Field label="Subtitles & captions" tutorial="captions">
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
            <Chip onClick={() => void pickThumbnail()}><VertovIcon name="image" size={14} /> {pickingPoster ? "Picking…" : "Pick a thumbnail for me"}</Chip>
            {HOSTED_EDITION && <Chip onClick={() => void makeAiCover()}><VertovIcon name="image" size={14} /> {makingAiCover ? "Making the cover…" : "Make an AI cover"}</Chip>}
            {HOSTED_EDITION && <Chip onClick={() => void makeGif()}><VertovIcon name="film" size={14} /> {makingGif ? "Making GIF…" : "Animated thumbnail for email"}</Chip>}
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

/** Pick other videos to join before and after this one in MP4 downloads; the same clip can open every video. */
function BookendPicker({ uploadId, intro, outro, onPick }: { uploadId: string; intro?: string; outro?: string; onPick: (patch: Partial<StageStyle>) => void }) {
  const [videos, setVideos] = useState<Array<{ id: string; title: string | null }> | null>(null)
  useEffect(() => {
    void fetch("/api/v1/videos")
      .then((response) => response.json() as Promise<{ videos?: Array<{ id: string; title: string | null; status: string }> }>)
      .then((body) => setVideos((body.videos ?? []).filter((video) => video.id !== uploadId && video.status === "ready")), () => setVideos([]))
  }, [uploadId])
  const select = (which: "intro" | "outro", value: string | undefined) => (
    <label className="block text-xs text-neutral-600">
      {which === "intro" ? "Before" : "After"}
      <select
        value={value ?? ""}
        disabled={videos === null}
        onChange={(event) => onPick({ [which]: event.target.value || undefined })}
        className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-sm text-neutral-900"
      >
        <option value="">None</option>
        {(videos ?? []).map((video) => (
          <option key={video.id} value={video.id}>
            {video.title?.trim() || "Untitled video"}
          </option>
        ))}
        {value && videos && !videos.some((video) => video.id === value) && <option value={value}>Chosen clip</option>}
      </select>
    </label>
  )
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        {select("intro", intro)}
        {select("outro", outro)}
      </div>
      <p className="mt-1.5 text-xs text-neutral-500">Joined around this video in MP4 downloads. Record an intro once and use it on any video.</p>
    </>
  )
}

function Field({ label, tutorial, children }: { label: string; tutorial?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="text-xs font-medium tracking-wide text-neutral-500 uppercase">{label}</p>
        {tutorial && <WatchHow slug={tutorial} />}
      </div>
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
      {layout === "bubble" && <rect x="1" y="1" width="18" height="12" rx="1.5" fill="currentColor" opacity="0.35" />}
      {layout === "screen" && <rect x="1" y="1" width="18" height="12" rx="1.5" fill="currentColor" opacity="0.35" />}
      {layout === "side" && <rect x="1" y="1" width="12" height="12" rx="1.5" fill="currentColor" opacity="0.35" />}
      {layout === "split" && <rect x="1" y="2.5" width="11" height="9" rx="1.2" fill="currentColor" opacity="0.35" />}
      {layout === "bubble" && <circle cx="5" cy="9.5" r="2.6" fill="currentColor" />}
      {layout === "side" && <rect x="14" y="3" width="5" height="8" rx="1.2" fill="currentColor" />}
      {layout === "split" && <rect x="13" y="0" width="7" height="14" fill="currentColor" />}
      {layout === "camera" && <rect x="1" y="1" width="18" height="12" rx="1.5" fill="currentColor" />}
    </svg>
  )
}

function ShapeIcon({ shape }: { shape: BubbleShape }) {
  return (
    <svg viewBox="0 0 14 14" className="size-3.5" aria-hidden>
      {shape === "circle" && <circle cx="7" cy="7" r="5.5" fill="currentColor" />}
      {shape === "rounded" && <rect x="1.5" y="1.5" width="11" height="11" rx="3" fill="currentColor" />}
      {shape === "portrait" && <rect x="3" y="0.5" width="8" height="13" rx="2.2" fill="currentColor" />}
    </svg>
  )
}
