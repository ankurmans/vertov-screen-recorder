// Emits the app catalog as source/translation pairs for the shared translation-second-opinion tool:
//   npx tsx scripts/export-app-message-pairs.mjs > /tmp/app-pairs.json
//   node ~/.claude/skills/translation-second-opinion/second-opinion.mjs --in /tmp/app-pairs.json --provider google --run
// Rich tags are removed, {placeholders} stay (the tool turns them into upper-case words). Plural messages send `other`, and `one` when both have it.
import { en } from "../src/lib/i18n/en/index.ts"
import { loadCatalog } from "../src/lib/i18n/catalogs.ts"
import { APP_LANGUAGES } from "../src/lib/i18n/languages.ts"

const strip = (text) => text.replace(/<\/?[a-z][a-z0-9]*>/g, "")
const items = []
for (const language of APP_LANGUAGES) {
  if (language === "en") continue
  const catalog = await loadCatalog(language)
  for (const [key, source] of Object.entries(en)) {
    const target = catalog[key]
    if (target === undefined) continue
    const forms = typeof source === "string" ? { _: source } : source
    for (const [form, text] of Object.entries(forms)) {
      const translated = typeof target === "string" ? target : target[form]
      if (typeof translated !== "string" || typeof text !== "string") continue
      items.push({ id: `${language}/${key}${form === "_" ? "" : `.${form}`}`, lang: language, reference: strip(text), translated: strip(translated) })
    }
  }
}
console.log(JSON.stringify({ referenceLang: "en", items }))
