import { createFileRoute, redirect } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import { getRequest } from "@tanstack/react-start/server"
import { ArrowLeftIcon, ArrowUpRightIcon } from "@phosphor-icons/react"
import { BrandMark } from "@/components/brand-mark"
import { CommandPaletteButton } from "@/components/command-palette"
import { workspaceInsights } from "@/lib/analytics.server"
import { getSessionUser } from "@/lib/auth.server"
import { APP_NAME } from "@/lib/brand"
import { canManage } from "@/lib/plans"
import { getWorkspaceContext } from "@/lib/workspace.server"

const loadAnalytics = createServerFn({ method: "GET" }).handler(async () => {
  const request = getRequest()
  const user = await getSessionUser(request)
  if (!user) return null
  const { workspace, role } = await getWorkspaceContext(request, user)
  if (!canManage(role)) return { allowed: false } as const
  return { allowed: true, name: workspace.name, stats: await workspaceInsights(workspace.id) } as const
})

export const Route = createFileRoute("/analytics")({
  loader: async () => {
    const data = await loadAnalytics()
    if (!data) throw redirect({ to: "/signin", search: { redirect: "/analytics" } })
    return data
  },
  head: () => ({ meta: [{ title: `Analytics · ${APP_NAME}` }, { name: "robots", content: "noindex" }] }),
  component: AnalyticsPage,
})

