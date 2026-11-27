import { useEffect, useRef, useState } from "react"
import type { KeyboardEvent } from "react"
import { useLocation } from "@tanstack/react-router"
import { MagnifyingGlassIcon } from "@phosphor-icons/react"
import type { MessageKey } from "@/lib/i18n/en/index"
import { useT, type AppTranslator } from "@/lib/i18n/react"

type Group = "actions" | "goTo" | "account" | "recordings" | "recent" | "spaces" | "search"
const GROUP_LABELS: Record<Group, MessageKey> = {
  actions: "library.palette.groupActions",
  goTo: "library.palette.groupGoTo",
  account: "library.palette.groupAccount",
  recordings: "library.palette.groupRecordings",
  recent: "library.palette.groupRecent",
  spaces: "library.palette.groupSpaces",
  search: "library.palette.groupSearch",
}

interface Item {
  id: string
  title: string
  hint: string
  href: string
  group: Group
}
interface Results {
  canManage?: boolean
  videos: Array<{ id: string; title: string; snippet: string | null; duration: number | null }>
  spaces: Array<{ id: string; name: string }>
}
const actionItems = (t: AppTranslator): Item[] => [
  { id: "record", title: t("library.palette.recordTitle"), hint: t("library.actions.recordHint"), href: "/record", group: "actions" },
  {
    id: "upload",
    title: t("library.palette.uploadTitle"),
    hint: t("library.palette.uploadHint"),
    href: "/home?import=1",
    group: "actions",
  },
  {
    id: "request",
    title: t("library.actions.requestVideo"),
    hint: t("library.palette.requestHint"),
    href: "/home?request=1",
    group: "actions",
  },
  { id: "library", title: t("library.palette.myLibrary"), hint: t("library.palette.myLibraryHint"), href: "/home", group: "goTo" },
  { id: "later", title: t("library.nav.watchLater"), hint: t("library.palette.laterHint"), href: "/home?view=later", group: "goTo" },
  { id: "archive", title: t("library.nav.archive"), hint: t("library.palette.archiveHint"), href: "/home?view=archive", group: "goTo" },
  {
    id: "settings",
    title: t("library.palette.settingsTitle"),
    hint: t("library.palette.settingsHint"),
    href: "/settings",
    group: "goTo",
  },
  {
    id: "agents",
    title: t("library.palette.agentsTitle"),
    hint: t("library.palette.agentsHint"),
    href: "/settings?tab=agents",
    group: "goTo",
  },
]
const OPEN_EVENT = "vertov:commands"

export function CommandPaletteButton() {
  const t = useT()
  const [shortcut, setShortcut] = useState("⌘ K")
  useEffect(() => {
    if (!/Mac|iPhone|iPad/.test(navigator.platform)) setShortcut("Ctrl K")
  }, [])
  return (
    <button
      type="button"
      aria-label={t("library.palette.open")}
      title={t("library.palette.title")}
      onClick={() => window.dispatchEvent(new Event(OPEN_EVENT))}
      className="flex shrink-0 items-center gap-2 rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100 active:bg-neutral-200"
    >
      <MagnifyingGlassIcon size={16} />
      <kbd className="hidden text-xs sm:inline">{shortcut}</kbd>
    </button>
  )
}

export function CommandPalette() {
  const t = useT()
  const { pathname } = useLocation()
  const enabled = pathname === "/home" || pathname === "/settings" || /^\/[a-f0-9]{8}$/.test(pathname)
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
    setResults((current) => ({ canManage: current.canManage, videos: [], spaces: [] }))
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
          if (!controller.signal.aborted) setError(t("library.palette.loadFailed"))
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
  const actions = actionItems(t).filter((item) => ((item.id !== "analytics" && item.id !== "tutorials") || results.canManage) && (!needle || `${item.title} ${item.hint}`.toLowerCase().includes(needle)))
  const items: Item[] = signedOut
    ? [
        {
          id: "signin",
          title: t("library.palette.signInTitle"),
          hint: t("library.palette.signInHint"),
          href: "/signin?redirect=/home",
          group: "account",
        },
      ]
    : [
        ...actions.filter((item) => needle || item.group === "actions"),
        ...results.videos.map((video): Item => ({
          id: video.id,
          title: video.title,
          hint: video.snippet || t("library.palette.openRecording"),
          href: `/${video.id}`,
          group: needle ? "recordings" : "recent",
        })),
        ...results.spaces.map((space): Item => ({
          id: `space-${space.id}`,
          title: space.name,
          hint: t("library.palette.sharedSpace"),
          href: `/home?view=space&space=${encodeURIComponent(space.id)}`,
          group: "spaces",
        })),
        ...(!needle ? actions.filter((item) => item.group !== "actions") : []),
        ...(needle
          ? [
              {
                id: "search",
                title: t("library.palette.searchTitle", { query: query.trim() }),
                hint: t("library.palette.searchHint"),
                href: `/home?q=${encodeURIComponent(query.trim().slice(0, 100))}`,
                group: "search" as const,
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
      aria-label={t("library.palette.title")}
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
          aria-label={t("library.palette.title")}
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
          placeholder={t("library.palette.placeholder")}
          className="min-w-0 flex-1 bg-transparent py-1 text-base outline-none placeholder:text-neutral-400"
        />
        <button
          type="button"
          onClick={close}
          aria-label={t("library.palette.close")}
          className="rounded border border-neutral-200 px-1.5 py-0.5 text-xs text-neutral-500 hover:bg-neutral-100"
        >
          Esc
        </button>
      </div>
      <div role="status" className="px-4 pt-2 text-xs text-neutral-500">
        {loading
          ? t("library.palette.searching")
          : error ||
            (signedOut
              ? t("library.palette.signedOut")
              : needle
                ? t("library.palette.matches")
                : t("library.palette.idle"))}
      </div>
      <div
        id="command-results"
        role="listbox"
        aria-label={t("library.palette.listLabel")}
        className="max-h-[min(55vh,28rem)] overflow-y-auto p-2"
      >
        {items.map((item, index) => (
          <div key={item.id}>
            {(index === 0 || items[index - 1].group !== item.group) && (
              <div className="px-3 pt-3 pb-1 text-[11px] font-medium tracking-wide text-neutral-400 uppercase">
                {t(GROUP_LABELS[item.group])}
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
        <span>{t("library.palette.keySelect")}</span>
        <span>{t("library.palette.keyOpen")}</span>
        <span>{t("library.palette.keyClose")}</span>
      </div>
    </dialog>
  )
}
