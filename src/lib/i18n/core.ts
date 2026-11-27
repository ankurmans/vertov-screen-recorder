import type { AppLanguage } from "./languages.ts"
import { LANGUAGE_TAGS } from "./languages.ts"

/** A string, or the plural forms of one (`other` is required; the rest follow `Intl.PluralRules`). */
export type Message = string | ({ other: string } & Partial<Record<"zero" | "one" | "two" | "few" | "many", string>>)
export type Catalog = Readonly<Record<string, Message>>
export type Params = Readonly<Record<string, string | number>>
export type RichTags<Node> = Readonly<Record<string, (children: Array<string | Node>) => Node>>

const PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9_]*)\}/g

const rules = new Map<string, Intl.PluralRules>()
const numbers = new Map<string, Intl.NumberFormat>()
const warned = new Set<string>()

function pluralRules(language: AppLanguage) {
  let rule = rules.get(language)
  if (!rule) rules.set(language, (rule = new Intl.PluralRules(LANGUAGE_TAGS[language])))
  return rule
}

export function numberFormat(language: AppLanguage) {
  let format = numbers.get(language)
  if (!format) numbers.set(language, (format = new Intl.NumberFormat(LANGUAGE_TAGS[language])))
  return format
}

/** The text of a message for these params: picks the plural form from `count`, then fills `{name}` placeholders. */
export function formatMessage(message: Message, language: AppLanguage, params?: Params): string {
  let text: string
  if (typeof message === "string") text = message
  else {
    const count = params?.count
    const category = typeof count === "number" ? pluralRules(language).select(count) : "other"
    text = message[category] ?? message.other
  }
  if (!params) return text
  return text.replace(PLACEHOLDER, (whole, name: string) => {
    const value = params[name]
    if (value === undefined) return whole
    return typeof value === "number" ? numberFormat(language).format(value) : value
  })
}

/** Splits `Press <b>Space</b> to pause` into text and tag nodes. Tags nest; an unknown or unclosed tag stays as text. */
export function renderRich<Node>(text: string, tags: RichTags<Node>): Array<string | Node> {
  const out: Array<string | Node> = []
  const stack: Array<{ name: string; children: Array<string | Node> }> = []
  const current = () => (stack.length ? stack[stack.length - 1]!.children : out)
  const token = /<(\/?)([a-z][a-z0-9]*)>/g
  let last = 0
  let match: RegExpExecArray | null
  while ((match = token.exec(text))) {
    const [whole, closing, name = ""] = match
    if (!tags[name]) continue
    if (match.index > last) current().push(text.slice(last, match.index))
    last = match.index + whole.length
    if (!closing) stack.push({ name, children: [] })
    else {
      const open = stack[stack.length - 1]
      if (open?.name === name) {
        stack.pop()
        current().push(tags[name]!(open.children))
      } else current().push(whole)
    }
  }
  if (last < text.length) current().push(text.slice(last))
  while (stack.length) {
    const open = stack.pop()!
    current().push(`<${open.name}>`, ...open.children)
  }
  return out
}

export type Translator<Key extends string = string> = {
  language: AppLanguage
  (key: Key, params?: Params): string
  /** Message with `<tag>` markup mapped to nodes: `t.rich("key", { count: 2 }, { b: (c) => <b>{c}</b> })`. */
  rich<Node>(key: Key, params: Params | undefined, tags: RichTags<Node>): Array<string | Node>
  has(key: string): boolean
}

/**
 * A translator over the chosen language with English underneath. A key the language lacks falls back to English, then to the key
 * itself so a gap shows as an obvious string rather than blank UI. Gaps are reported once per key.
 */
export function createTranslator<Key extends string>(language: AppLanguage, english: Catalog, translated: Catalog | null, report?: (key: string) => void): Translator<Key> {
  const lookup = (key: string): Message => {
    const own = translated?.[key]
    if (own !== undefined) return own
    if (language !== "en" && !warned.has(`${language}:${key}`)) {
      warned.add(`${language}:${key}`)
      report?.(key)
    }
    return english[key] ?? key
  }
  const t = ((key: Key, params?: Params) => formatMessage(lookup(key), language, params)) as Translator<Key>
  ;(t as { language: AppLanguage }).language = language
  t.rich = (key, params, tags) => renderRich(formatMessage(lookup(key), language, params), tags)
  t.has = (key) => english[key] !== undefined
  return t
}
