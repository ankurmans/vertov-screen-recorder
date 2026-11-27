// Unit tests for the app language mechanism. Run: npx tsx scripts/test-app-i18n.mjs
import assert from "node:assert/strict"
import { createTranslator, formatMessage, renderRich } from "../src/lib/i18n/core.ts"
import { APP_LANGUAGES, followsAppLanguage, languageCookie, languageFromTag, matchAcceptLanguage, readLanguageCookie, resolveLanguage } from "../src/lib/i18n/languages.ts"
import { en } from "../src/lib/i18n/en/index.ts"
import { loadCatalog } from "../src/lib/i18n/catalogs.ts"

let groups = 0
const group = (name, fn) => { fn(); groups++; console.log("ok", name) }

group("language tags", () => {
  assert.equal(languageFromTag("pt-PT"), "pt-pt")
  assert.equal(languageFromTag("pt_pt"), "pt-pt")
  assert.equal(languageFromTag("pt-AO"), "pt-pt")
  assert.equal(languageFromTag("pt-BR"), "pt-br")
  assert.equal(languageFromTag("pt"), "pt-br")
  assert.equal(languageFromTag("fr-CA"), "fr")
  assert.equal(languageFromTag("de-CH"), "de")
  assert.equal(languageFromTag("es-419"), "es")
  assert.equal(languageFromTag("ja"), null)
  assert.equal(languageFromTag(""), null)
})

group("Accept-Language", () => {
  assert.equal(matchAcceptLanguage("de-DE,de;q=0.9,en;q=0.8"), "de")
  assert.equal(matchAcceptLanguage("ja,fr;q=0.5"), "fr")
  assert.equal(matchAcceptLanguage("en;q=0.4,es;q=0.9"), "es")
  assert.equal(matchAcceptLanguage("pt-PT,pt;q=0.9"), "pt-pt")
  assert.equal(matchAcceptLanguage("pt;q=0.9,pt-PT;q=0.5"), "pt-br")
  assert.equal(matchAcceptLanguage("*"), null)
  assert.equal(matchAcceptLanguage("ja,ko"), null)
  assert.equal(matchAcceptLanguage("fr;q=0,de;q=0.2"), "de")
  assert.equal(matchAcceptLanguage(null), null)
})

group("resolver order", () => {
  const all = { query: "fr", cookie: "vertov_lang=de", saved: "es", acceptLanguage: "pt-PT" }
  assert.deepEqual(resolveLanguage(all), { language: "fr", source: "query" })
  assert.deepEqual(resolveLanguage({ ...all, query: null }), { language: "de", source: "cookie" })
  assert.deepEqual(resolveLanguage({ ...all, query: null, cookie: null }), { language: "es", source: "saved" })
  assert.deepEqual(resolveLanguage({ ...all, query: null, cookie: null, saved: null }), { language: "pt-pt", source: "browser" })
  assert.deepEqual(resolveLanguage({ acceptLanguage: "ja" }), { language: "en", source: "default" })
  // ?lang takes only an exact supported code, not a loose tag, and junk is ignored.
  assert.equal(resolveLanguage({ query: "klingon", cookie: "vertov_lang=de" }).language, "de")
  assert.equal(resolveLanguage({ query: "pt-PT" }).language, "pt-pt")
  assert.equal(resolveLanguage({ cookie: "vertov_lang=xx; other=1", acceptLanguage: "fr" }).language, "fr")
})

group("cookie", () => {
  assert.equal(readLanguageCookie("a=1; vertov_lang=pt-br; b=2"), "pt-br")
  assert.equal(readLanguageCookie("vertov_lang=PT-PT"), "pt-pt")
  assert.equal(readLanguageCookie("vertov_lang=nope"), null)
  assert.equal(readLanguageCookie(null), null)
  const set = languageCookie("de", true)
  assert.match(set, /^vertov_lang=de; Path=\/; Max-Age=31536000; SameSite=Lax; Secure$/)
  assert.doesNotMatch(languageCookie("de", false), /Secure/)
})

