import { CloudArrowUpIcon, XIcon } from "@phosphor-icons/react"
import { useRef, useState } from "react"
import { LibraryFullCard } from "@/components/library-full"
import { uploadVideoFile } from "@/lib/file-upload"
import type { LibraryFull } from "@/lib/library-full"
import { LibraryFullError } from "@/lib/library-full"
import { useT } from "@/lib/i18n/react"

interface FileJob {
  name: string
  progress: number
  status: "uploading" | "done" | "failed"
  message?: string
  id?: string
}

/** Upload video files from disk, or bring public Looms over by link. */
export function ImportDialog({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const t = useT()
  const [jobs, setJobs] = useState<Array<FileJob>>([])
  const [dragging, setDragging] = useState(false)
  const [full, setFull] = useState<LibraryFull | null>(null)
  const input = useRef<HTMLInputElement>(null)

  async function uploadFiles(files: Array<File>) {
    const videos = files.filter((file) => file.type.startsWith("video/") || /\.(mp4|mov|webm|m4v)$/i.test(file.name))
    const start = jobs.length
    setFull(null)
    setJobs((current) => [...current, ...videos.map((file) => ({ name: file.name, progress: 0, status: "uploading" as const }))])
    const patch = (index: number, next: Partial<FileJob>) =>
      setJobs((current) => current.map((job, i) => (i === start + index ? { ...job, ...next } : job)))
    for (const [index, file] of videos.entries()) {
      try {
        const id = await uploadVideoFile(file, (progress) => patch(index, { progress }))
        patch(index, { status: "done", progress: 1, id })
        onImported()
      } catch (error) {
        if (error instanceof LibraryFullError) setFull(error.library)
        patch(index, { status: "failed", message: error instanceof LibraryFullError ? t("library.import.libraryFull") : error instanceof Error ? error.message : t("library.import.uploadFailed") })
      }
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
            {t("library.import.title")}
          </h2>
          <button type="button" aria-label={t("common.close")} onClick={onClose} className="rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-100">
            <XIcon size={18} />
          </button>
        </div>
        {full && <LibraryFullCard library={full} className="mt-4" />}
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
              <span className="mt-2 text-sm font-medium text-neutral-800">{t("library.import.dropTitle")}</span>
              <span className="mt-0.5 text-xs text-neutral-500">{t("library.import.dropHint")}</span>
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
                          {t("library.import.open")}
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
      </div>
    </div>
  )
}
