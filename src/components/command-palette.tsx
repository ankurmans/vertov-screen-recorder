import { useEffect, useRef, useState } from "react"
import type { KeyboardEvent } from "react"
import { useLocation } from "@tanstack/react-router"
import { MagnifyingGlassIcon } from "@phosphor-icons/react"

interface Item {
  id: string
  title: string
  hint: string
  href: string
  group: string
}
interface Results {
  videos: Array<{ id: string; title: string; snippet: string | null; duration: number | null }>
  spaces: Array<{ id: string; name: string }>
}
const ACTIONS: Item[] = [
  { id: "record", title: "Start a recording", hint: "Screen, camera or both", href: "/record", group: "Actions" },
  {
    id: "upload",
    title: "Upload or import a video",
    hint: "Files and Loom links",
    href: "/app?import=1",
    group: "Actions",
  },
  {
    id: "request",
    title: "Request a video",
    hint: "Let someone record for you",
    href: "/app?request=1",
    group: "Actions",
  },
  { id: "library", title: "My library", hint: "Your recordings", href: "/app", group: "Go to" },
  { id: "later", title: "Watch later", hint: "Saved videos", href: "/app?view=later", group: "Go to" },
  { id: "archive", title: "Archive", hint: "Archived recordings", href: "/app?view=archive", group: "Go to" },
  {
    id: "settings",
    title: "Workspace settings",
    hint: "Branding, members and notifications",
    href: "/settings",
    group: "Go to",
  },
  {
    id: "agents",
    title: "API keys and MCP",
    hint: "Connect your agents",
    href: "/settings?tab=agents",
    group: "Go to",
  },
]
const OPEN_EVENT = "vertov:commands"

export function CommandPaletteButton() {
  const [shortcut, setShortcut] = useState("⌘ K")
  useEffect(() => {
    if (!/Mac|iPhone|iPad/.test(navigator.platform)) setShortcut("Ctrl K")
  }, [])
  return (
    <button
      type="button"
      aria-label="Open command palette"
      title="Search recordings and commands"
      onClick={() => window.dispatchEvent(new Event(OPEN_EVENT))}
      className="flex shrink-0 items-center gap-2 rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100 active:bg-neutral-200"
    >
      <MagnifyingGlassIcon size={16} />
      <kbd className="hidden text-xs sm:inline">{shortcut}</kbd>
    </button>
  )
}

