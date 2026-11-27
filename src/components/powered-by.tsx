import { BrandMark } from "@/components/brand-mark"
import { HOSTED_EDITION } from "@/lib/edition"
import { useT } from "@/lib/i18n/react"

/**
 * The self-hosted edition's credit, linking to vertov.app. Hosted pages have their own badge rules, so this renders
 * nothing there. The name is written out rather than read from APP_NAME: a renamed copy still runs on Vertov.
 */
export function PoweredBy({ overlay = false, className = "" }: { overlay?: boolean; className?: string }) {
  const t = useT()
  if (HOSTED_EDITION) return null
  const link = (
    <a
      href="https://vertov.app"
      target="_blank"
      rel="noopener"
      className={
        overlay
          // Below 520px it would cover the embed's title link (up to 70% wide), which already ends in "· Vertov".
          ? "absolute top-2 right-2 z-30 hidden min-[520px]:block rounded-full bg-black/60 px-3 py-1 text-xs font-medium text-white backdrop-blur hover:bg-black/80"
          : "inline-flex items-center gap-1.5 text-xs font-medium text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white"
      }
    >
      {!overlay && <BrandMark size={16} />}
      {t("common.poweredBy", { app: "Vertov" })}
    </a>
  )
  return overlay ? link : <div className={`flex justify-center ${className}`}>{link}</div>
}
