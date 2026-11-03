import { ArrowUpRightIcon, EyeSlashIcon, FlashlightIcon, ImageIcon, LinkSimpleIcon, SelectionIcon, TextTIcon, TrashIcon } from "@phosphor-icons/react"
import { useRef, useState } from "react"
import type { Overlay, OverlayType } from "@/lib/overlays"
import { MAX_OVERLAYS, OVERLAY_COLORS, newOverlay, safeUrl } from "@/lib/overlays"
import { formatDuration } from "@/lib/format"

const ADD: Array<{ type: OverlayType; label: string; icon: React.ReactNode }> = [
  { type: "text", label: "Text", icon: <TextTIcon size={14} /> },
  { type: "box", label: "Box", icon: <SelectionIcon size={14} /> },
  { type: "arrow", label: "Arrow", icon: <ArrowUpRightIcon size={14} /> },
  { type: "link", label: "Link", icon: <LinkSimpleIcon size={14} /> },
  { type: "blur", label: "Blur", icon: <EyeSlashIcon size={14} /> },
  { type: "spotlight", label: "Spotlight", icon: <FlashlightIcon size={14} /> },
]

const LABELS: Record<OverlayType, string> = { text: "Text", box: "Box", arrow: "Arrow", link: "Link", blur: "Blur", spotlight: "Spotlight", image: "Image" }

/**
 * The owner's annotation list: add text, boxes and arrows at the current moment, then drag them on
 * the video. Each shows for a time range and never changes the recording itself.
 */
