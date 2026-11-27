import type { common as english } from "../en/common.ts"
import type { Translations } from "../types.ts"

export const common: Translations<typeof english> = {
  "common.cancel": "Cancelar",
  "common.save": "Salvar",
  "common.saving": "Salvando…",
  "common.saved": "Salvo",
  "common.close": "Fechar",
  "common.delete": "Excluir",
  "common.copy": "Copiar",
  "common.copied": "Copiado",
  "common.loading": "Carregando…",
  "common.tryAgain": "Tentar novamente",
  "common.somethingWrong": "Algo deu errado. Tente novamente.",
  "language.label": "Idioma",
  "language.description": "O idioma dos menus, botões e mensagens do Vertov. Seus vídeos, títulos e transcrições não mudam.",
  "language.saved": "Idioma salvo.",
  "language.saveFailed": "Não foi possível salvar seu idioma. Tente novamente.",
  "language.selectorLabel": "Idioma",
  "common.views": { one: "{count} visualização", other: "{count} visualizações" },
  "common.viewsCompact": "{count} visualizações",
  "common.poweredBy": "Com tecnologia {app}",
  "common.justNow": "agora mesmo",
}
