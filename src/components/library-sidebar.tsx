import { Link } from "@tanstack/react-router"
import { ArchiveIcon, ChartBarIcon, ClockIcon, PlusIcon, UserIcon, UsersThreeIcon } from "@phosphor-icons/react"
import { VertovIcon } from "@/components/vertov-icon"
import { HOSTED_EDITION } from "@/lib/edition"
import { formatHours } from "@/lib/plans"
import type { LibrarySearch } from "@/lib/library-search"

export interface SidebarData {
  spaces: Array<{ id: string; name: string }>
  manage: boolean
  hosted: boolean
  plan: string
  usage: { usedHours: number; limitHours: number | null }
}

/** "mine", "later", "archive", "playlists", "analytics", "tutorials", or a space id. */
export type SidebarActive = string | null

const itemStyle = (active: boolean) =>
  `flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm ${
    active ? "bg-neutral-200/70 font-medium text-neutral-900" : "text-neutral-600 hover:bg-neutral-200/60"
  }`

function LibraryLink({ search, active, icon, children }: { search: LibrarySearch; active: boolean; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    // exact: otherwise the router marks My videos ({}) current on every library view, since {} matches any search.
    <Link to="/home" search={search} activeOptions={{ exact: true }} aria-current={active ? "page" : undefined} className={itemStyle(active)}>
      <span className="shrink-0 text-neutral-500">{icon}</span>
      <span className="truncate">{children}</span>
    </Link>
  )
}

function PageLink({ href, active, icon, children }: { href: string; active: boolean; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <a href={href} aria-current={active ? "page" : undefined} className={itemStyle(active)}>
      <span className="shrink-0 text-neutral-500">{icon}</span>
      <span className="truncate">{children}</span>
    </a>
  )
}

/** The library's left rail, the same on every workspace page so moving between them keeps your place, as on Loom. */
export function LibrarySidebar({ data, active, onNewSpace }: { data: SidebarData; active: SidebarActive; onNewSpace?: () => void }) {
  const { spaces, manage, usage } = data
  return (
    <nav aria-label="Library" className="hidden w-48 shrink-0 md:block">
      <div className="sticky top-20 space-y-6">
        <div className="space-y-0.5">
          <LibraryLink search={{}} active={active === "mine"} icon={<UserIcon size={16} />}>My videos</LibraryLink>
          <LibraryLink search={{ view: "later" }} active={active === "later"} icon={<ClockIcon size={16} />}>Watch later</LibraryLink>
          <LibraryLink search={{ view: "archive" }} active={active === "archive"} icon={<ArchiveIcon size={16} />}>Archive</LibraryLink>
          {HOSTED_EDITION && <PageLink href="/playlists" active={active === "playlists"} icon={<VertovIcon name="playlist" size={16} />}>Playlists</PageLink>}
          {HOSTED_EDITION && manage && <PageLink href="/analytics" active={active === "analytics"} icon={<ChartBarIcon size={16} />}>Analytics</PageLink>}
          {HOSTED_EDITION && <PageLink href="/tutorials" active={active === "tutorials"} icon={<VertovIcon name="tutorial" size={16} />}>Tutorials</PageLink>}
        </div>
        <div>
          <div className="flex items-center justify-between px-2.5 text-xs font-semibold tracking-wide text-neutral-500 uppercase">
            Spaces
            {manage && onNewSpace && (
              <button type="button" aria-label="New space" onClick={onNewSpace} className="rounded p-0.5 hover:bg-neutral-200">
                <PlusIcon size={14} />
              </button>
            )}
          </div>
          <div className="mt-1 space-y-0.5">
            {spaces.map((space) => (
              <LibraryLink key={space.id} search={{ view: "space", space: space.id }} active={active === space.id} icon={<UsersThreeIcon size={16} />}>
                {space.name}
              </LibraryLink>
            ))}
            {spaces.length === 0 && (
              <p className="px-2.5 py-1 text-xs text-neutral-500">{manage ? "Make a space to share videos with everyone here." : "No spaces yet."}</p>
            )}
          </div>
        </div>
        <UsageMeter usedHours={usage.usedHours} limitHours={usage.limitHours} hosted={data.hosted} plan={data.plan} manage={manage} />
      </div>
    </nav>
  )
}

function UsageMeter({ usedHours, limitHours, hosted, plan, manage }: { usedHours: number; limitHours: number | null; hosted: boolean; plan: string; manage: boolean }) {
  if (!hosted || limitHours === null) return null
  const fraction = Math.min(1, usedHours / limitHours)
  const full = fraction >= 1
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-3">
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-medium text-neutral-800">Library</span>
        <span className="text-neutral-500 tabular-nums">
          {formatHours(usedHours)} of {formatHours(limitHours)}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-100">
        <div className={`h-full rounded-full ${full ? "bg-red-600" : fraction > 0.8 ? "bg-amber-500" : "bg-neutral-800"}`} style={{ width: `${Math.max(2, fraction * 100)}%` }} />
      </div>
      {manage && (full || fraction > 0.8 || plan === "free") && (
        <a href="/settings?tab=billing" className="mt-2 block text-xs font-medium text-red-600 hover:underline">
          {full ? "Library full. Add hours" : plan === "free" ? "Upgrade for more hours" : "Add hours"}
        </a>
      )}
    </div>
  )
}
