import { CloudArrowUpIcon, LinkSimpleIcon, XIcon } from "@phosphor-icons/react"
import { useRef, useState } from "react"
import { uploadVideoFile } from "@/lib/file-upload"

interface FileJob {
  name: string
  progress: number
  status: "uploading" | "done" | "failed"
  message?: string
  id?: string
}

/** Upload video files from disk, or bring public Looms over by link. */
export function ImportDialog({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [tab, setTab] = useState<"files" | "loom">("files")
  const [jobs, setJobs] = useState<Array<FileJob>>([])
  const [dragging, setDragging] = useState(false)
  const [links, setLinks] = useState("")
  const [loomResult, setLoomResult] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  async function uploadFiles(files: Array<File>) {
    const videos = files.filter((file) => file.type.startsWith("video/") || /\.(mp4|mov|webm|m4v)$/i.test(file.name))
    const start = jobs.length
    setJobs((current) => [...current, ...videos.map((file) => ({ name: file.name, progress: 0, status: "uploading" as const }))])
    const patch = (index: number, next: Partial<FileJob>) =>
      setJobs((current) => current.map((job, i) => (i === start + index ? { ...job, ...next } : job)))
    for (const [index, file] of videos.entries()) {
      try {
        const id = await uploadVideoFile(file, (progress) => patch(index, { progress }))
        patch(index, { status: "done", progress: 1, id })
        onImported()
      } catch (error) {
        patch(index, { status: "failed", message: error instanceof Error ? error.message : "Upload failed" })
      }
    }
  }

  async function importLooms() {
    const urls = links.split(/\s+/).filter(Boolean)
    if (urls.length === 0) return
    setBusy(true)
    setLoomResult(null)
    const response = await fetch("/api/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ urls }),
    }).catch(() => null)
    const body = (await response?.json().catch(() => null)) as {
      error?: string
      results?: Array<{ id?: string; error?: string }>
    } | null
    setBusy(false)
    if (!response?.ok || !body?.results) return setLoomResult(body?.error ?? "Import failed")
    const ok = body.results.filter((result) => result.id).length
    const failed = body.results.length - ok
    setLoomResult(
      `${ok} video${ok === 1 ? "" : "s"} on the way${failed ? `. ${failed} couldn't be read; only public Looms can be imported.` : "."}`,
    )
    if (ok) {
      setLinks("")
      onImported()
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-neutral-950/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-title"
        className="pop-in w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 id="import-title" className="text-lg font-semibold text-neutral-900">
            Add videos
          </h2>
          <button type="button" aria-label="Close" onClick={onClose} className="rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-100">
            <XIcon size={18} />
          </button>
        </div>
        <div className="mt-4 flex gap-1 rounded-xl bg-neutral-100 p-1 text-sm font-medium">
          {(
            [
              ["files", "Upload files"],
              ["loom", "Bring your Looms"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              className={`flex-1 rounded-lg px-3 py-1.5 ${tab === value ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-600"}`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "files" ? (
          <div className="mt-4">
            <button
              type="button"
              onClick={() => input.current?.click()}
              onDragOver={(event) => {
                event.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault()
                setDragging(false)
                void uploadFiles([...event.dataTransfer.files])
              }}
              className={`flex w-full flex-col items-center rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors ${
                dragging ? "border-red-500 bg-red-50" : "border-neutral-300 hover:bg-neutral-50"
              }`}
            >
              <CloudArrowUpIcon size={32} className="text-neutral-500" />
              <span className="mt-2 text-sm font-medium text-neutral-800">Drop videos here, or click to choose</span>
              <span className="mt-0.5 text-xs text-neutral-500">MP4, MOV or WebM. Each gets a link, transcript and summary.</span>
            </button>
            <input
              ref={input}
              type="file"
              accept="video/mp4,video/quicktime,video/webm,.mov,.m4v"
              multiple
              hidden
              onChange={(event) => {
                void uploadFiles([...(event.target.files ?? [])])
                event.target.value = ""
              }}
            />
            {jobs.length > 0 && (
              <ul className="mt-4 space-y-2">
                {jobs.map((job, index) => (
                  <li key={`${job.name}-${index}`} className="text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate text-neutral-800">{job.name}</span>
                      {job.status === "done" && job.id ? (
                        <a href={`/${job.id}`} className="shrink-0 font-medium text-red-600 hover:underline">
                          Open
                        </a>
                      ) : (
                        <span className={`shrink-0 text-xs ${job.status === "failed" ? "text-red-600" : "text-neutral-500"}`}>
                          {job.status === "failed" ? job.message : `${Math.round(job.progress * 100)}%`}
                        </span>
                      )}
                    </div>
                    {job.status === "uploading" && (
                      <div className="mt-1 h-1 overflow-hidden rounded-full bg-neutral-100">
                        <div className="h-full bg-red-600 transition-[width]" style={{ width: `${Math.round(job.progress * 100)}%` }} />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="mt-4">
            <label htmlFor="loom-links" className="text-sm font-medium text-neutral-800">
              Loom links, one per line
            </label>
            <textarea
              id="loom-links"
              value={links}
              onChange={(event) => setLinks(event.target.value)}
              rows={5}
              placeholder="https://www.loom.com/share/…"
              className="mt-1.5 w-full rounded-xl border border-neutral-300 px-3 py-2 font-mono text-xs text-neutral-800 placeholder:text-neutral-500 focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10 focus:outline-none"
            />
            <p className="mt-1 text-xs text-neutral-500">
              Videos must be public on Loom. Titles come along; transcripts are made fresh. Up to 50 at a time.
            </p>
            {loomResult && <p className="mt-2 text-sm text-neutral-800">{loomResult}</p>}
            <button
              type="button"
              disabled={busy || !links.trim()}
              onClick={() => void importLooms()}
              className="mt-3 inline-flex items-center gap-2 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-800 disabled:opacity-50"
            >
              <LinkSimpleIcon size={16} />
              {busy ? "Starting…" : "Import"}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
