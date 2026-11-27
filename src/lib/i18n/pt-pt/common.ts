import type { common as english } from "../en/common.ts"
import type { Translations } from "../types.ts"

export const common: Translations<typeof english> = {
  "common.cancel": "Cancelar",
  "common.save": "Guardar",
  "common.saving": "A guardar…",
  "common.saved": "Guardado",
  "common.close": "Fechar",
  "common.delete": "Eliminar",
  "common.copy": "Copiar",
  "common.copied": "Copiado",
  "common.loading": "A carregar…",
  "common.tryAgain": "Tentar novamente",
  "common.somethingWrong": "Algo correu mal. Tente novamente.",
  "language.label": "Idioma",
  "language.description": "O idioma dos menus, botões e mensagens do Vertov. Os seus vídeos, títulos e transcrições não mudam.",
  "language.saved": "Idioma guardado.",
  "language.saveFailed": "Não foi possível guardar o seu idioma. Tente novamente.",
  "language.selectorLabel": "Idioma",
  "common.views": { one: "{count} visualização", other: "{count} visualizações" },
  "common.viewsCompact": "{count} visualizações",
  "common.poweredBy": "Com tecnologia {app}",
  "common.justNow": "agora mesmo",
}
