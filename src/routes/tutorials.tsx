import { createFileRoute, redirect } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import { getRequest } from "@tanstack/react-start/server"
import { ArrowLeftIcon } from "@phosphor-icons/react"
import { useCallback, useEffect, useRef, useState } from "react"
import { BrandMark } from "@/components/brand-mark"
import { CommandPaletteButton } from "@/components/command-palette"
import { TutorialJobList } from "@/components/tutorial-job-list"
import { TutorialRecipePanel } from "@/components/tutorial-recipe-panel"
import type { JobsResponse, RecipeSummary } from "@/components/tutorial-types"
import { getSessionUser } from "@/lib/auth.server"
import { APP_NAME } from "@/lib/brand"
import { canManage } from "@/lib/plans"
import { getWorkspaceContext } from "@/lib/workspace.server"

const loadAccess = createServerFn({ method: "GET" }).handler(async () => {
  const request = getRequest()
  const user = await getSessionUser(request)
  if (!user) return null
  const { workspace, role } = await getWorkspaceContext(request, user)
  return { allowed: canManage(role), name: workspace.name } as const
})

export const Route = createFileRoute("/tutorials")({
  loader: async () => {
    const data = await loadAccess()
    if (!data) throw redirect({ to: "/signin", search: { redirect: "/tutorials" } })
    return data
  },
  head: () => ({ meta: [{ title: `Tutorials · ${APP_NAME}` }, { name: "robots", content: "noindex" }] }),
  component: TutorialsPage,
})

function TutorialsPage() {
  const data = Route.useLoaderData()
  const linkStyle =
    "inline-flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100"
  if (!data.allowed)
    return (
      <main className="library-shell min-h-dvh p-8">
        <a href="/app" className={linkStyle}>
          <ArrowLeftIcon /> Library
        </a>
        <h1 className="mt-8 text-2xl font-semibold">Tutorials</h1>
        <p className="mt-2 text-neutral-600">Only workspace owners and admins can record tutorials.</p>
      </main>
    )
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
      <TutorialsBody />
    </main>
  )
}

function TutorialsBody() {
  const [recipes, setRecipes] = useState<Array<RecipeSummary> | null>(null)
  const [jobs, setJobs] = useState<JobsResponse | null>(null)
  const [failed, setFailed] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasActive = Boolean(jobs?.jobs.some((job) => job.state === "queued" || job.state === "running"))

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/v1/tutorials/jobs", { cache: "no-store" })
      if (!response.ok) throw new Error(String(response.status))
      setJobs((await response.json()) as JobsResponse)
      setFailed(false)
    } catch {
      setFailed(true)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch("/api/v1/tutorials/recipes")
      .then((response) => (response.ok ? (response.json() as Promise<{ recipes: Array<RecipeSummary> }>) : Promise.reject(new Error())))
      .then((body) => !cancelled && setRecipes(body.recipes))
      .catch(() => !cancelled && setFailed(true))
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let stopped = false
    const tick = async () => {
      await refresh()
      if (!stopped) timer.current = setTimeout(() => void tick(), hasActive ? 3000 : 15000)
    }
    void tick()
    return () => {
      stopped = true
      if (timer.current) clearTimeout(timer.current)
    }
  }, [refresh, hasActive])

  const online = Boolean(jobs?.runnerOnline)

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8 sm:py-12">
      <h1 className="text-3xl font-semibold tracking-tight">Tutorials</h1>
      <p className="mt-2 max-w-prose text-sm text-neutral-500">
        A runner on your Mac performs a recipe in a browser, records it, adds narration and uploads a private video here for you to review.
      </p>

      <p role="status" className="mt-6 flex flex-wrap items-center gap-x-2 gap-y-1 border-y border-neutral-200 py-3 text-sm">
        <span className={`inline-block size-2 rounded-full ${online ? "bg-emerald-600" : "bg-neutral-400"}`} aria-hidden="true" />
        <span className="font-medium">{jobs ? (online ? "Runner online" : "No runner is connected") : "Checking for a runner…"}</span>
        {jobs && !online && (
          <span className="text-neutral-600">
            Start one with <code className="rounded bg-neutral-200/70 px-1.5 py-0.5 text-xs">cd runner &amp;&amp; npm start</code>. Setup steps are in docs/tutorial-runner.md.
          </span>
        )}
      </p>

      {failed && (
        <p role="alert" className="mt-4 text-sm text-red-700">
          Couldn't load tutorials. Check your connection; this page will keep trying.
        </p>
      )}

      <section aria-labelledby="record-heading" className="mt-10">
        <h2 id="record-heading" className="text-lg font-semibold">
          Record a tutorial
        </h2>
        {recipes ? (
          <TutorialRecipePanel recipes={recipes} runnerOnline={online} onStarted={() => void refresh()} />
        ) : (
          <p className="mt-4 text-sm text-neutral-500">Loading recipes…</p>
        )}
      </section>

      <section aria-labelledby="jobs-heading" className="mt-12">
        <h2 id="jobs-heading" className="text-lg font-semibold">
          Recordings
        </h2>
        {jobs ? <TutorialJobList jobs={jobs.jobs} onChanged={() => void refresh()} /> : <p className="mt-4 text-sm text-neutral-500">Loading…</p>}
      </section>
    </div>
  )
}
