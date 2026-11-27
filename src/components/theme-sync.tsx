import { useEffect } from "react"
import { useRouterState } from "@tanstack/react-router"
import { applyTheme, readPref } from "@/lib/theme"

/** Re-applies the theme when the route moves between app and public pages, and when the system setting changes. */
export function ThemeSync() {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  useEffect(() => {
    applyTheme(readPref(), pathname)
    const query = matchMedia("(prefers-color-scheme: dark)")
    const onChange = () => applyTheme(readPref(), pathname)
    query.addEventListener("change", onChange)
    return () => query.removeEventListener("change", onChange)
  }, [pathname])
  return null
}
