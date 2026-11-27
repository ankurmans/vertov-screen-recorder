import type { AppLanguage } from "./languages.ts"
import type { Catalog } from "./core.ts"

/** The translated catalog for a language (null for English, which is bundled). Server-side: the root loader hands it to the page. */
export async function loadCatalog(language: AppLanguage): Promise<Catalog | null> {
  switch (language) {
    case "es": return (await import("./es/index.ts")).es
    case "fr": return (await import("./fr/index.ts")).fr
    case "de": return (await import("./de/index.ts")).de
    case "pt-br": return (await import("./pt-br/index.ts")).ptbr
    case "pt-pt": return (await import("./pt-pt/index.ts")).ptpt
    default: return null
  }
}
