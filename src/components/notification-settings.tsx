import { useEffect, useState } from "react"

export function NotificationSettings() {
  const [prefs, setPrefs] = useState<{ comments: boolean; firstView: boolean; tips: boolean } | null>(null)
  const [status, setStatus] = useState("")
  const [busy, setBusy] = useState(false)
  useEffect(() => { void fetch("/api/notifications").then((r) => { if (!r.ok) throw new Error(); return r.json() as Promise<{ comments: boolean; firstView: boolean; tips: boolean }> }).then(setPrefs).catch(() => setStatus("Couldn't load notification settings")) }, [])
  async function save(next: NonNullable<typeof prefs>) {
    setBusy(true)
    try {
      const response = await fetch("/api/notifications", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(next) })
      if (!response.ok) throw new Error()
      setPrefs(next); setStatus("Saved")
    } catch { setStatus("Couldn't save preferences") }
    finally { setBusy(false) }
  }
  // Styled like the other Settings cards; it sits under Profile picture on the Workspace tab.
  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
      <h2 className="font-semibold text-neutral-900">Email notifications</h2>
      <p className="mt-0.5 text-sm text-neutral-500">Just for you. Activity is grouped into one email per video every 15 minutes.</p>
      {prefs && (
        <div className="mt-4 flex flex-col gap-2 text-sm text-neutral-800">
          {([["comments", "New comments"], ["firstView", "First viewer of each video"], ["tips", "Tips from Ankur at Vertov"]] as const).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2">
              <input type="checkbox" disabled={busy} checked={prefs[key]} onChange={(e) => void save({ ...prefs, [key]: e.target.checked })} /> {label}
            </label>
          ))}
        </div>
      )}
      <p role="status" className="mt-2 text-xs text-neutral-500">{status}</p>
    </section>
  )
}
