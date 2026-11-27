// Checks the app UI catalog: every language has every key, and each translation keeps the structure of its English source.
//   npx tsx scripts/check-app-messages.mjs           report; exit 1 on any error
//   npx tsx scripts/check-app-messages.mjs --json    machine-readable result
//
// Read-only: no network, no AI service. Errors (exit 1):
//   keys        a language misses a key or has an extra one
//   shape       English is plural forms and the translation is not (or lacks `other`, or `one` where the language has it)
//   params      the {placeholder} names differ from English
//   tags        the <tag> names differ from English, or tags are unbalanced
//   numbers     a literal number differs from English (separators ignored; plural `one` forms are skipped)
//   brands      a brand or product name in English is missing from the translation
//   dash        an em dash in a translation
//   portuguese  pt-pt uses a Brazilian word or pt-br uses a European word
//   register    German uses du, French uses tu, Spanish uses usted, Portuguese uses tu (the site's registers)
// Warnings: a translation identical to its English text longer than two words.
import { en } from "../src/lib/i18n/en/index.ts"
import { loadCatalog } from "../src/lib/i18n/catalogs.ts"
import { APP_LANGUAGES, LANGUAGE_TAGS } from "../src/lib/i18n/languages.ts"

const BRANDS = ["Vertov", "Loom", "Slack", "Chrome", "Google", "Gmail", "GitHub", "Claude", "ChatGPT", "MCP", "API", "WebM", "MP4", "GIF", "SCIM", "SSO", "OAuth", "Zapier", "Whisper", "Cloudflare", "Polar", "Kino-Eye"]
const PT_PT_ONLY = /\b(utilizador(?:es)?|ecrã|ecrãs|ligaç(?:ão|ões)|partilh\w+|descarreg\w+|ficheiros?|equipa|equipas)\b/i
const PT_BR_ONLY = /\b(usuári[oa]s?|tela|telas|compartilh\w+|baix(?:ar|e|ando|ado|ada|ados|adas)|equipes?|arquivos?|salv(?:ar|e|ando|o|a|os|as)|links?)\b/i
const PT_BR_GERUND = /^A (?:\p{L}+)(?:ar|er|ir)(?:…|\.\.\.)/u
const DU = /\b(du|dein|deine|deinen|deinem|deiner|deines|dich|dir)\b/i
const TU_FR = /\b(tu|ton|tes|toi)\b/i
const USTED = /\b(usted|ustedes)\b/i
const TU_PT = /\b(tu|teu|tua|teus|tuas|contigo)\b/i

const forms = (message) => (typeof message === "string" ? { _: message } : message)
const params = (text) => [...new Set([...text.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map((m) => m[1]))].sort()
const tags = (text) => [...text.matchAll(/<(\/?)([a-z][a-z0-9]*)>/g)]
const tagNames = (text) => [...new Set(tags(text).map((m) => m[2]))].sort()
const balanced = (text) => {
  const stack = []
  for (const [, closing, name] of tags(text)) {
    if (!closing) stack.push(name)
    else if (stack.pop() !== name) return false
  }
  return stack.length === 0
}
const numbers = (text) => [...text.replace(/\{[^}]*\}/g, " ").replace(/<\/?[a-z][a-z0-9]*>/g, " ").replace(/(\d)[.,   ](?=\d{3}\b)/g, "$1").matchAll(/\d+/g)].map((m) => m[0]).sort()
const union = (message, pick) => [...new Set(Object.values(forms(message)).flatMap(pick))].sort()
const joined = (message) => Object.values(forms(message)).join(" ")
const otherText = (message) => (typeof message === "string" ? message : message.other)

const errors = []
const warnings = []
const error = (language, kind, key, detail) => errors.push({ language, kind, key, detail })
const warn = (language, kind, key, detail) => warnings.push({ language, kind, key, detail })

const english = en
const keys = Object.keys(english)

for (const key of keys) {
  const message = english[key]
  if (typeof message !== "string" && typeof message.other !== "string") error("en", "shape", key, "plural message without `other`")
  if (!balanced(joined(message))) error("en", "tags", key, "unbalanced tags")
}

