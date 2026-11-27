import type { common as english } from "../en/common.ts"
import type { Translations } from "../types.ts"

export const common: Translations<typeof english> = {
  "common.cancel": "Cancelar",
  "common.save": "Guardar",
  "common.saving": "Guardando…",
  "common.saved": "Guardado",
  "common.close": "Cerrar",
  "common.delete": "Eliminar",
  "common.copy": "Copiar",
  "common.copied": "Copiado",
  "common.loading": "Cargando…",
  "common.tryAgain": "Inténtalo de nuevo",
  "common.somethingWrong": "Algo salió mal. Inténtalo de nuevo.",
  "language.label": "Idioma",
  "language.description": "El idioma de los menús, botones y mensajes de Vertov. Tus vídeos, títulos y transcripciones no cambian.",
  "language.saved": "Idioma guardado.",
  "language.saveFailed": "No se pudo guardar tu idioma. Inténtalo de nuevo.",
  "language.selectorLabel": "Idioma",
  "common.views": { one: "{count} visualización", other: "{count} visualizaciones" },
  "common.viewsCompact": "{count} visualizaciones",
  "common.poweredBy": "Con la tecnología de {app}",
  "common.justNow": "ahora mismo",
}
