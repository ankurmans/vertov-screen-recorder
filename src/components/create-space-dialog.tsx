import { UsersThreeIcon, XIcon } from "@phosphor-icons/react"
import { useEffect, useRef, useState } from "react"

interface CreateSpaceDialogProps {
  workspaceName: string
  onClose: () => void
  onCreated: (id: string) => void
}

export function CreateSpaceDialog({ workspaceName, onClose, onCreated }: CreateSpaceDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const submitting = useRef(false)
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    const element = dialog.current!
    const opener = document.activeElement
    const overflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    element.showModal()
    input.current?.focus()
    return () => {
      element.close()
      document.body.style.overflow = overflow
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [])

  useEffect(() => {
    if (error) input.current?.focus()
  }, [error])

  async function create() {
    const trimmed = name.trim()
    if (!trimmed || submitting.current) return
    submitting.current = true
    setBusy(true)
    setError("")
    const response = await fetch("/api/spaces", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: trimmed }),
    }).catch(() => null)
    const body = (await response?.json().catch(() => null)) as { id?: string; error?: string } | null
    submitting.current = false
    setBusy(false)
    if (!response?.ok || !body?.id) {
      setError(body?.error || "Couldn't create the space. Please try again.")
      return
    }
    onCreated(body.id)
  }

  return (
    <dialog
      ref={dialog}
      aria-labelledby="create-space-title"
      aria-describedby="create-space-description"
      aria-modal="true"
      className="create-space-dialog m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-2xl border border-neutral-200 bg-[#f6f6f2] p-6 text-neutral-900"
      onCancel={(event) => {
        event.preventDefault()
        if (!submitting.current) onClose()
      }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return
        const fields = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)"),
        )
        const first = fields[0]
        const last = fields[fields.length - 1]
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last?.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first?.focus()
        }
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget || submitting.current) return
        const bounds = event.currentTarget.getBoundingClientRect()
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        )
          onClose()
      }}
    >
      <div className="flex items-start justify-between gap-4">
        <span className="flex size-10 items-center justify-center rounded-xl border border-neutral-200 bg-white">
          <UsersThreeIcon size={22} />
        </span>
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          aria-label="Close create space"
          className="-mt-2 -mr-2 flex size-10 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-200/60 disabled:opacity-40"
        >
          <XIcon size={18} />
        </button>
      </div>
      <h2 id="create-space-title" className="mt-4 text-xl font-semibold tracking-tight">
        Create a space
      </h2>
      <p id="create-space-description" className="mt-2 text-sm leading-relaxed text-neutral-500">
        A shared place for videos. Everyone in {workspaceName} can see it.
      </p>
      <form
        className="mt-6"
        aria-busy={busy}
        onSubmit={(event) => {
          event.preventDefault()
          void create()
        }}
      >
        <label htmlFor="space-name" className="block text-sm font-medium">
          Space name
        </label>
        <input
          ref={input}
          id="space-name"
          name="name"
          required
          maxLength={60}
          value={name}
          disabled={busy}
          onChange={(event) => {
            setName(event.target.value)
            setError("")
          }}
          placeholder="e.g. Design reviews"
          autoComplete="off"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "create-space-error" : undefined}
          className="mt-2 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2.5 text-sm disabled:opacity-60"
        />
        {error && (
          <p id="create-space-error" role="alert" className="mt-3 text-sm text-red-700">
            {error}
          </p>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-lg border border-neutral-200 bg-white px-4 py-2 text-sm font-medium hover:bg-neutral-100 disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !name.trim()}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-40"
          >
            {busy ? "Creating…" : "Create space"}
          </button>
        </div>
      </form>
    </dialog>
  )
}