export function AnnotateEditor({
  uploadId,
  overlays,
  selectedId,
  currentTime,
  duration,
  onSelect,
  onChange,
  onSeek,
  className,
}: {
  uploadId: string
  overlays: Array<Overlay>
  selectedId: string | null
  currentTime: number
  duration: number
  onSelect: (id: string | null) => void
  onChange: (next: Array<Overlay>) => void
  onSeek: (time: number) => void
  className?: string
}) {
  const sorted = [...overlays].sort((a, b) => a.start - b.start)
  const selected = overlays.find((overlay) => overlay.id === selectedId) ?? null
  const update = (patch: Partial<Overlay>) => selected && onChange(overlays.map((overlay) => (overlay.id === selected.id ? { ...overlay, ...patch } : overlay)))
  const round = (value: number) => Math.round(value * 10) / 10

  const fileInput = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState("")

  function add(type: OverlayType, src = "") {
    if (overlays.length >= MAX_OVERLAYS) return
    const created = newOverlay(type, currentTime, src)
    onChange([...overlays, created])
    onSelect(created.id)
  }

  async function addImage(file: File | undefined) {
    if (!file) return
    setUploading(true)
    setUploadError("")
    const response = await fetch(`/api/recordings/${uploadId}/overlay-image`, { method: "POST", headers: { "content-type": file.type }, body: file }).catch(() => null)
    setUploading(false)
    const body = (await response?.json().catch(() => null)) as { src?: string; error?: string } | null
    if (body?.src) add("image", body.src)
    else setUploadError(body?.error ?? "Use a PNG, JPEG or WebP image under 2 MB.")
  }

  return (
    <div className={`flex flex-col overflow-y-auto px-3 pb-4 ${className ?? ""}`}>
      <p className="text-xs text-neutral-500">Add text, a box, an arrow, a link, a blur, a spotlight or an image at the moment you're on, then drag it on the video. Each shows for a few seconds.</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {ADD.map((item) => (
          <button
            key={item.type}
            type="button"
            onClick={() => add(item.type)}
            className="flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
          >
            {item.icon} {item.label}
          </button>
        ))}
        <button
          type="button"
          disabled={uploading}
          onClick={() => fileInput.current?.click()}
          className="flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
        >
          <ImageIcon size={14} /> {uploading ? "Uploading…" : "Image"}
        </button>
        <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(event) => (void addImage(event.target.files?.[0]), (event.target.value = ""))} />
      </div>
      {uploadError && <p role="alert" className="mt-2 text-xs text-red-600">{uploadError}</p>}

      {sorted.length === 0 ? (
        <p className="mt-6 text-sm text-neutral-400">Nothing yet.</p>
      ) : (
        <ul className="mt-4 space-y-1">
          {sorted.map((overlay) => (
            <li key={overlay.id}>
              <button
                type="button"
                onClick={() => {
                  onSelect(overlay.id)
                  onSeek(overlay.start + 0.01)
                }}
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm ${overlay.id === selectedId ? "bg-neutral-200/70" : "hover:bg-neutral-100"}`}
              >
                <span className="size-3 shrink-0 rounded-full" style={{ background: overlay.color, boxShadow: "0 0 0 1px rgb(0 0 0 / .15)" }} />
                <span className="min-w-0 flex-1 truncate">{overlay.type === "text" || overlay.type === "link" ? overlay.text || LABELS[overlay.type] : LABELS[overlay.type]}</span>
                <span className="shrink-0 text-xs text-neutral-500 tabular-nums">
                  {formatDuration(overlay.start)}–{formatDuration(overlay.end)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {selected && (
        <div className="mt-4 space-y-3 rounded-xl border border-neutral-200 bg-white p-3">
          {selected.type === "text" && (
            <>
              <textarea
                value={selected.text}
                onChange={(event) => update({ text: event.target.value })}
                rows={2}
                maxLength={200}
                aria-label="Text"
                className="w-full rounded-lg border border-neutral-300 px-2.5 py-1.5 text-sm"
              />
              <label className="flex items-center gap-2 text-xs text-neutral-600">
                Size
                <input type="range" min={1.6} max={8} step={0.2} value={selected.size} onChange={(event) => update({ size: Number(event.target.value) })} className="flex-1" />
              </label>
            </>
          )}
          {selected.type === "link" && (
            <>
              <input
                value={selected.text}
                onChange={(event) => update({ text: event.target.value })}
                maxLength={60}
                placeholder="Button label"
                aria-label="Link label"
                className="w-full rounded-lg border border-neutral-300 px-2.5 py-1.5 text-sm"
              />
              <input
                value={selected.url}
                onChange={(event) => update({ url: event.target.value })}
                onBlur={(event) => update({ url: safeUrl(event.target.value) })}
                maxLength={2000}
                placeholder="https://example.com"
                aria-label="Link address"
                className="w-full rounded-lg border border-neutral-300 px-2.5 py-1.5 text-sm"
              />
            </>
          )}
          {(selected.type === "blur" || selected.type === "spotlight") && (
            <p className="text-xs text-neutral-500">{selected.type === "blur" ? "Blurs whatever is under it, for emails, keys or names." : "Dims everything outside it to pull the eye in."} Drag the corner to resize.</p>
          )}
          {selected.type !== "blur" && selected.type !== "spotlight" && selected.type !== "image" && <div className="flex gap-1.5">
            {OVERLAY_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={`Color ${color}`}
                aria-pressed={selected.color === color}
                onClick={() => update({ color })}
                className="size-6 rounded-full"
                style={{ background: color, boxShadow: selected.color === color ? "0 0 0 2px #fff, 0 0 0 4px #2563eb" : "0 0 0 1px rgb(0 0 0 / .2)" }}
              />
            ))}
          </div>}
          <div className="grid grid-cols-2 gap-2 text-xs text-neutral-600">
            <TimeField label="Shows from" value={selected.start} max={duration} onChange={(start) => update({ start, end: Math.max(selected.end, start + 0.5) })} onNow={() => update({ start: round(currentTime), end: Math.max(selected.end, round(currentTime) + 0.5) })} />
            <TimeField label="Until" value={selected.end} max={duration} onChange={(end) => update({ end: Math.max(end, selected.start + 0.5) })} onNow={() => update({ end: Math.max(round(currentTime), selected.start + 0.5) })} />
          </div>
          <button
            type="button"
            onClick={() => {
              onChange(overlays.filter((overlay) => overlay.id !== selected.id))
              onSelect(null)
            }}
            className="flex items-center gap-1.5 text-xs text-red-600 hover:underline"
          >
            <TrashIcon size={14} /> Delete
          </button>
        </div>
      )}
    </div>
  )
}

function TimeField({ label, value, max, onChange, onNow }: { label: string; value: number; max: number; onChange: (next: number) => void; onNow: () => void }) {
  return (
    <label className="block">
      {label}
      <div className="mt-1 flex gap-1">
        <input
          type="number"
          min={0}
          max={max || undefined}
          step={0.1}
          value={value}
          onChange={(event) => Number.isFinite(event.target.valueAsNumber) && onChange(Math.max(0, event.target.valueAsNumber))}
          className="w-full min-w-0 rounded-lg border border-neutral-300 px-2 py-1 text-sm text-neutral-900"
        />
        <button type="button" onClick={onNow} title="Set to the current time" className="shrink-0 rounded-lg border border-neutral-200 px-2 text-xs hover:bg-neutral-50">
          Now
        </button>
      </div>
    </label>
  )
}
