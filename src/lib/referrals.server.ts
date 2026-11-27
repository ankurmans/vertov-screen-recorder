// Referral hours belong to the hosted service's plans; this edition has no hour banks, so every call does nothing.
import type { ReferralSummary } from "@/lib/referral-code"

export async function referralSummary(_workspaceId: string, _userId: string, _origin: string): Promise<ReferralSummary> {
  return { eligible: false, reason: "not_hosted", rewarded: 0, pending: 0, earnedHours: 0, bonusHours: 0, capHours: 0, rewardHours: 0 }
}
export async function attachReferral(_request: Request, _userId: string): Promise<boolean> {
  return false
}
export async function attachRequestReferral(_referrerWorkspaceId: string, _userId: string): Promise<boolean> {
  return false
}
export async function requestReward(_referrerWorkspaceId: string, _userId: string): Promise<null> {
  return null
}
export async function moveReferral(_fromUserId: string, _toUserId: string): Promise<void> {}
export async function settleReferral(_userId: string): Promise<null> {
  return null
}
