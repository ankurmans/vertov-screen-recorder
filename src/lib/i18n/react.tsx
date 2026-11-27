import { createContext, useContext, useMemo, type ReactNode } from "react"
import { renderLanguage } from "./request-language.ts"
import { createTranslator, type Catalog, type Translator } from "./core.ts"
import { en, type MessageKey } from "./en/index.ts"
import { DEFAULT_LANGUAGE, LANGUAGE_TAGS, type AppLanguage } from "./languages.ts"
import { localizedBank, localizedHours } from "./format.ts"

export type AppTranslator = Translator<MessageKey>

type I18nValue = { language: AppLanguage; t: AppTranslator }

const report = (key: string) => {
  if (import.meta.env?.DEV) console.warn(`[i18n] missing translation: ${key}`)
}

export const makeTranslator = (language: AppLanguage, catalog: Catalog | null): AppTranslator => createTranslator<MessageKey>(language, en, catalog, report)

const english = makeTranslator(DEFAULT_LANGUAGE, null)
const I18nContext = createContext<I18nValue>({ language: DEFAULT_LANGUAGE, t: english })

// Set on the client only. A module variable is shared between requests in a Worker, so the server never reads it.
let clientTranslator: AppTranslator = english

export function I18nProvider({ language, catalog, children }: { language: AppLanguage; catalog: Catalog | null; children: ReactNode }) {
  const value = useMemo<I18nValue>(() => ({ language, t: makeTranslator(language, catalog) }), [language, catalog])
  if (typeof document !== "undefined") clientTranslator = value.t
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

/** `const t = useT()`, then `t("library.empty")`. */
export const useT = (): AppTranslator => useContext(I18nContext).t
export const useLanguage = (): AppLanguage => useContext(I18nContext).language
export const useLanguageTag = (): string => LANGUAGE_TAGS[useLanguage()]

/** For code outside React (dialogs, toasts, event handlers). Browser only. */
export const tNow = (): AppTranslator => clientTranslator

/**
 * For `head()` and other route code that runs outside React: `head: ({ matches }) => { const t = translatorFromMatches(matches) ... }`.
 * Reads the language the root loader resolved, so page titles follow the app language.
 */
export function translatorFromMatches(matches: ReadonlyArray<{ routeId: string; loaderData?: unknown }>): AppTranslator {
  const root = matches.find((match) => match.routeId === "__root__")?.loaderData as { i18n?: { language: AppLanguage; catalog: Catalog | null } } | undefined
  // On the server the match list carries no loader data yet; the root loader recorded the language for this request.
  const i18n = root?.i18n ?? renderLanguage()
  return i18n ? makeTranslator(i18n.language, i18n.catalog) : english
}

/** Library sizes and stored-hours text in the app language: `const { bank, hours } = useAmounts()`. */
export function useAmounts() {
  const language = useLanguage()
  return { bank: (value: number) => localizedBank(value, language), hours: (value: number) => localizedHours(value, language) }
}
