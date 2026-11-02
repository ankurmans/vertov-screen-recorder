import { Action, ActionPanel, Icon, List, getPreferenceValues, showToast, Toast } from "@raycast/api"
import { useEffect, useState } from "react"

type Video = { id: string; url?: string; title?: string; duration?: number; status?: string; createdAt?: string | number }

const prefs = () => getPreferenceValues<{ apiKey: string; baseUrl?: string }>()
const base = () => (prefs().baseUrl || "https://vertov.app").replace(/\/+$/, "")
const urlOf = (v: Video) => (v.url?.startsWith("http") ? v.url : `${base()}${v.url ?? `/${v.id}`}`)
const clock = (s?: number) => {
  const t = Math.round(s ?? 0)
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`
}

export default function Command() {
  const [videos, setVideos] = useState<Video[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`${base()}/api/v1/videos`, { headers: { Authorization: `Bearer ${prefs().apiKey}` } })
      .then(async (res) => {
        if (!res.ok) throw new Error(res.status === 401 ? "API key rejected" : `Request failed (${res.status})`)
        setVideos(((await res.json()) as { videos?: Video[] }).videos ?? [])
      })
      .catch((error: Error) => showToast({ style: Toast.Style.Failure, title: "Could not load recordings", message: error.message }))
      .finally(() => setLoading(false))
  }, [])

  return (
    <List isLoading={loading} searchBarPlaceholder="Search recordings">
      <List.EmptyView title="No recordings" description="Record one with the Start Recording command." />
      {videos.map((v) => (
        <List.Item
          key={v.id}
          icon={Icon.Video}
          title={v.title || "Untitled"}
          accessories={[{ text: clock(v.duration) }, ...(v.status && v.status !== "ready" ? [{ tag: v.status }] : [])]}
          actions={
            <ActionPanel>
              <Action.CopyToClipboard title="Copy Link" content={urlOf(v)} />
              <Action.OpenInBrowser title="Open in Browser" url={urlOf(v)} />
            </ActionPanel>
          }
        />
      ))}
    </List>
  )
}
