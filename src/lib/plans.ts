/** This edition has workspaces and roles, but no plans, limits or billing. */
export type Role = "owner" | "admin" | "member"

export const canManage = (role: Role | null | undefined) => role === "owner" || role === "admin"

/** Referral hours belong to the hosted service's plans; this edition has no hour banks, so a referral grants nothing. */
export const REFERRAL_HOURS = 0
export const REFERRAL_CAP_HOURS = 0
