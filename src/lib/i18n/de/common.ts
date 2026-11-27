import type { common as english } from "../en/common.ts"
import type { Translations } from "../types.ts"

export const common: Translations<typeof english> = {
  "common.cancel": "Abbrechen",
  "common.save": "Speichern",
  "common.saving": "Wird gespeichert…",
  "common.saved": "Gespeichert",
  "common.close": "Schließen",
  "common.delete": "Löschen",
  "common.copy": "Kopieren",
  "common.copied": "Kopiert",
  "common.loading": "Wird geladen…",
  "common.tryAgain": "Erneut versuchen",
  "common.somethingWrong": "Etwas ist schiefgelaufen. Versuchen Sie es erneut.",
  "language.label": "Sprache",
  "language.description": "Die Sprache der Menüs, Schaltflächen und Meldungen in Vertov. Ihre Videos, Titel und Transkripte bleiben unverändert.",
  "language.saved": "Sprache gespeichert.",
  "language.saveFailed": "Ihre Sprache konnte nicht gespeichert werden. Versuchen Sie es erneut.",
  "language.selectorLabel": "Sprache",
  "common.views": { one: "{count} Aufruf", other: "{count} Aufrufe" },
  "common.viewsCompact": "{count} Aufrufe",
  "common.poweredBy": "Bereitgestellt mit {app}",
  "common.justNow": "gerade eben",
}
