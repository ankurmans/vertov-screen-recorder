/**
 * Only same-site paths, so a sign-in link can't send someone to another site. Rejects what browsers read as another host:
 * "//host", a backslash ("/\host" becomes "//host"), and tabs or newlines, which URL parsing strips ("/\t/host").
 */
export function safeRedirectPath(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/home"
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return "/home"
  try {
    if (new URL(raw, "https://redirect-check.invalid").origin !== "https://redirect-check.invalid") return "/home"
  } catch {
    return "/home"
  }
  return raw
}
