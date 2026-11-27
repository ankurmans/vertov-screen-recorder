export type ThemePref = "system" | "light" | "dark"

export const THEME_KEY = "vertov:theme"
export const THEME_PREFS: ThemePref[] = ["system", "light", "dark"]

/** Pages that follow the theme choice: the signed-in app. Marketing, share and sign-in pages keep their own look. */
export const APP_PATH = /^\/(home|settings|playlists|analytics|tutorials|record|import|app)(\/|$)/

export const isAppPath = (pathname: string) => APP_PATH.test(pathname)

export function readPref(): ThemePref {
  try {
    const stored = localStorage.getItem(THEME_KEY)
    return stored === "light" || stored === "dark" ? stored : "system"
  } catch {
    return "system"
  }
}

export function applyTheme(pref: ThemePref, pathname: string = location.pathname) {
  const dark = pref === "dark" || (pref === "system" && matchMedia("(prefers-color-scheme: dark)").matches)
  const root = document.documentElement
  const app = isAppPath(pathname)
  root.dataset.surface = app ? "app" : "public"
  root.dataset.theme = app && dark ? "dark" : "light"
  // Kumo's own components key off data-mode.
  if (app && dark) root.dataset.mode = "dark"
  else delete root.dataset.mode
}

export function savePref(pref: ThemePref) {
  try {
    if (pref === "system") localStorage.removeItem(THEME_KEY)
    else localStorage.setItem(THEME_KEY, pref)
  } catch {
    // Private mode: the choice holds for this page only.
  }
  applyTheme(pref)
}

/** Runs in <head> before paint so a dark choice never flashes light. Mirrors applyTheme. */
export const themeScript = `(function(){try{var r=document.documentElement,p=${APP_PATH.toString()}.test(location.pathname),s=null;try{s=localStorage.getItem(${JSON.stringify(THEME_KEY)})}catch(e){}var d=s==="dark"||(s!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);r.dataset.surface=p?"app":"public";r.dataset.theme=p&&d?"dark":"light";if(p&&d)r.dataset.mode="dark"}catch(e){}})()`