function AnalyticsPage() {
  const data = Route.useLoaderData()
  const linkStyle =
    "inline-flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100"
  if (!data.allowed)
    return (
      <main className="library-shell min-h-dvh p-8">
        <a href="/app" className={linkStyle}>
          <ArrowLeftIcon /> Library
        </a>
        <h1 className="mt-8 text-2xl font-semibold">Workspace analytics</h1>
        <p className="mt-2 text-neutral-600">Only workspace owners and admins can see these numbers.</p>
      </main>
    )
  const { stats } = data
  const recentViews = stats.days.reduce((sum, day) => sum + day.views, 0)
  const peak = Math.max(1, ...stats.days.map((day) => day.views))
  const dateLabel = (day: string) =>
    new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })
  return (
    <main className="library-shell min-h-dvh text-neutral-900">
      <header className="flex h-16 items-center gap-3 border-b border-neutral-200 px-4 sm:px-8">
        <a href="/app" className="flex items-center gap-2 rounded-lg p-1 text-sm hover:text-red-700">
          <BrandMark />
          <ArrowLeftIcon size={16} /> Library
        </a>
        <span className="min-w-0 flex-1 truncate text-sm text-neutral-500">{data.name}</span>
        <CommandPaletteButton />
      </header>
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8 sm:py-12">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Analytics</h1>
            <p className="mt-2 text-sm text-neutral-500">
              Every video in this workspace, including archived recordings.
            </p>
          </div>
          <a href="/api/workspace/insights?format=csv" className={linkStyle}>
            Download CSV <ArrowUpRightIcon size={14} />
          </a>
        </div>
        <dl className="mt-8 grid grid-cols-2 gap-y-6 border-y border-neutral-200 py-6 sm:grid-cols-4">
          {[
            ["Videos", stats.totalVideos.toLocaleString(), "In this workspace"],
            ["Views", stats.totalViews.toLocaleString(), "All time"],
            [
              "Avg. progress",
              stats.averageCompletion == null ? "—" : `${Math.round(stats.averageCompletion * 100)}%`,
              `${stats.progressSamples.toLocaleString()} viewer–video records`,
            ],
            ["CTA clicks", stats.ctaClicks.toLocaleString(), "All time"],
          ].map(([label, value, note]) => (
            <div key={label} className="pr-4">
              <dt className="text-sm text-neutral-500">{label}</dt>
              <dd className="mt-2 text-3xl font-semibold tabular-nums">{value}</dd>
              <dd className="mt-1 text-xs text-neutral-500">{note}</dd>
            </div>
          ))}
        </dl>
        <section className="mt-10" aria-labelledby="daily-views">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="daily-views" className="text-lg font-semibold">
              Views over time
            </h2>
            <p className="text-sm text-neutral-500">{recentViews.toLocaleString()} views · Last 30 days · UTC</p>
          </div>
          {recentViews === 0 && (
            <p className="mt-4 text-sm text-neutral-500">
              No views recorded in this period. Share a video to start seeing activity here.
            </p>
          )}
          <div
            className="mt-6 flex h-40 items-end gap-1 border-b border-neutral-300"
            role="img"
            aria-label={`${recentViews} recorded views in the last 30 days. Daily values are in the table below.`}
          >
            {stats.days.map((day) => (
              <div
                key={day.day}
                title={`${dateLabel(day.day)}: ${day.views} views`}
                className="flex-1 bg-red-600"
                style={{ height: `${(day.views / peak) * 100}%` }}
              />
            ))}
          </div>
          <div className="mt-2 flex justify-between text-xs text-neutral-500">
            <span>{dateLabel(stats.days[0].day)}</span>
            <span>{dateLabel(stats.days[29].day)}</span>
          </div>
          <details className="mt-4 text-sm">
            <summary className="w-fit cursor-pointer text-neutral-600 hover:text-red-700">Daily view counts</summary>
            <div className="mt-3 max-h-48 overflow-y-auto">
              <table className="w-full text-left">
                <caption className="sr-only">Daily views, dates in UTC</caption>
                <thead>
                  <tr>
                    <th scope="col" className="py-1">
                      Date (UTC)
                    </th>
                    <th scope="col" className="text-right">
                      Views
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {stats.days.map((day) => (
                    <tr key={day.day} className="border-t border-neutral-200">
                      <th scope="row" className="py-1 font-normal">
                        {day.day}
                      </th>
                      <td className="text-right tabular-nums">{day.views}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </section>
        <section className="mt-10" aria-labelledby="top-videos">
          <h2 id="top-videos" className="text-lg font-semibold">
            Top videos <span className="text-sm font-normal text-neutral-500">by all-time views</span>
          </h2>
          {stats.top.length === 0 ? (
            <p className="mt-4 text-sm text-neutral-500">
              Your recordings will appear here.{" "}
              <a className="underline" href="/record">
                Record your first video
              </a>
              .
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 text-xs text-neutral-500">
                    <th scope="col" className="pb-3 font-medium">
                      Recording
                    </th>
                    <th scope="col" className="px-4 pb-3 text-right font-medium">
                      Views
                    </th>
                    <th scope="col" className="pb-3 text-right font-medium whitespace-nowrap">
                      CTA clicks
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {stats.top.map((video) => (
                    <tr key={video.id} className="border-b border-neutral-200">
                      <th scope="row" className="py-4 font-medium">
                        <a
                          href={`/${video.id}?panel=insights`}
                          className="inline-flex items-center gap-2 hover:text-red-700"
                        >
                          {video.title?.trim() || "Untitled video"}
                          <ArrowUpRightIcon size={14} className="shrink-0" />
                          <span className="sr-only"> — View analytics</span>
                        </a>
                      </th>
                      <td className="px-4 text-right tabular-nums">{video.views.toLocaleString()}</td>
                      <td className="text-right tabular-nums">{video.ctaClicks.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <details className="mt-8 border-t border-neutral-200 pt-5 text-sm text-neutral-500">
          <summary className="w-fit cursor-pointer hover:text-neutral-900">How these numbers work</summary>
          <div className="mt-3 max-w-3xl space-y-2 leading-relaxed">
            <p>
              Views count share-page opens, deduplicated in the viewer’s browser. They aren’t unique people or
              guaranteed video plays. Browser storage resets and other devices can count again.
            </p>
            <p>
              Progress is the furthest point reached in a recording, including seeking. The average uses all
              viewer–video progress records, rather than averaging video averages. It is not time spent watching. CTA
              clicks count button clicks, not completed conversions.
            </p>
            <p>
              New owner visits are excluded. Earlier view totals may include owner visits; those historical events
              cannot be separated. Deleted videos are excluded from every number on this page.
            </p>
          </div>
        </details>
      </div>
    </main>
  )
}