export function CommandPalette() {
  const { pathname } = useLocation()
  const enabled = pathname === "/app" || pathname === "/settings" || /^\/[a-f0-9]{8}$/.test(pathname)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<Results>({ videos: [], spaces: [] })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [signedOut, setSignedOut] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const opener = useRef<HTMLElement | null>(null)

  function close() {
    dialog.current?.close()
    setOpen(false)
    opener.current?.focus()
  }

  useEffect(() => {
    function show() {
      if (!enabled || document.querySelector('dialog[open], [role="dialog"]')) return
      opener.current = document.activeElement as HTMLElement | null
      setQuery("")
      setSelected(null)
      setError("")
      setSignedOut(false)
      setResults({ videos: [], spaces: [] })
      setOpen(true)
    }
    function key(event: globalThis.KeyboardEvent) {
      if (
        event.isComposing ||
        event.repeat ||
        !(event.metaKey || event.ctrlKey) ||
        event.altKey ||
        event.key.toLowerCase() !== "k" ||
        !enabled
      )
        return
      event.preventDefault()
      if (dialog.current?.open) close()
      else show()
    }
    window.addEventListener("keydown", key)
    window.addEventListener(OPEN_EVENT, show)
    return () => {
      window.removeEventListener("keydown", key)
      window.removeEventListener(OPEN_EVENT, show)
    }
  }, [enabled])

  useEffect(() => {
    if (!open || !enabled) {
      dialog.current?.close()
      return
    }
    dialog.current?.showModal()
    input.current?.focus()
  }, [open, enabled])
  useEffect(() => {
    close()
  }, [pathname])

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setLoading(true)
    setResults({ videos: [], spaces: [] })
    setError("")
    const timer = setTimeout(
      async () => {
        try {
          const response = await fetch(`/api/commands?q=${encodeURIComponent(query.trim().slice(0, 100))}`, {
            signal: controller.signal,
          })
          if (response.status === 401) {
            setSignedOut(true)
            return
          }
          if (!response.ok) throw new Error()
          const body = (await response.json()) as Results
          if (!controller.signal.aborted) setResults(body)
        } catch {
          if (!controller.signal.aborted) setError("Couldn't load recordings. Your commands still work.")
        } finally {
          if (!controller.signal.aborted) setLoading(false)
        }
      },
      query ? 180 : 0,
    )
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query, open, pathname])

  const needle = query.trim().toLowerCase()
  const actions = ACTIONS.filter((item) => !needle || `${item.title} ${item.hint}`.toLowerCase().includes(needle))
  const items: Item[] = signedOut
    ? [
        {
          id: "signin",
          title: "Sign in to your library",
          hint: "Search your recordings and workspaces",
          href: "/signin?redirect=/app",
          group: "Account",
        },
      ]
    : [
        ...actions.filter((item) => needle || item.group === "Actions"),
        ...results.videos.map((video) => ({
          id: video.id,
          title: video.title,
          hint: video.snippet || "Open recording",
          href: `/${video.id}`,
          group: needle ? "Recordings" : "Recent recordings",
        })),
        ...results.spaces.map((space) => ({
          id: `space-${space.id}`,
          title: space.name,
          hint: "Shared space",
          href: `/app?view=space&space=${encodeURIComponent(space.id)}`,
          group: "Spaces",
        })),
        ...(!needle ? actions.filter((item) => item.group !== "Actions") : []),
        ...(needle
          ? [
              {
                id: "search",
                title: `Search library for “${query.trim()}”`,
                hint: "Titles, summaries and transcripts",
                href: `/app?q=${encodeURIComponent(query.trim().slice(0, 100))}`,
                group: "Search",
              },
            ]
          : []),
      ]
  const active = Math.max(
    0,
    items.findIndex((item) => item.id === selected),
  )
  function run(item: Item) {
    close()
    window.location.assign(item.href)
  }
  function key(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      const next = (active + (event.key === "ArrowDown" ? 1 : -1) + items.length) % Math.max(1, items.length)
      setSelected(items[next]?.id ?? null)
    } else if (event.key === "Enter" && items[active]) {
      event.preventDefault()
      run(items[active])
    }
  }
  useEffect(() => {
    document.getElementById(`command-${active}`)?.scrollIntoView({ block: "nearest" })
  }, [active])

  return (
    <dialog
      ref={dialog}
      aria-label="Search recordings and commands"
      onCancel={(event) => {
        event.preventDefault()
        close()
      }}
      onClose={() => setOpen(false)}
      onClick={(event) => {
        if (event.target === dialog.current) close()
      }}
      className="fixed inset-x-0 top-[12vh] m-0 mx-auto w-[calc(100%-2rem)] max-w-xl overflow-hidden rounded-2xl border border-neutral-200 bg-white p-0 text-neutral-900 shadow-2xl backdrop:bg-black/40"
    >
      <div className="flex items-center gap-3 border-b border-neutral-200 px-4 py-3">
        <MagnifyingGlassIcon size={20} className="shrink-0 text-neutral-400" />
        <input
          ref={input}
          role="combobox"
          aria-label="Search recordings and commands"
          aria-expanded={open}
          aria-controls="command-results"
          aria-autocomplete="list"
          aria-activedescendant={items.length ? `command-${active}` : undefined}
          value={query}
          maxLength={100}
          onChange={(event) => {
            setQuery(event.target.value)
            setSelected(null)
          }}
          onKeyDown={key}
          placeholder="Search recordings or type a command…"
          className="min-w-0 flex-1 bg-transparent py-1 text-base outline-none placeholder:text-neutral-400"
        />
        <button
          type="button"
          onClick={close}
          aria-label="Close command palette"
          className="rounded border border-neutral-200 px-1.5 py-0.5 text-xs text-neutral-500 hover:bg-neutral-100"
        >
          Esc
        </button>
      </div>
      <div role="status" className="px-4 pt-2 text-xs text-neutral-500">
        {loading
          ? "Searching recordings…"
          : error ||
            (signedOut
              ? "Sign in to search your recordings."
              : needle
                ? "Matches in your current workspace"
                : "Commands and recent recordings")}
      </div>
      <div
        id="command-results"
        role="listbox"
        aria-label="Commands and recordings"
        className="max-h-[min(55vh,28rem)] overflow-y-auto p-2"
      >
        {items.map((item, index) => (
          <div key={item.id}>
            {(index === 0 || items[index - 1].group !== item.group) && (
              <div className="px-3 pt-3 pb-1 text-[11px] font-medium tracking-wide text-neutral-400 uppercase">
                {item.group}
              </div>
            )}
            <button
              type="button"
              role="option"
              aria-selected={index === active}
              id={`command-${index}`}
              tabIndex={-1}
              onMouseMove={() => setSelected(item.id)}
              onClick={() => run(item)}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left ${index === active ? "bg-neutral-100" : "hover:bg-neutral-50"}`}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{item.title}</span>
                <span className="block truncate text-xs text-neutral-500">{item.hint}</span>
              </span>
              {index === active && (
                <span aria-hidden="true" className="text-xs text-neutral-400">
                  ↵
                </span>
              )}
            </button>
          </div>
        ))}
      </div>
      <div className="flex gap-4 border-t border-neutral-100 px-4 py-2 text-[11px] text-neutral-500">
        <span>↑ ↓ Select</span>
        <span>↵ Open</span>
        <span>Esc Close</span>
      </div>
    </dialog>
  )
}
