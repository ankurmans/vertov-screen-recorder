import { FolderSimpleIcon, UserIcon, UsersThreeIcon } from "@phosphor-icons/react"
import { createServerFn } from "@tanstack/react-start"
import { getRequest } from "@tanstack/react-start/server"
import { useState } from "react"
import { Button } from "@cloudflare/kumo/components/button"
import type { Folder, Space } from "@/db/schema"
import { getSessionUser } from "@/lib/auth.server"
import { listFolders, listSpaces } from "@/lib/library.server"
import { canManage } from "@/lib/plans"
import { getUploadById } from "@/lib/uploads.server"
import { roleIn } from "@/lib/workspace.server"
import { useT } from "@/lib/i18n/react"

interface Movable {
  title: string | null
  spaceId: string | null
  folderId: string | null
}

/** The spaces and folders a video can move to, for the recorder or a workspace owner or admin. */
const loadMovePlaces = createServerFn({ method: "GET" })
  .validator((id: string) => id)
  .handler(async ({ data: id }) => {
    const user = await getSessionUser(getRequest())
    const upload = await getUploadById(id)
    if (!user || !upload?.workspaceId) return null
    if (upload.ownerId !== user.sub && !canManage(await roleIn(upload.workspaceId, user.sub))) return null
    const [spaces, folders] = await Promise.all([listSpaces(upload.workspaceId), listFolders(upload.workspaceId, user.sub)])
    return { spaces, folders, video: { title: upload.title, spaceId: upload.spaceId, folderId: upload.folderId } }
  })

/** Picks a place in the library (My videos or a space) and, where it has folders, a folder. */
export function MoveDialog({
  video,
  spaces,
  folders,
  onClose,
  onMove,
}: {
  video: Movable
  spaces: Array<Space>
  folders: Array<Folder>
  onClose: () => void
  onMove: (changes: { spaceId: string | null; folderId: string | null }) => void
}) {
  const t = useT()
  const [spaceId, setSpaceId] = useState<string | null>(video.spaceId)
  const [folderId, setFolderId] = useState<string | null>(video.folderId)
  const choices = folders.filter((folder) => (spaceId ? folder.spaceId === spaceId : !folder.spaceId))
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-neutral-950/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="move-title" className="pop-in w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl" onClick={(event) => event.stopPropagation()}>
        <h2 id="move-title" className="text-lg font-semibold text-neutral-900">
          {t("library.move.title", { title: video.title || t("library.video.untitled") })}
        </h2>
        <p className="mt-3 text-xs font-semibold tracking-wide text-neutral-500 uppercase">{t("library.move.library")}</p>
        <div className="mt-1.5 space-y-1">
          {[{ id: null, name: t("library.nav.myVideos") }, ...spaces.map((space) => ({ id: space.id, name: space.name }))].map((place) => (
            <label key={place.id ?? "mine"} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-neutral-50">
              <input
                type="radio"
                name="move-space"
                checked={spaceId === place.id}
                onChange={() => {
                  setSpaceId(place.id)
                  setFolderId(null)
                }}
              />
              {place.id ? <UsersThreeIcon size={16} className="text-neutral-500" /> : <UserIcon size={16} className="text-neutral-500" />}
              {place.name}
            </label>
          ))}
        </div>
        {choices.length > 0 && (
          <>
            <p className="mt-4 text-xs font-semibold tracking-wide text-neutral-500 uppercase">{t("library.move.folder")}</p>
            <select
              aria-label={t("library.move.folder")}
              value={folderId ?? ""}
              onChange={(event) => setFolderId(event.target.value || null)}
              className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
            >
              <option value="">{t("library.move.noFolder")}</option>
              {choices.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                </option>
              ))}
            </select>
          </>
        )}
        {spaceId && <p className="mt-3 text-xs text-neutral-500">{t("library.move.spaceNote")}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-100">
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={() => onMove({ spaceId, folderId })}
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-800"
          >
            {t("library.move.confirm")}
          </button>
        </div>
      </div>
    </div>
  )
}

/** "Move…" on the video page: the same dialog the library's card menu opens. */
export function MoveButton({ uploadId, onNotify }: { uploadId: string; onNotify: (message: string, variant?: "error") => void }) {
  const t = useT()
  const [places, setPlaces] = useState<Awaited<ReturnType<typeof loadMovePlaces>>>(null)
  const open = async () => {
    const loaded = await loadMovePlaces({ data: uploadId }).catch(() => null)
    if (loaded) setPlaces(loaded)
    else onNotify(t("library.move.loadFailed"), "error")
  }
  const move = async (changes: { spaceId: string | null; folderId: string | null }) => {
    if (!places) return
    setPlaces(null)
    const response = await fetch(`/api/recordings/${uploadId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(changes) }).catch(() => null)
    if (!response?.ok) return onNotify(t("library.move.failed"), "error")
    const space = places.spaces.find((item) => item.id === changes.spaceId)
    const folder = places.folders.find((item) => item.id === changes.folderId)
    onNotify(t("library.move.moved", { place: [space?.name ?? t("library.nav.myVideos"), folder?.name].filter(Boolean).join(" › ") }))
  }
  return (
    <>
      <Button variant="secondary" icon={<FolderSimpleIcon weight="bold" />} onClick={() => void open()}>
        {t("library.move.confirm")}
      </Button>
      {places && <MoveDialog video={places.video} spaces={places.spaces} folders={places.folders} onClose={() => setPlaces(null)} onMove={(changes) => void move(changes)} />}
    </>
  )
}
