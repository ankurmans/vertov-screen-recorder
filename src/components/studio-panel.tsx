import { CaptionTranslations } from "@/components/caption-translations"
import { WatchHow } from "@/components/tutorial-row"
import { ZoomEditor } from "@/components/zoom-editor"
import { TrimTimeline } from "@/components/trim-timeline"
import type { AiTextNotice } from "@/components/ai-text-notice"
import type { Cut } from "@/lib/cuts"
import { keptWindow } from "@/lib/viewer-copy"
import type { ZoomFocusPicker } from "@/components/zoom-editor"
import { VertovIcon } from "@/components/vertov-icon"
import { useEffect, useRef, useState } from "react"
import type { BubbleShape, CameraSide, StageLayout, StageStyle } from "@/lib/stage"
import type { CaptionStyle } from "@/lib/caption-styles"
import { CAPTION_STYLES } from "@/lib/caption-styles"
import { makeAnimatedThumbnail } from "@/lib/gif"
import { BACKGROUNDS, BUBBLE_SIZES, FOCUS_RANGE, SCALE_RANGE, SPLIT_RANGE } from "@/lib/stage"
import { formatDuration } from "@/lib/format"
import { HOSTED_EDITION } from "@/lib/edition"
import type { MessageKey } from "@/lib/i18n/en/index"
import { useT } from "@/lib/i18n/react"

export interface StudioState {
  style: StageStyle
  trimStart: number | null
  trimEnd: number | null
  ctaLabel: string | null
  ctaUrl: string | null
  socialEnabled: boolean
  downloadsEnabled: boolean
  requireEmail: boolean
  searchIndexing: boolean
  /** Link sharing (not members-only); search indexing needs it. */
  openLink: boolean
  captionStyle: CaptionStyle
}

const LAYOUTS: Array<{ value: StageLayout; label: MessageKey; needsCamera: boolean }> = [
  { value: "bubble", label: "video.studio.layoutBubble", needsCamera: true },
  { value: "side", label: "video.studio.layoutSide", needsCamera: true },
  { value: "split", label: "video.studio.layoutSplit", needsCamera: true },
  { value: "screen", label: "video.studio.layoutScreen", needsCamera: false },
  { value: "camera", label: "video.studio.layoutCamera", needsCamera: true },
  { value: "focus", label: "video.studio.layoutFocus", needsCamera: true },
]

const SHAPES: Array<{ value: BubbleShape; label: MessageKey }> = [
  { value: "circle", label: "video.studio.shapeCircle" },
  { value: "rounded", label: "video.studio.shapeRounded" },
  { value: "portrait", label: "video.studio.shapePortrait" },
]

// The labels in src/lib/stage.ts and caption-styles.ts stay as the fallback for an id this map does not know.
const BACKGROUND_LABELS: Record<string, MessageKey> = {
  none: "video.studio.bgNone",
  dusk: "video.studio.bgDusk",
  ocean: "video.studio.bgOcean",
  mint: "video.studio.bgMint",
  peach: "video.studio.bgPeach",
  graphite: "video.studio.bgGraphite",
  paper: "video.studio.bgPaper",
}

