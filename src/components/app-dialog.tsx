import { useEffect, useRef, useState, useSyncExternalStore } from "react"

// In-app replacements for window.confirm, prompt and alert: same one-line call, awaited, drawn in Vertov's own
// dialog instead of the browser's. One host (in the root layout) shows whichever request is current.

interface ConfirmRequest {
  kind: "confirm"
  title: string
  body?: string
  confirmLabel?: string
  /** Paints the confirm button red, for deletes and other things that can't be undone. */
  danger?: boolean
  resolve: (value: boolean) => void
}

interface TextRequest {
  kind: "text"
  title: string
  body?: string
  label: string
  initial?: string
  placeholder?: string
  confirmLabel?: string
  maxLength?: number
  resolve: (value: string | null) => void
}

interface NoticeRequest {
  kind: "notice"
  title: string
  body?: string
  resolve: () => void
}

type Request = (ConfirmRequest | TextRequest | NoticeRequest) & { id?: number }

let current: Request | null = null
let nextId = 0
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((listener) => listener())

function open(request: Request) {
  // A second request while one is open answers the first as cancelled rather than losing it.
  if (current) settle(current, null)
  current = { ...request, id: ++nextId } as Request
  emit()
}

function settle(request: Request, value: boolean | string | null) {
  if (request.kind === "confirm") request.resolve(value === true)
  else if (request.kind === "text") request.resolve(typeof value === "string" ? value : null)
  else request.resolve()
  if (current === request) {
    current = null
    emit()
  }
}

export function askConfirm(options: Omit<ConfirmRequest, "kind" | "resolve">): Promise<boolean> {
  return new Promise((resolve) => open({ kind: "confirm", ...options, resolve }))
}

/** Resolves to the trimmed text, or null when cancelled or left empty. */
export function askText(options: Omit<TextRequest, "kind" | "resolve">): Promise<string | null> {
  return new Promise((resolve) => open({ kind: "text", ...options, resolve }))
}

export function showNotice(title: string, body?: string): Promise<void> {
  return new Promise((resolve) => open({ kind: "notice", title, body, resolve }))
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function AppDialogHost() {
  const request = useSyncExternalStore(subscribe, () => current, () => null)
  return request ? <AppDialog key={request.id} request={request} /> : null
}

function AppDialog({ request }: { request: Request }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const field = useRef<HTMLInputElement>(null)
  const primary = useRef<HTMLButtonElement>(null)
  const [text, setText] = useState(request.kind === "text" ? (request.initial ?? "") : "")

  useEffect(() => {
    const element = dialog.current!
    const opener = document.activeElement
    element.showModal()
    if (field.current) {
      field.current.focus()
      field.current.select()
    } else primary.current?.focus()
    return () => {
      element.close()
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [])

  const cancel = () => settle(request, request.kind === "notice" ? null : request.kind === "confirm" ? false : null)
  const submit = () => {
    if (request.kind === "confirm") settle(request, true)
    else if (request.kind === "text") {
      const value = text.trim()
      settle(request, value || null)
    } else settle(request, null)
  }

  const danger = request.kind === "confirm" && request.danger
  const confirmLabel = request.kind === "notice" ? "OK" : (request.confirmLabel ?? (request.kind === "text" ? "Save" : "Continue"))

  return (
    <dialog
      ref={dialog}
      aria-labelledby="app-dialog-title"
      aria-describedby={request.body ? "app-dialog-body" : undefined}
      className="app-dialog m-auto w-[calc(100%-2rem)] max-w-sm rounded-2xl border border-neutral-200 bg-[#f6f6f2] p-6 text-neutral-900"
      onCancel={(event) => {
        event.preventDefault()
        cancel()
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return
        const bounds = event.currentTarget.getBoundingClientRect()
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) cancel()
      }}
    >
      <form
        method="dialog"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <h2 id="app-dialog-title" className="text-lg font-semibold tracking-tight text-balance">
          {request.title}
        </h2>
        {request.body && (
          <p id="app-dialog-body" className="mt-2 text-sm leading-relaxed text-neutral-600">
            {request.body}
          </p>
        )}
        {request.kind === "text" && (
          <label className="mt-4 block text-sm font-medium">
            {request.label}
            <input
              ref={field}
              value={text}
              maxLength={request.maxLength ?? 120}
              onChange={(event) => setText(event.target.value)}
              placeholder={request.placeholder}
              autoComplete="off"
              className="mt-1.5 block w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-normal focus:border-neutral-500 focus:outline-none"
            />
          </label>
        )}
        <div className="mt-6 flex justify-end gap-2">
          {request.kind !== "notice" && (
            <button type="button" onClick={cancel} className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50">
              Cancel
            </button>
          )}
          <button
            ref={primary}
            type="submit"
            disabled={request.kind === "text" && !text.trim()}
            className={`rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-40 ${danger ? "bg-red-600 hover:bg-red-500" : "bg-neutral-900 hover:bg-neutral-700"}`}
          >
            {confirmLabel}
          </button>
        </div>
      </form>
    </dialog>
  )
}
