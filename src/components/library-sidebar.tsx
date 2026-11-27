import { useEffect, useState } from "react"
import { PoweredBy } from "@/components/powered-by"
import { Link } from "@tanstack/react-router"
import { ArchiveIcon, ClockIcon, GearIcon, PlusIcon, SidebarSimpleIcon, UserIcon, UsersIcon, UsersThreeIcon } from "@phosphor-icons/react"
import type { LibrarySearch } from "@/lib/library-search"
import { useT } from "@/lib/i18n/react"

export interface SidebarData {
  spaces: Array<{ id: string; name: string }>
  manage: boolean
}

/** "mine", "later", "archive", "playlists", "analytics", "tutorials", or a space id. */
export type SidebarActive = string | null

/** A plain click opens the record panel in place; modified clicks and pages without one still go to /record. */
export function openPanel(event: React.MouseEvent, onRecord?: () => void) {
  if (!onRecord || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return
  event.preventDefault()
  onRecord()
}

const RAIL_KEY = "vertov:rail-collapsed"

const itemStyle = (active: boolean, collapsed: boolean) =>
  `flex w-full items-center rounded-lg py-1.5 text-left text-sm ${collapsed ? "justify-center px-0" : "gap-2.5 px-2.5"} ${
    active ? "bg-neutral-200/70 font-medium text-neutral-900" : "font-medium text-neutral-700 hover:bg-neutral-200/60"
  }`

function LibraryLink({ search, active, icon, collapsed, children }: { search: LibrarySearch; active: boolean; icon: React.ReactNode; collapsed: boolean; children: React.ReactNode }) {
  return (
    // exact: otherwise the router marks My videos ({}) current on every library view, since {} matches any search.
    <Link to="/home" search={search} activeOptions={{ exact: true }} aria-current={active ? "page" : undefined} aria-label={collapsed && typeof children === "string" ? children : undefined} title={collapsed && typeof children === "string" ? children : undefined} className={itemStyle(active, collapsed)}>
      <span className="shrink-0 text-neutral-600">{icon}</span>
      {!collapsed && <span className="truncate">{children}</span>}
    </Link>
  )
}

function PageLink({ href, active, icon, collapsed, children }: { href: string; active: boolean; icon: React.ReactNode; collapsed: boolean; children: string }) {
  return (
    <a href={href} aria-current={active ? "page" : undefined} aria-label={collapsed ? children : undefined} title={collapsed ? children : undefined} className={itemStyle(active, collapsed)}>
      <span className="shrink-0 text-neutral-600">{icon}</span>
      {!collapsed && <span className="truncate">{children}</span>}
    </a>
  )
}

/** The library's left rail, the same on every workspace page so moving between them keeps your place, as on Loom. */
export function LibrarySidebar({ data, active, onNewSpace, header, onRecord }: { data: SidebarData; active: SidebarActive; onNewSpace?: () => void; header?: React.ReactNode; onRecord?: () => void }) {
  const t = useT()
  const { spaces, manage } = data
  // Starts open so the server and first client render agree; a stored choice applies right after.
  const [collapsed, setCollapsed] = useState(false)
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(RAIL_KEY) === "1")
    } catch {
      // Private mode: the rail just stays open.
    }
  }, [])
  const toggle = () =>
    setCollapsed((current) => {
      try {
        localStorage.setItem(RAIL_KEY, current ? "0" : "1")
      } catch {
        // Not saved; still toggles for this page.
      }
      return !current
    })
  const toggleButton = (
    <button
      type="button"
      onClick={toggle}
      aria-label={collapsed ? t("library.sidebar.expand") : t("library.sidebar.collapse")}
      title={collapsed ? t("library.sidebar.expand") : t("library.sidebar.collapse")}
      aria-expanded={!collapsed}
      className="grid size-8 shrink-0 place-items-center rounded-lg text-neutral-500 hover:bg-neutral-200/70 hover:text-neutral-900"
    >
      <SidebarSimpleIcon size={18} />
    </button>
  )
  return (
    <nav aria-label={t("library.sidebar.label")} className={`hidden shrink-0 border-r border-neutral-200 bg-white/60 transition-[width] duration-150 md:block ${collapsed ? "w-14" : "w-60"}`}>
      <div className={`sticky flex flex-col gap-6 overflow-y-auto p-3 ${collapsed ? "items-stretch" : ""} ${header ? "top-0 h-dvh" : "top-14 h-[calc(100dvh-3.5rem)]"}`}>
        {collapsed ? (
          <div className="flex justify-center">{toggleButton}</div>
        ) : header ? (
          <div className="relative">
            {header}
            <div className="absolute top-0.5 right-0">{toggleButton}</div>
          </div>
        ) : (
          <div className="flex justify-end">{toggleButton}</div>
        )}
        <div className="space-y-0.5">
          <LibraryLink search={{}} active={active === "mine"} collapsed={collapsed} icon={<UserIcon size={16} />}>{t("library.nav.myVideos")}</LibraryLink>
          <LibraryLink search={{ view: "later" }} active={active === "later"} collapsed={collapsed} icon={<ClockIcon size={16} />}>{t("library.nav.watchLater")}</LibraryLink>
          <LibraryLink search={{ view: "archive" }} active={active === "archive"} collapsed={collapsed} icon={<ArchiveIcon size={16} />}>{t("library.nav.archive")}</LibraryLink>
        </div>
        {manage && (
          <div>
            {!collapsed && <div className="px-2.5 text-xs font-semibold tracking-wide text-neutral-600 uppercase">{t("library.sidebar.adminTools")}</div>}
            <div className={`space-y-0.5 ${collapsed ? "border-t border-neutral-200 pt-3" : "mt-1"}`}>
              <PageLink href="/settings?tab=members" active={false} collapsed={collapsed} icon={<UsersIcon size={16} />}>{t("library.sidebar.members")}</PageLink>
              <PageLink href="/settings" active={false} collapsed={collapsed} icon={<GearIcon size={16} />}>{t("library.sidebar.workspace")}</PageLink>
            </div>
          </div>
        )}
        <div>
          {!collapsed && (
            <div className="flex items-center justify-between px-2.5 text-xs font-semibold tracking-wide text-neutral-600 uppercase">
              {t("library.sidebar.spaces")}
              {manage && onNewSpace && (
                <button type="button" aria-label={t("library.sidebar.newSpace")} onClick={onNewSpace} className="rounded p-0.5 hover:bg-neutral-200">
                  <PlusIcon size={14} />
                </button>
              )}
            </div>
          )}
          <div className={`space-y-0.5 ${collapsed ? "border-t border-neutral-200 pt-3" : "mt-1"}`}>
            {spaces.map((space) => (
              <LibraryLink key={space.id} search={{ view: "space", space: space.id }} active={active === space.id} collapsed={collapsed} icon={<UsersThreeIcon size={16} />}>
                {space.name}
              </LibraryLink>
            ))}
            {!collapsed && spaces.length === 0 && (
              <p className="px-2.5 py-1 text-xs text-neutral-500">{manage ? t("library.sidebar.noSpacesManage") : t("library.sidebar.noSpaces")}</p>
            )}
          </div>
        </div>
        {!collapsed && <PoweredBy className="mt-auto pb-20 pt-4" />}
        <a
          href="/record"
          onClick={(event) => openPanel(event, onRecord)}
          aria-label={t("library.actions.recordVideo")}
          title={collapsed ? t("library.actions.recordVideo") : undefined}
          className={`group fixed bottom-4 left-3 z-20 flex items-center gap-3 rounded-full text-sm font-semibold text-neutral-900 ${collapsed ? "w-8" : "w-[calc(15rem-1.5rem)] pl-1 pr-3"}`}
        >
          <span className={`grid shrink-0 place-items-center rounded-full bg-red-600 shadow-md ring-2 ring-red-600/25 transition group-hover:bg-red-500 group-hover:ring-4 ${collapsed ? "size-8" : "size-10"}`}>
            <span className="size-3.5 rounded-full border-2 border-white bg-white/0 group-hover:bg-white" />
          </span>
          {!collapsed && t("library.actions.record")}
        </a>
      </div>
    </nav>
  )
}
