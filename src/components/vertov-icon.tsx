import type { ReactNode } from "react"

const drawings = {
  download: <><path d="M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m4 7 8 6 8-6" /></>,
  image: <><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8" cy="8" r="1.5" /><path d="m3 17 6-6 4 4 3-3 5 5" /></>,
  film: <><rect x="3" y="3" width="18" height="18" rx="3" /><path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4" /><path d="m10 9 5 3-5 3z" strokeLinejoin="round" /></>,
  comment: <path d="M8 18H6l-3 3v-5a7 7 0 0 1-1-4c0-5 4-9 10-9s10 4 10 9-4 8-10 8h-1M7 10h10M7 14h6" />,
  lock: <><rect x="5" y="10" width="14" height="11" rx="3" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  customize: <><circle cx="12" cy="12" r="9" /><path d="m8 4 4 5 6-1m3 4-6 1-2 6M9 20l1-6-6-3" /><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" /></>,
  trash: <><path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7" /></>,
  restart: <><path d="M4 10a8 8 0 1 1 1 8M4 4v6h6" /></>,
  play: <path d="m8 4 12 8-12 8z" />,
  pause: <><path d="M8 5v14M16 5v14" strokeWidth="3" /></>,
  screen: <><rect x="2" y="3" width="20" height="14" rx="3" /><path d="M8 21h8M12 17v4" /></>,
  camera: <><rect x="3" y="6" width="13" height="13" rx="3" /><path d="m16 10 5-3v11l-5-3" /></>,
  notes: <><rect x="5" y="3" width="15" height="18" rx="3" /><path d="M3 7h4M3 12h4M3 17h4M10 8h6M10 12h6M10 16h4" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  circle: <circle cx="12" cy="12" r="8" />,
  rounded: <rect x="4" y="4" width="16" height="16" rx="5" />,
  external: <><path d="M14 3h7v7M21 3 11 13M10 5H6a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-4" /></>,
  subtitles: <><rect x="2" y="5" width="20" height="14" rx="3" /><path d="M10 9a3 3 0 1 0 0 6M19 9a3 3 0 1 0 0 6" /></>,
  approve: <><path d="M8 10 12 3c2 0 3 2 2 5h5a2 2 0 0 1 2 2l-2 9a2 2 0 0 1-2 2H8M3 10h5v11H3z" /></>,
  love: <path d="M12 21 4 13C-2 7 6-1 12 6c6-7 14 1 8 7z" />,
  laugh: <><circle cx="12" cy="12" r="9" /><path d="m6 9 2-1 2 1m4 0 2-1 2 1M7 13h10c0 7-10 7-10 0z" /></>,
  celebrate: <><path d="m3 21 4-13 9 9zM8 6l2-4m5 7 5-5M18 13l4-1M12 4l2 2M20 8l1 1" /><circle cx="16" cy="2" r="1" fill="currentColor" stroke="none" /></>,
  surprise: <><circle cx="12" cy="12" r="9" /><path d="M8 8v1m8-1v1" strokeWidth="2.5" /><ellipse cx="12" cy="15" rx="2.5" ry="3" /></>,
  fire: <path d="M13 2c1 6-5 7-3 11 2-1 3-3 3-5 5 3 7 6 6 9a7 7 0 0 1-14-1c0-4 3-7 3-7-1 5 1 5 1 5C6 8 12 7 13 2z" />,
  eyes: <><ellipse cx="7" cy="12" rx="5" ry="8" /><ellipse cx="17" cy="12" rx="5" ry="8" /><circle cx="8" cy="13" r="2" fill="currentColor" stroke="none" /><circle cx="18" cy="13" r="2" fill="currentColor" stroke="none" /></>,
  thanks: <><path d="m8 21-4-4-2-6c2-1 3 2 4 3V7a1 1 0 0 1 2 0v4-6a1 1 0 0 1 2 0v8m6 8 4-4 2-6c-2-1-3 2-4 3V7a1 1 0 0 0-2 0v4-6a1 1 0 0 0-2 0v8M12 1v2M6 2l1 1M18 2l-1 1" /></>,
} satisfies Record<string, ReactNode>

export type VertovIconName = keyof typeof drawings

/** One rounded, monochrome vocabulary for Vertov's controls and reactions. */
export function VertovIcon({ name, size = 16, className }: { name: VertovIconName; size?: number; className?: string }) {
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className={`inline-block shrink-0 align-middle ${className ?? ""}`}>{drawings[name]}</svg>
}