const CAPTION_STYLE_TEXT: Record<string, { label: MessageKey; hint: MessageKey }> = {
  off: { label: "video.studio.captionOff", hint: "video.studio.captionOffHint" },
  clean: { label: "video.studio.captionClean", hint: "video.studio.captionCleanHint" },
  bold: { label: "video.studio.captionBold", hint: "video.studio.captionBoldHint" },
  karaoke: { label: "video.studio.captionKaraoke", hint: "video.studio.captionKaraokeHint" },
}

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
  canMakeGif = true,
  hasTranscript,
  onNotify,
  onSeek,
  onPickZoomFocus,
  cuts,
  onCutsChange,
  onAiNotice,
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
  canMakeGif?: boolean
  hasTranscript: boolean
  onNotify: (message: string, variant?: "error") => void
  onSeek: (time: number) => void
  onPickZoomFocus: (picker: ZoomFocusPicker) => void
  /** Stretches removed from the video, shared with the transcript editor. */
  cuts: Array<Cut>
  onCutsChange: (next: Array<Cut>) => void
  /** What a saved trim did to the AI title, summary and chapters. */
  onAiNotice: (notice?: AiTextNotice) => void
}) {
  const t = useT()
  const [saving, setSaving] = useState<"idle" | "saving" | "saved">("idle")
  const [ctaLabel, setCtaLabel] = useState(state.ctaLabel ?? "")
  const [ctaUrl, setCtaUrl] = useState(state.ctaUrl ?? "")
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
      onNotify(body.error ?? t("video.studio.saveFailed"), "error")
      setSaving("idle")
      return false
    }
    if ("trimStart" in patch || "trimEnd" in patch) {
      const body = (await response.json().catch(() => ({}))) as { aiNotice?: AiTextNotice }
      onAiNotice(body.aiNotice)
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

  function trimHere(edge: "start" | "end") {
    const start = state.trimStart ?? 0
    const end = state.trimEnd ?? duration
    if (edge === "start") {
      if (at <= 0.2) return void setTrim({ trimStart: null })
      if (end - at < 1) return onNotify(t("video.studio.pauseEarlier"), "error")
      return void setTrim({ trimStart: at })
    }
    if (at >= duration - 0.2) return void setTrim({ trimEnd: null })
    if (at - start < 1) return onNotify(t("video.studio.pauseLater"), "error")
    void setTrim({ trimEnd: at })
  }

  async function useFrameAsThumbnail() {
    const frame = await getFrame()
    if (!frame) return onNotify(t("video.studio.frameFailed"), "error")
    const response = await fetch(`/api/recordings/${uploadId}/sidecar?kind=poster&source=custom`, {
      method: "PUT",
      headers: { "content-type": "image/jpeg" },
      body: frame,
    }).catch(() => null)
    onNotify(response?.ok ? t("video.studio.thumbnailUpdated") : t("video.studio.thumbnailSaveFailed"), response?.ok ? undefined : "error")
  }

  const [pickingPoster, setPickingPoster] = useState(false)
  async function pickThumbnail() {
    setPickingPoster(true)
    const response = await fetch(`/api/recordings/${uploadId}/poster`, { method: "POST" }).catch(() => null)
    setPickingPoster(false)
    const busy = response && (response.status === 429 || response.status === 503) ? ((await response.json().catch(() => null)) as { error?: string } | null)?.error : undefined
    onNotify(response?.ok ? t("video.studio.thumbnailPicked") : (busy ?? t("video.studio.thumbnailPickFailed")), response?.ok ? undefined : "error")
  }

  const [makingGif, setMakingGif] = useState(false)
  async function makeGif() {
    setMakingGif(true)
    try {
      // Only from footage that is kept: the thumbnail goes to viewers.
      const [from, to] = keptWindow({ trimStart: state.trimStart, trimEnd: state.trimEnd, cuts: JSON.stringify(cuts) }, duration)
      const blob = await makeAnimatedThumbnail(mediaSource, from, to)
      const response = await fetch(`/api/recordings/${uploadId}/sidecar?kind=gif`, {
        method: "PUT",
        headers: { "content-type": "image/gif" },
        body: blob,
      })
      onNotify(response.ok ? t("video.studio.gifSaved") : t("video.studio.gifSaveFailed"), response.ok ? undefined : "error")
    } catch {
      onNotify(t("video.studio.gifFailed"), "error")
    } finally {
      setMakingGif(false)
    }
  }

  const at = Math.round(currentTime * 10) / 10

  return (
    <section className="pop-in mt-4 rounded-xl border border-neutral-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-neutral-900">{t("video.action.customize")}</h2>
        <span className="inline-flex items-center gap-1 text-xs text-neutral-500">
          {saving === "saved" && <VertovIcon name="check" size={14} />}
          {saving === "saving" ? t("common.saving") : saving === "saved" ? t("common.saved") : t("video.studio.autosave")}
        </span>
      </div>


      {HOSTED_EDITION && <ZoomEditor uploadId={uploadId} points={state.style.zooms ?? []} currentTime={currentTime} duration={duration} onChange={(zooms) => setStyle({ zooms })} onSeek={onSeek} onPickFocus={onPickZoomFocus} screenVisible={!hasCamera || state.style.layout !== "camera"} />}
      <div className="mt-4 grid gap-5 md:grid-cols-2">
        <Field label={t("video.studio.layout")}>
          <div className="flex flex-wrap gap-1.5">
            {LAYOUTS.filter((layout) => hasCamera || !layout.needsCamera).map((layout) => (
              <Chip
                key={layout.value}
                active={(hasCamera ? state.style.layout : "screen") === layout.value}
                onClick={() =>
                  // Bubble size and camera-first screen size are different scales, so neither carries over to the other.
                  setStyle(layout.value === "focus" || state.style.layout === "focus" ? { layout: layout.value, scale: undefined } : { layout: layout.value })
                }
              >
                <LayoutIcon layout={layout.value} /> {t(layout.label)}
              </Chip>
            ))}
          </div>
          {hasCamera && state.style.layout === "bubble" && (
            <p className="mt-1.5 text-xs text-neutral-600">{t("video.studio.hintBubble")}</p>
          )}
          {hasCamera && (state.style.layout === "side" || state.style.layout === "split") && (
            <p className="mt-1.5 text-xs text-neutral-600">{t("video.studio.hintSide")}</p>
          )}
          {hasCamera && state.style.layout === "focus" && (
            <p className="mt-1.5 text-xs text-neutral-600">{t("video.studio.hintFocus")}</p>
          )}
          {!hasCamera && (
            <p className="mt-1.5 text-xs text-neutral-600">{t("video.studio.hintNoCamera")}</p>
          )}
        </Field>

        {hasCamera && state.style.layout === "bubble" && (
          <Field label={t("video.studio.camera")}>
            <div className="flex flex-wrap gap-1.5">
              {SHAPES.map(({ value, label }) => (
                <Chip key={value} active={state.style.shape === value} onClick={() => setStyle({ shape: value })}>
                  <ShapeIcon shape={value} /> {t(label)}
                </Chip>
              ))}
            </div>
            <label className="mt-3 flex items-center gap-3 text-xs text-neutral-600">
              {t("video.studio.size")}
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
                aria-label={t("video.studio.sizeLabel")}
              />
            </label>
            {(state.style.x !== undefined || state.style.scale !== undefined) && (
              <button
                type="button"
                onClick={() => setStyle({ x: undefined, y: undefined, scale: undefined })}
                className="mt-2 text-xs font-medium text-neutral-500 underline-offset-2 hover:text-neutral-900 hover:underline"
              >
                {t("video.studio.resetPosition")}
              </button>
            )}
          </Field>
        )}

        {hasCamera && state.style.layout === "focus" && (
          <Field label={t("video.studio.screen")}>
            <div className="flex flex-wrap gap-1.5">
              {(["left", "right"] as Array<CameraSide>).map((side) => (
                <Chip key={side} active={(state.style.side ?? "right") === side} onClick={() => setStyle({ side })}>
                  {side === "left" ? t("video.studio.onLeft") : t("video.studio.onRight")}
                </Chip>
              ))}
            </div>
            <label className="mt-3 flex items-center gap-3 text-xs text-neutral-600">
              {t("video.studio.size")}
              <input
                type="range"
                min={FOCUS_RANGE.min}
                max={FOCUS_RANGE.max}
                step={0.005}
                value={state.style.scale ?? FOCUS_RANGE.default}
                onChange={(event) => previewStyle({ scale: Number(event.target.value) })}
                onPointerUp={(event) => setStyle({ scale: Number(event.currentTarget.value) })}
                onKeyUp={(event) => setStyle({ scale: Number(event.currentTarget.value) })}
                className="flex-1"
                aria-label={t("video.studio.sizeLabel")}
              />
            </label>
          </Field>
        )}

        {hasCamera && (state.style.layout === "side" || state.style.layout === "split") && (
          <Field label={t("video.studio.camera")}>
            <div className="flex flex-wrap gap-1.5">
              {(["left", "right"] as Array<CameraSide>).map((side) => (
                <Chip key={side} active={(state.style.side ?? "right") === side} onClick={() => setStyle({ side })}>
                  {side === "left" ? t("video.studio.onLeft") : t("video.studio.onRight")}
                </Chip>
              ))}
            </div>
            {state.style.layout === "split" && (
              <label className="mt-3 flex items-center gap-3 text-xs text-neutral-600">
                {t("video.studio.width")}
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
                  aria-label={t("video.studio.widthLabel")}
                />
              </label>
            )}
          </Field>
        )}

        <Field label={t("video.studio.background")}>
          <div className="flex flex-wrap gap-2">
            {Object.entries(BACKGROUNDS).map(([key, background]) => (
              <button
                key={key}
                type="button"
                title={BACKGROUND_LABELS[key] ? t(BACKGROUND_LABELS[key]) : background.label}
                onClick={() => setStyle({ background: key })}
                className={`size-8 rounded-full ring-offset-2 transition-transform hover:scale-110 ${
                  state.style.background === key ? "ring-2 ring-neutral-900" : "ring-1 ring-neutral-200"
                }`}
                style={{ background: key === "none" ? "repeating-conic-gradient(#e5e5e5 0 25%,#fff 0 50%) 0 0/10px 10px" : background.image ? `url(/backgrounds/thumbs/${background.image}) center / cover, ${background.colors[0]}` : background.css }}
              />
            ))}
          </div>
        </Field>

        <Field label={t("video.studio.trim")}>
          <TrimTimeline
            duration={duration}
            currentTime={currentTime}
            trimStart={state.trimStart}
            trimEnd={state.trimEnd}
            cuts={cuts}
            onSeek={onSeek}
            onTrim={(patch) => void setTrim(patch)}
            onCutsChange={onCutsChange}
          />
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
            <Chip onClick={() => trimHere("start")}>{t("video.studio.startAt", { time: formatDuration(at) })}</Chip>
            <Chip onClick={() => trimHere("end")}>{t("video.studio.endAt", { time: formatDuration(at) })}</Chip>
          </div>
          <p className="mt-1.5 text-xs text-neutral-600">{t("video.studio.trimHint")}</p>
        </Field>

        <Field label={t("video.studio.cta")} tutorial="cta">
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
              placeholder={t("video.studio.ctaPlaceholder")}
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
              {t("common.save")}
            </button>
          </form>
        </Field>

        <Field label={t("video.studio.whoCanWatch")}>
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              {([["link", t("video.studio.anyoneWithLink")], ["workspace", t("video.studio.membersOnly")]] as const).map(([visibility, label]) => (
                <Chip
                  key={visibility}
                  active={state.openLink === (visibility === "link")}
                  onClick={() => void save({ visibility }).then((ok) => ok && onChange({ ...state, openLink: visibility === "link" }))}
                >
                  {label}
                </Chip>
              ))}
            </div>
            <Chip
              active={state.downloadsEnabled}
              onClick={() => {
                const downloadsEnabled = !state.downloadsEnabled
                onChange({ ...state, downloadsEnabled })
                void save({ downloadsEnabled })
              }}
            >
              <VertovIcon name="download" size={14} /> {state.downloadsEnabled ? t("video.studio.downloadsOn") : t("video.studio.downloadsOff")}
            </Chip>
            <Chip
              active={state.requireEmail}
              onClick={() => {
                const requireEmail = !state.requireEmail
                onChange({ ...state, requireEmail })
                void save({ requireEmail })
              }}
            >
              <VertovIcon name="mail" size={14} /> {state.requireEmail ? t("video.studio.emailOn") : t("video.studio.emailOff")}
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
              <VertovIcon name="search" size={14} /> {state.searchIndexing ? t("video.studio.searchOn") : t("video.studio.searchOff")}
            </Chip>
            )}
          </div>
        </Field>

        <Field label={t("video.studio.captions")} tutorial="captions">
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
                  {CAPTION_STYLE_TEXT[option.value] ? t(CAPTION_STYLE_TEXT[option.value].label) : option.label}
                </Chip>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-neutral-600">{(() => { const current = CAPTION_STYLES.find((option) => option.value === state.captionStyle); return current && (CAPTION_STYLE_TEXT[current.value] ? t(CAPTION_STYLE_TEXT[current.value].hint) : current.hint) })()}</p>
            <CaptionTranslations uploadId={uploadId} />
          </> : <p className="text-xs text-neutral-600">{t("video.studio.captionsPending")}</p>}
        </Field>

        <Field label={t("video.studio.more")}>
          <div className="flex flex-wrap gap-1.5">
            <Chip onClick={() => void useFrameAsThumbnail()}><VertovIcon name="image" size={14} /> {t("video.studio.useFrame")}</Chip>
            <Chip onClick={() => void pickThumbnail()}><VertovIcon name="image" size={14} /> {pickingPoster ? t("video.studio.picking") : t("video.studio.pickForMe")}</Chip>
            {HOSTED_EDITION && canMakeGif && <Chip onClick={() => void makeGif()}><VertovIcon name="film" size={14} /> {makingGif ? t("video.studio.makingGif") : t("video.studio.gifButton")}</Chip>}
            <Chip
              active={state.socialEnabled}
              onClick={() => {
                const socialEnabled = !state.socialEnabled
                onChange({ ...state, socialEnabled })
                void save({ socialEnabled })
              }}
            >
              <VertovIcon name="comment" size={14} /> {state.socialEnabled ? t("video.studio.commentsOn") : t("video.studio.commentsOff")}
            </Chip>
          </div>
        </Field>
      </div>
    </section>
  )
}

function Field({ label, tutorial, children }: { label: string; tutorial?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-neutral-50/70 p-3.5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold tracking-wide text-neutral-900 uppercase">{label}</p>
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
          ? "border-[var(--brand-accent,#171717)] bg-[var(--brand-accent,#171717)] text-white"
          : "border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-100"
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
      {layout === "focus" && <rect x="1" y="1" width="18" height="12" rx="1.5" fill="currentColor" opacity="0.35" />}
      {layout === "focus" && <rect x="10.5" y="6" width="7.5" height="5.5" rx="1" fill="currentColor" />}
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
