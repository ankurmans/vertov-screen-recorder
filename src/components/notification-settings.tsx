import { useEffect, useState } from "react"

export function NotificationSettings() {
  const [prefs, setPrefs] = useState<{ comments: boolean; firstView: boolean } | null>(null)
  const [status, setStatus] = useState("")
  const [busy, setBusy] = useState(false)
  useEffect(() => { void fetch("/api/notifications").then((r) => { if (!r.ok) throw new Error(); return r.json() as Promise<{ comments: boolean; firstView: boolean }> }).then(setPrefs).catch(() => setStatus("Couldn't load notification settings")) }, [])
  async function save(next: NonNullable<typeof prefs>) {
    setBusy(true)
    try {
      const response = await fetch("/api/notifications", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(next) })
      if (!response.ok) throw new Error()
      setPrefs(next); setStatus("Saved")
    } catch { setStatus("Couldn't save preferences") }
    finally { setBusy(false) }
  }
  return <section className="my-5 rounded-xl border border-neutral-200 bg-white p-4 text-sm"><h2 className="font-semibold">Email notifications</h2><p className="my-2 text-neutral-500">Activity is grouped into one email per video every 15 minutes.</p>{prefs && <div className="flex flex-col gap-2">{([ ["comments", "New comments"], ["firstView", "First viewer of each video"] ] as const).map(([key, label]) => <label key={key}><input type="checkbox" disabled={busy} checked={prefs[key]} onChange={(e) => void save({ ...prefs, [key]: e.target.checked })} /> {label}</label>)}</div>}<p role="status">{status}</p></section>
}
