import { VertovIcon } from "@/components/vertov-icon"
import type { VertovIconName } from "@/components/vertov-icon"
import type { MessageKey } from "@/lib/i18n/en/index"
import { makeTranslator, type AppTranslator } from "@/lib/i18n/react"

// Keep the stored reaction codes so existing reactions and API clients retain their meaning.
const reactions: Record<string, { icon: VertovIconName; label: MessageKey }> = {
  "👍": { icon: "approve", label: "library.reaction.like" },
  "❤": { icon: "love", label: "library.reaction.love" },
  "😂": { icon: "laugh", label: "library.reaction.laugh" },
  "🎉": { icon: "celebrate", label: "library.reaction.celebrate" },
  "😮": { icon: "surprise", label: "library.reaction.surprise" },
  "🔥": { icon: "fire", label: "library.reaction.fire" },
  "👀": { icon: "eyes", label: "library.reaction.eyes" },
  "🙌": { icon: "thanks", label: "library.reaction.thanks" },
}

const reaction = (code: string) => reactions[code.replace(/\uFE0F/g, "")] ?? { icon: "customize" as const, label: "library.reaction.other" as const }
const english = makeTranslator("en", null)
/** Pass the caller's `t` to show the label in the app language; without it the label is English. */
export const reactionLabel = (code: string, t: AppTranslator = english) => t(reaction(code).label)

export function ReactionIcon({ code, size = 20 }: { code: string; size?: number }) {
  return <VertovIcon name={reaction(code).icon} size={size} />
}
