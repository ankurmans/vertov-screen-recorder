import { useEffect, useState } from "react"
import { DesktopIcon, MoonIcon, SunIcon } from "@phosphor-icons/react"
import { type ThemePref, readPref, savePref } from "@/lib/theme"
import { useT } from "@/lib/i18n/react"
import type { MessageKey } from "@/lib/i18n/en/index"

const OPTIONS: Array<{ value: ThemePref; label: MessageKey; icon: React.ReactNode }> = [
  { value: "system", label: "settings.appearance.system", icon: <DesktopIcon size={16} /> },
  { value: "light", label: "settings.appearance.light", icon: <SunIcon size={16} /> },
  { value: "dark", label: "settings.appearance.dark", icon: <MoonIcon size={16} /> },
]

/** Theme choice, kept in this browser. "System" follows the device and updates when it changes. */
export function AppearanceSettings() {
  const t = useT()
  // Starts on System so the server and first client render agree; the stored choice applies right after.
  const [pref, setPref] = useState<ThemePref>("system")
  useEffect(() => setPref(readPref()), [])
  return (
    <div role="radiogroup" aria-label={t("settings.appearance.theme")} className="inline-flex rounded-lg border border-neutral-200 bg-neutral-200/60 p-0.5">
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={pref === option.value}
          onClick={() => {
            setPref(option.value)
            savePref(option.value)
          }}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium ${pref === option.value ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-600 hover:text-neutral-900"}`}
        >
          {option.icon}
          {t(option.label)}
        </button>
      ))}
    </div>
  )
}
