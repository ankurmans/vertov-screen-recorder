import { useState } from "react"
import { CAPTION_LANGUAGES } from "@/lib/caption-languages"
import { VertovIcon } from "@/components/vertov-icon"

export function CaptionTranslations({ uploadId }: { uploadId: string }) {
  const [language, setLanguage] = useState("es")
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  async function generate() {
    setBusy(true)
    setMessage("")
    try {
      const response = await fetch(`/api/captions/${uploadId}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ language }) })
      const body = await response.json() as { error?: string }
      setMessage(response.ok ? "Captions ready. Reload the player to choose this language." : body.error ?? "Translation failed")
    } catch { setMessage("Translation failed. Please retry.") }
    finally { setBusy(false) }
  }
  return <div className="mt-3 text-xs">
    <div className="flex flex-wrap items-center gap-2">
      <label className="inline-flex items-center gap-2 text-neutral-600">Translate into
        <select aria-label="Translation language" value={language} onChange={(event) => setLanguage(event.target.value)} className="rounded-lg border border-neutral-200 bg-white py-1.5 pl-2 text-neutral-900">{Object.entries(CAPTION_LANGUAGES).map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select>
      </label>
      <button type="button" disabled={busy} onClick={() => void generate()} className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 px-2.5 py-1.5 text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"><VertovIcon name="subtitles" size={14} /> {busy ? "Translating…" : "Generate translation"}</button>
    </div>
    {message && <p role="status" className="mt-1.5 text-neutral-500">{message}</p>}
  </div>
}
