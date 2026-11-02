import { VertovIcon } from "@/components/vertov-icon"
import type { VertovIconName } from "@/components/vertov-icon"

// Keep the stored reaction codes so existing reactions and API clients retain their meaning.
const reactions: Record<string, { icon: VertovIconName; label: string }> = {
  "👍": { icon: "approve", label: "Like" },
  "❤": { icon: "love", label: "Love" },
  "😂": { icon: "laugh", label: "Laugh" },
  "🎉": { icon: "celebrate", label: "Celebrate" },
  "😮": { icon: "surprise", label: "Surprise" },
  "🔥": { icon: "fire", label: "Fire" },
  "👀": { icon: "eyes", label: "Eyes" },
  "🙌": { icon: "thanks", label: "Thanks" },
}

const reaction = (code: string) => reactions[code.replace(/\uFE0F/g, "")] ?? { icon: "customize" as const, label: "Reaction" }
export const reactionLabel = (code: string) => reaction(code).label

export function ReactionIcon({ code, size = 20 }: { code: string; size?: number }) {
  return <VertovIcon name={reaction(code).icon} size={size} />
}
