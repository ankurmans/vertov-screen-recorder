import { useState } from "react"
import { CAPTION_LANGUAGES } from "@/lib/caption-languages"

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
  return <div className="mt-4 text-sm"><label>Translate captions <select aria-label="Translation language" value={language} onChange={(event) => setLanguage(event.target.value)}>{Object.entries(CAPTION_LANGUAGES).map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></label> <button disabled={busy} onClick={() => void generate()}>{busy ? "Translating…" : "Generate captions"}</button><p role="status">{message}</p></div>
}
