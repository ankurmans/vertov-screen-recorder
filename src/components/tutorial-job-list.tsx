import { useState } from "react"
import { VertovIcon } from "@/components/vertov-icon"
import type { TutorialJob } from "@/lib/tutorials/jobs"

const STATE_LABEL: Record<TutorialJob["state"], string> = {
  queued: "Queued",
  running: "Recording",
  completed: "Finished",
  failed: "Failed",
  cancelled: "Cancelled",
}

const STATE_STYLE: Record<TutorialJob["state"], string> = {
  queued: "bg-neutral-200 text-neutral-700",
  running: "bg-amber-100 text-amber-900",
  completed: "bg-emerald-100 text-emerald-900",
  failed: "bg-red-100 text-red-800",
  cancelled: "bg-neutral-200 text-neutral-600",
}

const STAGE_LABEL: Record<string, string> = {
  preparing: "Preparing the browser",
  recording: "Recording the steps",
  verifying: "Checking the results",
  narrating: "Making the narration",
  producing: "Putting the video together",
  uploading: "Uploading",
}

export function TutorialJobList({ jobs, onChanged }: { jobs: Array<TutorialJob>; onChanged: () => void }) {
  if (jobs.length === 0) return <p className="mt-4 text-sm text-neutral-500">No recordings yet. Choose a recipe above and start one.</p>
  return (
    <ul aria-label="Recording jobs" className="mt-4 divide-y divide-neutral-200 border-y border-neutral-200">
      {jobs.map((job) => (
        <JobRow key={job.id} job={job} onChanged={onChanged} />
      ))}
    </ul>
  )
}

function JobRow({ job, onChanged }: { job: TutorialJob; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)
  const active = job.state === "queued" || job.state === "running"

  async function cancel() {
    setBusy(true)
    setCancelError(null)
    try {
      const response = await fetch(`/api/v1/tutorials/jobs/${job.id}/cancel`, { method: "POST" })
      if (!response.ok) setCancelError("Couldn't cancel this job.")
      onChanged()
    } catch {
      setCancelError("Couldn't reach Vertov.")
    } finally {
      setBusy(false)
    }
  }

  const detail = job.cancelRequested && active ? "Cancelling…" : [job.stage ? (STAGE_LABEL[job.stage] ?? job.stage) : null, job.message].filter(Boolean).join(": ")
  const demonstrated = job.verified.filter((item) => item.verified)
  const unverified = job.verified.filter((item) => !item.verified)

  return (
    <li className="py-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="min-w-0 flex-1 truncate text-sm font-medium">{job.title}</p>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATE_STYLE[job.state]}`}>{STATE_LABEL[job.state]}</span>
        {active && (
          <button
            type="button"
            onClick={() => void cancel()}
            disabled={busy || job.cancelRequested}
            aria-label={`Cancel ${job.title}`}
            className="rounded-lg border border-neutral-200 bg-white px-3 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-50"
          >
            Cancel
          </button>
        )}
      </div>
      <p className="mt-1 text-xs text-neutral-500">
        Started {new Date(job.createdAt.replace(" ", "T") + (job.createdAt.includes("Z") ? "" : "Z")).toLocaleString()}
        {job.attempts > 1 ? `, attempt ${job.attempts}` : ""}
        {job.presenter ? ", with presenter portrait" : ""}
      </p>

      {active && (
        <div className="mt-3">
          <div role="progressbar" aria-label={`${job.title} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={job.percent} className="h-1.5 overflow-hidden rounded-full bg-neutral-200">
            <div className="h-full rounded-full bg-neutral-900 transition-[width]" style={{ width: `${job.state === "queued" ? 0 : Math.max(job.percent, 3)}%` }} />
          </div>
          <p className="mt-1.5 text-xs text-neutral-600">{job.state === "queued" ? "Waiting for a runner to pick this up." : detail || "Working…"}</p>
        </div>
      )}

      {cancelError && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {cancelError}
        </p>
      )}

      {(job.state === "failed" || job.state === "cancelled") && job.error && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {job.step ? `Stopped at ${job.step}. ` : ""}
          {job.error}
        </p>
      )}

      {job.state === "completed" && (
        <div className="mt-3">
          {job.videoUrl && (
            <a href={job.videoUrl} className="inline-flex items-center gap-2 text-sm font-semibold text-red-700 hover:underline">
              <VertovIcon name="play" size={14} /> Open the video
              <VertovIcon name="external" size={14} />
            </a>
          )}
          <p className="mt-1 text-xs text-neutral-500">It stays private until you have reviewed it.</p>
          {job.verified.length > 0 && (
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <StepList title="Demonstrated" steps={demonstrated} icon="check" empty="No step was verified." />
              <StepList title="Clicked through, not verified" steps={unverified} icon="circle" empty="Every step was verified." />
            </div>
          )}
        </div>
      )}
    </li>
  )
}

function StepList({ title, steps, icon, empty }: { title: string; steps: Array<{ step: string; note?: string }>; icon: "check" | "circle"; empty: string }) {
  return (
    <div>
      <h4 className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">{title}</h4>
      {steps.length === 0 ? (
        <p className="mt-1.5 text-xs text-neutral-500">{empty}</p>
      ) : (
        <ul className="mt-1.5 space-y-1">
          {steps.map((item) => (
            <li key={item.step} className="flex items-start gap-2 text-sm text-neutral-700">
              <VertovIcon name={icon} size={14} className="mt-0.5 text-neutral-500" />
              <span>
                {item.step}
                {item.note ? <span className="block text-xs text-neutral-500">{item.note}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
