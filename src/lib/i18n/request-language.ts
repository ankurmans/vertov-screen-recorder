import { createIsomorphicFn } from "@tanstack/react-start"
import { getRequest } from "@tanstack/react-start/server"
import type { Catalog } from "./core.ts"
import type { AppLanguage } from "./languages.ts"

type RenderLanguage = { language: AppLanguage; catalog: Catalog | null }

// Keyed by the request object, so one visitor's language is never visible to another request in the same Worker.
const byRequest = new WeakMap<Request, RenderLanguage>()

/**
 * During server rendering the router hands `head()` a list of matches without their loader data, so page titles can't read the
 * language from the root match. The root loader records it here and `translatorFromMatches` reads it back. The browser needs neither.
 */
export const rememberRenderLanguage = createIsomorphicFn()
  .server((value: RenderLanguage) => void byRequest.set(getRequest(), value))
  .client((_value: RenderLanguage) => undefined)

export const renderLanguage = createIsomorphicFn()
  .server((): RenderLanguage | undefined => byRequest.get(getRequest()))
  .client((): RenderLanguage | undefined => undefined)
