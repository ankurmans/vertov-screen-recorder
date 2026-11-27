import { APP_NAME } from "@/lib/brand"

export function BrandMark({ size = 24 }: { size?: number }) {
  return <img src="/favicon.svg?v=kino-eye" alt="" width={size} height={size} className="shrink-0" />
}

/** The product name beside the mark in page headers; dropped on phones where the header is tight. */
export function Wordmark() {
  return <span className="hidden font-semibold tracking-tight text-neutral-900 sm:inline">{APP_NAME}</span>
}
