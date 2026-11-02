import { useEffect, useState } from "react"
import { formatTimeAgo } from "@/lib/format"

interface Insights {
  viewerCount: number
  views: number
  ctaClicks?: number
  ctaLabel?: string | null
  averageCompletion: number | null
  emails?: Array<{ email: string; at: string }>
  viewers: Array<{
    name: string | null
    avatar: string | null
    percent: number
    place: string | null
    at: string
  }>
}

/** Owner-only: who watched and how far they got. */
export function InsightsPanel({ uploadId, className }: { uploadId: string; className?: string }) {
  const [insights, setInsights] = useState<Insights | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = () =>
      fetch(`/api/insights/${uploadId}`)
        .then((response) => (response.ok ? response.json<Insights>() : Promise.reject(new Error())))
        .then((body: Insights) => {
          if (!cancelled) { setInsights(body); setFailed(false) }
        })
        .catch(() => !cancelled && setFailed(true))
    void load()
    const timer = setInterval(() => void load(), 15000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [uploadId])

  if (failed) return <p className="p-4 text-sm text-neutral-500">Couldn't load insights.</p>
  if (!insights) return <p className="p-4 text-sm text-neutral-400">Loading…</p>

  return (
    <div className={`flex flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white ${className ?? ""}`}>
      <div className="grid grid-cols-2 gap-px border-b border-neutral-200 bg-neutral-200">
        <Stat label="Views" value={String(insights.views)} />
        <Stat
          label="Avg. progress"
          value={insights.averageCompletion == null ? "—" : `${Math.round(insights.averageCompletion * 100)}%`}
        />
        {insights.ctaLabel && <Stat label={`"${insights.ctaLabel}" clicks`} value={String(insights.ctaClicks ?? 0)} />}
      </div>
      <p className="border-b border-neutral-200 px-4 py-3 text-xs leading-relaxed text-neutral-500">
        Progress is the furthest point reached, including seeking. {insights.viewerCount.toLocaleString()} viewer–video records; latest 500 shown. Views count opens, not unique people. New owner visits are excluded; older totals may include them.
      </p>
      <a
        href={`/api/insights/${uploadId}?format=csv`}
        className="border-b border-neutral-200 px-4 py-2 text-right text-xs font-medium text-neutral-600 hover:text-neutral-900"
      >
        Download CSV
      </a>
      {insights.emails && insights.emails.length > 0 && (
        <div className="border-b border-neutral-200 px-4 py-3 text-sm">
          <p className="font-medium text-neutral-900">{insights.emails.length} email{insights.emails.length === 1 ? "" : "s"} collected</p>
          <ul className="mt-1 max-h-24 overflow-y-auto text-neutral-600">
            {insights.emails.map((entry) => (
              <li key={entry.email} className="truncate">
                {entry.email}
              </li>
            ))}
          </ul>
        </div>
      )}
      <ul className="min-h-0 flex-1 divide-y divide-neutral-100 overflow-y-auto">
        {insights.viewers.length === 0 && (
          <li className="p-4 text-sm text-neutral-500">
            No viewer progress recorded yet. Share the link and check back.
          </li>
        )}
        {insights.viewers.map((viewer, index) => (
          <li key={index} className="flex items-center gap-3 px-4 py-3">
            {viewer.avatar ? (
              <img src={viewer.avatar} alt="" className="size-8 rounded-full" />
            ) : (
              <span className="flex size-8 items-center justify-center rounded-full bg-neutral-100 text-sm">👤</span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-neutral-900">
                {viewer.name ?? "Anonymous viewer"}
              </p>
              <p className="truncate text-xs text-neutral-500">
                {[viewer.place, formatTimeAgo(viewer.at)].filter(Boolean).join(" · ")}
              </p>
            </div>
            <div className="w-20">
              <div className="h-1.5 overflow-hidden rounded-full bg-neutral-100">
                <div className="h-full rounded-full bg-red-600" style={{ width: `${Math.round(viewer.percent * 100)}%` }} />
              </div>
              <p className="mt-0.5 text-right text-[11px] text-neutral-500 tabular-nums">
                {Math.round(viewer.percent * 100)}%
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white px-4 py-3">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="text-xl font-semibold text-neutral-900 tabular-nums">{value}</p>
    </div>
  )
}