for (const language of APP_LANGUAGES) {
  if (language === "en") continue
  const catalog = await loadCatalog(language)
  const have = new Set(Object.keys(catalog))
  for (const key of keys) if (!have.has(key)) error(language, "keys", key, "missing")
  for (const key of have) if (!(key in english)) error(language, "keys", key, "extra key not in English")
  const categories = new Intl.PluralRules(LANGUAGE_TAGS[language]).resolvedOptions().pluralCategories
  for (const key of keys) {
    const source = english[key]
    const target = catalog[key]
    if (target === undefined) continue
    const sourceText = joined(source)
    const targetText = joined(target)
    if (typeof source !== "string") {
      if (typeof target === "string" || typeof target.other !== "string") error(language, "shape", key, "English has plural forms; the translation needs an object with `other`")
      else if (categories.includes("one") && typeof target.one !== "string" && typeof source.one === "string") error(language, "shape", key, "plural message needs a `one` form")
    } else if (typeof target !== "string") error(language, "shape", key, "English is a plain string; the translation has plural forms")
    if (typeof target === "string" || typeof target?.other === "string") {
      if (JSON.stringify(union(source, params)) !== JSON.stringify(union(target, params))) error(language, "params", key, `${union(source, params)} vs ${union(target, params)}`)
      if (JSON.stringify(union(source, tagNames)) !== JSON.stringify(union(target, tagNames)) || !balanced(targetText)) error(language, "tags", key, `${union(source, tagNames)} vs ${union(target, tagNames)}`)
      if (JSON.stringify(numbers(otherText(source))) !== JSON.stringify(numbers(otherText(target)))) error(language, "numbers", key, `${numbers(otherText(source))} vs ${numbers(otherText(target))}`)
      // Listed brands, plus any CamelCase product name (GitHub, WebM, ...) in the English text.
      const brands = new Set([...BRANDS, ...(sourceText.match(/\b[A-Z][a-z]+[A-Z][A-Za-z]*\b/g) ?? [])])
      for (const brand of brands) if (new RegExp(`\\b${brand}\\b`).test(sourceText) && !new RegExp(`\\b${brand}\\b`).test(targetText)) error(language, "brands", key, `${brand} missing`)
      if (/—/.test(targetText)) error(language, "dash", key, "em dash")
      const plain = targetText.replace(/<\/?[a-z][a-z0-9]*>/g, " ").replace(/\{[^}]*\}/g, " ")
      if (language === "pt-pt" && PT_BR_ONLY.test(plain)) error(language, "portuguese", key, `Brazilian word "${PT_BR_ONLY.exec(plain)[0]}" in pt-pt`)
      if (language === "pt-br" && (PT_PT_ONLY.test(plain) || PT_BR_GERUND.test(otherText(target)))) error(language, "portuguese", key, `European form "${(PT_PT_ONLY.exec(plain) ?? PT_BR_GERUND.exec(otherText(target)))[0]}" in pt-br`)
      if (language === "de" && DU.test(targetText)) error(language, "register", key, `informal "${DU.exec(targetText)[0]}" (German uses Sie)`)
      if (language === "fr" && TU_FR.test(targetText)) error(language, "register", key, `tutoiement "${TU_FR.exec(targetText)[0]}" (French uses vous)`)
      if (language === "es" && USTED.test(targetText)) error(language, "register", key, `"${USTED.exec(targetText)[0]}" (Spanish uses tú)`)
      if ((language === "pt-br" || language === "pt-pt") && TU_PT.test(targetText)) error(language, "register", key, `"${TU_PT.exec(targetText)[0]}" (Portuguese uses você / third person)`)
      if (otherText(target) === otherText(source) && otherText(source).trim().split(/\s+/).length > 2) warn(language, "untranslated", key, "identical to English")
    }
  }
}

const json = process.argv.includes("--json")
if (json) console.log(JSON.stringify({ keys: keys.length, errors, warnings }, null, 2))
else {
  const show = (rows, label) => {
    const grouped = Object.groupBy(rows, (row) => `${row.language} ${row.kind}`)
    for (const [group, items] of Object.entries(grouped)) {
      console.log(`${label} ${group}: ${items.length}`)
      for (const item of items.slice(0, 12)) console.log(`  ${item.key}: ${item.detail}`)
      if (items.length > 12) console.log(`  ... ${items.length - 12} more`)
    }
  }
  show(errors, "ERROR")
  show(warnings, "warn")
  console.log(`${keys.length} English keys, ${APP_LANGUAGES.length - 1} languages, ${errors.length} errors, ${warnings.length} warnings`)
}
process.exit(errors.length ? 1 : 0)
