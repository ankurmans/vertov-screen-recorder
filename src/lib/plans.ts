/**
 * Plans are per workspace and priced by hours of video kept in the library, never by seat.
 * Shared by server and browser so the pricing page, usage bar and limits can't disagree.
 */

export type PlanId = "free" | "pro" | "team" | "business"
export type Interval = "month" | "year"
export type Role = "owner" | "admin" | "member"

export interface Plan {
  id: PlanId
  name: string
  /** USD per month on monthly billing; annual is ten months' worth. */
  monthly: number
  hours: number
  /** AI title, summary and chapters. Transcripts and captions are on every plan. */
  ai: boolean
  blurb: string
}

export const PLANS: Record<PlanId, Plan> = {
  free: { id: "free", name: "Free", monthly: 0, hours: 5, ai: false, blurb: "Every recording and editing feature, no plan limit on video length." },
  pro: { id: "pro", name: "Pro", monthly: 9, hours: 50, ai: true, blurb: "AI titles, summaries and chapters, and room for a real library." },
  team: { id: "team", name: "Team", monthly: 29, hours: 200, ai: true, blurb: "A shared library for the whole team. Members never cost extra." },
  business: { id: "business", name: "Business", monthly: 99, hours: 1000, ai: true, blurb: "A thousand hours for larger teams." },
}

export const PAID_PLANS: Array<PlanId> = ["pro", "team", "business"]

export const EXTRA_BLOCK_HOURS = 50
export const EXTRA_BLOCK_PRICE = 5
/** Annual billing is ten months for twelve. */
export const yearlyPrice = (plan: Plan) => plan.monthly * 10

/**
 * What a video costs in library hours: its length, or its size at 2 GB an hour when that is more,
 * so a 4K upload counts for what it actually stores.
 */
export const BYTES_PER_HOUR = 2_000_000_000

export const planHours = (plan: PlanId, extraBlocks: number) => PLANS[plan].hours + extraBlocks * EXTRA_BLOCK_HOURS

export const isPlanId = (value: unknown): value is PlanId => typeof value === "string" && value in PLANS

export const canManage = (role: Role | null | undefined) => role === "owner" || role === "admin"

export function formatHours(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)} min`
  return `${hours < 10 ? Math.round(hours * 10) / 10 : Math.round(hours)} h`
}
