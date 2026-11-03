import { useRef } from "react"
import type { Overlay } from "@/lib/overlays"
import { isActive } from "@/lib/overlays"

/**
 * Annotations drawn over the stage: they scale with the player (sizes are container units) and go
 * fullscreen with it. When `edit` is on, the owner can drag, resize and aim them in place.
 */
export function OverlayLayer({
  overlays,
  time,
  aspect,
  edit,
  selectedId,
  onSelect,
  onChange,
}: {
  overlays: Array<Overlay>
  time: number
  /** Stage width / height, so arrowheads aren't squashed. */
  aspect: number
  edit?: boolean
  selectedId?: string | null
  onSelect?: (id: string | null) => void
  onChange?: (next: Overlay) => void
}) {
  const layer = useRef<HTMLDivElement>(null)
  const shown = overlays.filter((overlay) => isActive(overlay, time) || (edit && overlay.id === selectedId))
  if (shown.length === 0) return null

  /** Starts a drag; `apply` gets the pointer's movement in percent of the stage. */
  function drag(event: React.PointerEvent, overlay: Overlay, apply: (dx: number, dy: number) => Partial<Overlay>) {
    if (!edit || !layer.current) return
    event.stopPropagation()
    event.preventDefault()
    onSelect?.(overlay.id)
    const rect = layer.current.getBoundingClientRect()
    const startX = event.clientX
    const startY = event.clientY
    const origin = { ...overlay }
    const move = (moved: PointerEvent) => {
      const dx = ((moved.clientX - startX) / rect.width) * 100
      const dy = ((moved.clientY - startY) / rect.height) * 100
      onChange?.({ ...origin, ...apply(dx, dy) })
    }
    const up = () => {
      removeEventListener("pointermove", move)
      removeEventListener("pointerup", up)
    }
    addEventListener("pointermove", move)
    addEventListener("pointerup", up)
  }

  const editable = edit ? "auto" : "none"
  const selected = (overlay: Overlay) => edit && overlay.id === selectedId
  const ring = (overlay: Overlay) => (selected(overlay) ? "0 0 0 1.5px #fff, 0 0 0 3px #2563eb" : undefined)

  return (
    <div
      ref={layer}
      className="absolute inset-0 overflow-hidden"
      // While editing, only the annotations themselves take the pointer, and they sit above the
      // player's own click surface; everything else (controls, play on click) keeps working.
      style={{ containerType: "size", pointerEvents: "none", zIndex: 40 }}
    >
      {shown.map((overlay) => {
        const outOfRange = !isActive(overlay, time)
        const fade = outOfRange ? 0.35 : 1
        if (overlay.type === "text") {
          return (
            <div
              key={overlay.id}
              onPointerDown={(event) => drag(event, overlay, (dx, dy) => ({ x: overlay.x + dx, y: overlay.y + dy }))}
              style={{
                position: "absolute",
                left: `${overlay.x}%`,
                top: `${overlay.y}%`,
                maxWidth: "70%",
                color: overlay.color,
                fontSize: `${overlay.size}cqw`,
                fontWeight: 700,
                lineHeight: 1.15,
                textShadow: overlay.color === "#111111" ? "0 0 0.4cqw rgb(255 255 255 / .6)" : "0 0.1cqw 0.5cqw rgb(0 0 0 / .65)",
                whiteSpace: "pre-wrap",
                pointerEvents: editable,
                cursor: edit ? "move" : undefined,
                opacity: fade,
                borderRadius: 4,
                boxShadow: ring(overlay),
                padding: "0 0.4cqw",
              }}
            >
              {overlay.text || (edit ? "Text" : "")}
            </div>
          )
        }
        if (overlay.type === "link") {
          const pill: React.CSSProperties = {
            position: "absolute",
            left: `${overlay.x}%`,
            top: `${overlay.y}%`,
            maxWidth: "70%",
            background: overlay.color,
            color: overlay.color === "#ffffff" ? "#111" : "#fff",
            fontSize: `${Math.min(overlay.size, 5)}cqw`,
            fontWeight: 700,
            lineHeight: 1.2,
            padding: "0.6cqw 1.6cqw",
            borderRadius: 999,
            boxShadow: ring(overlay) ?? "0 0.2cqw 1cqw rgb(0 0 0 / .35)",
            opacity: fade,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            textDecoration: "none",
          }
          if (edit) {
            return (
              <div key={overlay.id} onPointerDown={(event) => drag(event, overlay, (dx, dy) => ({ x: overlay.x + dx, y: overlay.y + dy }))} style={{ ...pill, cursor: "move", pointerEvents: "auto" }}>
                {overlay.text || "Link"}
              </div>
            )
          }
          return overlay.url ? (
            <a key={overlay.id} href={overlay.url} target="_blank" rel="noopener noreferrer" style={{ ...pill, pointerEvents: "auto", cursor: "pointer" }}>
              {overlay.text || overlay.url}
            </a>
          ) : null
        }
        if (overlay.type === "blur" || overlay.type === "spotlight" || overlay.type === "image") {
          const style: React.CSSProperties = {
            position: "absolute",
            left: `${overlay.x}%`,
            top: `${overlay.y}%`,
            width: `${overlay.w}%`,
            pointerEvents: editable,
            cursor: edit ? "move" : undefined,
            opacity: fade,
          }
          if (overlay.type === "blur") {
            // Redaction: whatever is under the region is blurred past reading.
            Object.assign(style, { height: `${overlay.h}%`, backdropFilter: "blur(1.4cqw)", WebkitBackdropFilter: "blur(1.4cqw)", background: "rgb(255 255 255 / .08)", borderRadius: "0.6cqw", boxShadow: ring(overlay) })
          } else if (overlay.type === "spotlight") {
            // Everything outside the region dims; the huge spread is clipped by the layer.
            Object.assign(style, { height: `${overlay.h}%`, borderRadius: "1cqw", boxShadow: `0 0 0 300cqw rgb(0 0 0 / ${outOfRange ? 0.2 : 0.55})${ring(overlay) ? `, ${ring(overlay)}` : ""}` })
          } else {
            Object.assign(style, { boxShadow: ring(overlay) })
          }
          return (
            <div key={overlay.id} onPointerDown={(event) => drag(event, overlay, (dx, dy) => ({ x: overlay.x + dx, y: overlay.y + dy }))} style={style}>
              {overlay.type === "image" && <img src={overlay.src} alt="" draggable={false} style={{ display: "block", width: "100%", height: "auto", pointerEvents: "none" }} />}
              {selected(overlay) && (
                <span
                  onPointerDown={(event) =>
                    drag(event, overlay, (dx, dy) => (overlay.type === "image" ? { w: Math.max(3, overlay.w + dx) } : { w: Math.max(2, overlay.w + dx), h: Math.max(2, overlay.h + dy) }))
                  }
                  style={{ position: "absolute", right: -7, bottom: -7, width: 14, height: 14, borderRadius: 99, background: "#2563eb", border: "2px solid #fff", cursor: "nwse-resize" }}
                />
              )}
            </div>
          )
        }
        if (overlay.type === "box") {
          return (
            <div
              key={overlay.id}
              onPointerDown={(event) => drag(event, overlay, (dx, dy) => ({ x: overlay.x + dx, y: overlay.y + dy }))}
              style={{
                position: "absolute",
                left: `${overlay.x}%`,
                top: `${overlay.y}%`,
                width: `${overlay.w}%`,
                height: `${overlay.h}%`,
                border: `0.45cqw solid ${overlay.color}`,
                borderRadius: "0.8cqw",
                boxShadow: ring(overlay) ?? "0 0 0 0.12cqw rgb(0 0 0 / .25)",
                pointerEvents: editable,
                cursor: edit ? "move" : undefined,
                opacity: fade,
              }}
            >
              {selected(overlay) && (
                <span
                  onPointerDown={(event) => drag(event, overlay, (dx, dy) => ({ w: Math.max(2, overlay.w + dx), h: Math.max(2, overlay.h + dy) }))}
                  style={{ position: "absolute", right: -7, bottom: -7, width: 14, height: 14, borderRadius: 99, background: "#2563eb", border: "2px solid #fff", cursor: "nwse-resize" }}
                />
              )}
            </div>
          )
        }
        // Arrow: drawn in a viewBox that matches the stage so it keeps its shape at any size.
        const w = 100 * aspect
        const x1 = overlay.x * aspect
        const x2 = overlay.x2 * aspect
        const angle = Math.atan2(overlay.y2 - overlay.y, x2 - x1)
        const head = 3.4
        const spread = 0.5
        const points = [
          [x2, overlay.y2],
          [x2 - head * Math.cos(angle - spread), overlay.y2 - head * Math.sin(angle - spread)],
          [x2 - head * Math.cos(angle + spread), overlay.y2 - head * Math.sin(angle + spread)],
        ]
          .map((point) => point.join(","))
          .join(" ")
        const handle = (key: "tail" | "head") => {
          const cx = key === "tail" ? overlay.x : overlay.x2
          const cy = key === "tail" ? overlay.y : overlay.y2
          return (
            <span
              key={key}
              onPointerDown={(event) =>
                drag(event, overlay, (dx, dy) => (key === "tail" ? { x: overlay.x + dx, y: overlay.y + dy } : { x2: overlay.x2 + dx, y2: overlay.y2 + dy }))
              }
              style={{ position: "absolute", left: `${cx}%`, top: `${cy}%`, width: 16, height: 16, margin: -8, borderRadius: 99, background: "#2563eb", border: "2px solid #fff", cursor: "move", pointerEvents: "auto" }}
            />
          )
        }
        return (
          <div key={overlay.id} style={{ position: "absolute", inset: 0, pointerEvents: "none", opacity: fade }}>
            <svg viewBox={`0 0 ${w} 100`} preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible" }}>
              <line
                x1={x1}
                y1={overlay.y}
                x2={x2 - (head * 0.6) * Math.cos(angle)}
                y2={overlay.y2 - head * 0.6 * Math.sin(angle)}
                stroke={overlay.color}
                strokeWidth={0.9}
                strokeLinecap="round"
                style={{ filter: "drop-shadow(0 0 0.25px rgb(0 0 0 / .5))" }}
              />
              <polygon points={points} fill={overlay.color} style={{ filter: "drop-shadow(0 0 0.25px rgb(0 0 0 / .5))" }} />
              {edit && (
                // Wide invisible stroke so the whole arrow can be grabbed.
                <line
                  x1={x1}
                  y1={overlay.y}
                  x2={x2}
                  y2={overlay.y2}
                  stroke="transparent"
                  strokeWidth={4}
                  style={{ pointerEvents: "stroke", cursor: "move" }}
                  onPointerDown={(event) => drag(event, overlay, (dx, dy) => ({ x: overlay.x + dx, y: overlay.y + dy, x2: overlay.x2 + dx, y2: overlay.y2 + dy }))}
                />
              )}
            </svg>
            {selected(overlay) && [handle("tail"), handle("head")]}
          </div>
        )
      })}
    </div>
  )
}
