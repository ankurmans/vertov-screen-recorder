import { REFERRAL_CAP_HOURS, REFERRAL_HOURS } from "@/lib/plans"

/** The cookie a `?ref=` link sets, read when the friend's workspace is first created. */
export const REF_COOKIE = "rl_ref"
export const REF_COOKIE_DAYS = 30

/** Codes avoid look-alike characters (0/O, 1/I/L) so they survive being read out. */
export const REF_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"
export const REF_LENGTH = 8

const SHAPE = new RegExp(`^[${REF_ALPHABET}]{${REF_LENGTH}}$`)

/** A well-formed referral code (upper-cased), or null. Free text from a query string or cookie never reaches the database. */
export function parseRefCode(value: unknown): string | null {
  if (typeof value !== "string") return null
  const code = value.trim().toUpperCase()
  return SHAPE.test(code) ? code : null
}

export function newRefCode(random: (n: number) => number = (n) => crypto.getRandomValues(new Uint32Array(1))[0] % n): string {
  let code = ""
  for (let i = 0; i < REF_LENGTH; i++) code += REF_ALPHABET[random(REF_ALPHABET.length)]
  return code
}

export function refCookie(code: string, secure: boolean): string {
  return `${REF_COOKIE}=${code}; Path=/; Max-Age=${REF_COOKIE_DAYS * 86_400}; SameSite=Lax${secure ? "; Secure" : ""}`
}

export function readRefCookie(cookieHeader: string | null): string | null {
  for (const part of (cookieHeader ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=")
    if (key === REF_COOKIE) return parseRefCode(rest.join("="))
  }
  return null
}

/** Hours one side of a referral gains given what its workspace already holds: REFERRAL_HOURS, never past the cap. */
export const referralGrant = (current: number) => Math.max(0, Math.min(REFERRAL_HOURS, REFERRAL_CAP_HOURS - Math.max(0, current)))

export const referralLink = (origin: string, code: string) => `${origin}/?ref=${code}`

export interface ReferralSummary {
  /** False for guests, for self-hosted installs and for workspaces the person can't share. */
  eligible: boolean
  reason?: "guest" | "not_hosted"
  code?: string
  url?: string
  rewarded: number
  pending: number
  /** Hours this workspace has earned as the referrer. */
  earnedHours: number
  bonusHours: number
  capHours: number
  rewardHours: number
}
