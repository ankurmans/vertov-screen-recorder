import type { common as english } from "../en/common.ts"
import type { Translations } from "../types.ts"

export const common: Translations<typeof english> = {
  "common.cancel": "Annuler",
  "common.save": "Enregistrer",
  "common.saving": "Enregistrement…",
  "common.saved": "Enregistré",
  "common.close": "Fermer",
  "common.delete": "Supprimer",
  "common.copy": "Copier",
  "common.copied": "Copié",
  "common.loading": "Chargement…",
  "common.tryAgain": "Réessayer",
  "common.somethingWrong": "Une erreur s’est produite. Réessayez.",
  "language.label": "Langue",
  "language.description": "La langue des menus, des boutons et des messages de Vertov. Vos vidéos, titres et transcriptions ne changent pas.",
  "language.saved": "Langue enregistrée.",
  "language.saveFailed": "Impossible d’enregistrer votre langue. Réessayez.",
  "language.selectorLabel": "Langue",
  "common.views": { one: "{count} vue", other: "{count} vues" },
  "common.viewsCompact": "{count} vues",
  "common.poweredBy": "Propulsé par {app}",
  "common.justNow": "à l’instant",
}
