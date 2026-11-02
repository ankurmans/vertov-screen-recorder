export interface LibrarySearch {
  import?: 1
  request?: 1
  view?: "space" | "archive" | "later"
  space?: string
  folder?: string
  q?: string
}

export const validateLibrarySearch = (search: Record<string, unknown>): LibrarySearch => ({
  request: search.request === 1 || search.request === "1" ? 1 : undefined,
  import: search.import === 1 || search.import === "1" ? 1 : undefined,
  view: search.view === "space" || search.view === "archive" || search.view === "later" ? search.view : undefined,
  space: typeof search.space === "string" ? search.space : undefined,
  folder: typeof search.folder === "string" ? search.folder : undefined,
  q: typeof search.q === "string" && search.q.trim() ? search.q : undefined,
})

export function libraryUrl(search: LibrarySearch): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(search)) if (value !== undefined) params.set(key, String(value))
  return `/app${params.size ? `?${params}` : ""}`
}