group("paths", () => {
  for (const path of ["/home", "/settings", "/record", "/signin", "/playlists", "/p/abc", "/embed/24ceaacc", "/24ceaacc", "/join/xyz", "/request/abc", "/connect-extension", "/set-password"]) assert.equal(followsAppLanguage(path), true, path)
  for (const path of ["/", "/pricing", "/privacy", "/support", "/newsroom", "/es", "/pt-pt/precos", "/blog", "/learn/how-to", "/tools/mic-test", "/research", "/docs/mcp", "/the-end-of-explaining", "/show-first-work", "/screen-recorder", "/vs/loom"]) assert.equal(followsAppLanguage(path), false, path)
})

group("interpolation and plurals", () => {
  assert.equal(formatMessage("Hello {name}", "en", { name: "Ana" }), "Hello Ana")
  assert.equal(formatMessage("Hello {name} {missing}", "en", { name: "Ana" }), "Hello Ana {missing}")
  assert.equal(formatMessage({ one: "{count} view", other: "{count} views" }, "en", { count: 1 }), "1 view")
  assert.equal(formatMessage({ one: "{count} view", other: "{count} views" }, "en", { count: 2 }), "2 views")
  // French treats 0 as singular; English does not.
  const view = { one: "{count} vue", other: "{count} vues" }
  assert.equal(formatMessage(view, "fr", { count: 0 }), "0 vue")
  assert.equal(formatMessage(view, "fr", { count: 2 }), "2 vues")
  assert.equal(formatMessage({ one: "{count} view", other: "{count} views" }, "en", { count: 0 }), "0 views")
  // Portuguese (Brazil) treats 0 as singular, Portugal does not.
  const video = { one: "{count} vídeo", other: "{count} vídeos" }
  assert.equal(formatMessage(video, "pt-br", { count: 0 }), "0 vídeo")
  assert.equal(formatMessage(video, "pt-pt", { count: 0 }), "0 vídeos")
  // Languages with a "many" category fall back to other when the message omits it.
  assert.equal(formatMessage({ one: "{count} vídeo", other: "{count} vídeos" }, "es", { count: 1_000_000 }), "1.000.000 vídeos")
  assert.equal(formatMessage({ one: "{count} Video", other: "{count} Videos" }, "de", { count: 1 }), "1 Video")
  assert.equal(formatMessage({ one: "{count} Video", other: "{count} Videos" }, "de", { count: 1234 }), "1.234 Videos")
  assert.equal(formatMessage("{count} items", "en", { count: 1234 }), "1,234 items")
})

group("rich text", () => {
  const tags = { b: (c) => ({ b: c }), a: (c) => ({ a: c }) }
  assert.deepEqual(renderRich("Press <b>Space</b> to pause", tags), ["Press ", { b: ["Space"] }, " to pause"])
  assert.deepEqual(renderRich("<a>Open <b>it</b></a>", tags), [{ a: ["Open ", { b: ["it"] }] }])
  assert.deepEqual(renderRich("1 < 2 and <u>x</u>", tags), ["1 < 2 and <u>x</u>"])
  assert.deepEqual(renderRich("broken <b>text", tags), ["broken ", "<b>", "text"])
  assert.deepEqual(renderRich("stray </b> close", tags), ["stray ", "</b>", " close"])
})

group("fallback to English", () => {
  const english = { "a.one": "One", "a.two": "Two {n}" }
  const missing = []
  const t = createTranslator("es", english, { "a.one": "Uno" }, (key) => missing.push(key))
  assert.equal(t("a.one"), "Uno")
  assert.equal(t("a.two", { n: 2 }), "Two 2")
  assert.equal(t("a.unknown"), "a.unknown")
  t("a.two"); t("a.two")
  assert.deepEqual(missing, ["a.two", "a.unknown"], "each gap is reported once")
  const english2 = createTranslator("en", english, null, (key) => missing.push(key))
  assert.equal(english2("a.one"), "One")
  assert.equal(missing.length, 2, "English reports nothing")
  assert.equal(t.language, "es")
  assert.equal(t.has("a.one"), true)
})

group("every language loads and covers the English keys", async () => {})
for (const language of APP_LANGUAGES) {
  const catalog = await loadCatalog(language)
  if (language === "en") { assert.equal(catalog, null); continue }
  assert.ok(catalog, language)
  const missing = Object.keys(en).filter((key) => !(key in catalog))
  const extra = Object.keys(catalog).filter((key) => !(key in en))
  assert.deepEqual({ language, missing, extra }, { language, missing: [], extra: [] })
}
groups++; console.log("ok every language covers the English keys")
console.log(`${groups} groups passed`)
