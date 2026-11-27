/**
 * Product events the server sends to PostHog for signed-in accounts (first-party analytics, owner decision 2026-11-09).
 * Pure helpers with no Worker imports so they can be tested; the sender is in posthog.server.ts.
 *
 * The names are the contract with the PostHog dashboards: rename one and the matching insights go quiet.
 * Properties are fixed vocabulary or numbers only. Never pass a title, email, name, filename, URL or any text a person typed.
 */
export const SERVER_EVENTS = [
  // Sign-up and sign-in
  "user_signed_up",
  "account_saved",
  "account_connected",
  "user_signed_in",
  "guest_account_linked",
  // Activation
  "library_opened",
  "recording_started",
  "recording_completed",
  "first_recording",
  "returning_recorder",
  "agent_tutorial_started",
  "agent_tutorial_completed",
  "loom_import_started",
  "loom_import_ready",
  // Sharing and the loop back to the owner
  "recording_share_copied",
  // "Show me" links: made, answered, and a saved account arriving from the invite on the answer's done screen
  "request_created",
  "request_submitted",
  "request_invite_accepted",
  // A sender asked their video's viewers to reply by recording one back
  "reply_requested",
  "video_viewed",
  "video_comment_received",
  // Depth of use
  "cuts_saved",
  "mcp_connected",
  "workspace_action",
  // Revenue
  "checkout_started",
  "subscription_event",
  // Plan limits and the loops they feed (props are fixed vocabulary: plan, threshold, feature, side, counts)
  "bank_threshold",
  "length_cap_hit",
  "long_video_courtesy_used",
  "feature_locked_hit",
  "trial_started",
  "ai_teaser_used",
  "ai_teaser_exhausted",
  "referral_rewarded",
] as const

/** Events the browser sends (consent-gated, through the PostHog snippet). Same rule for properties: fixed vocabulary only. */
export const CLIENT_EVENTS = ["locked_feature_clicked", "upgrade_prompt_seen", "homepage_cta_clicked", "request_invite_clicked", "watched_card_seen", "watched_card_action", "move_card_copied", "playlist_viewed", "review_prompt_seen", "review_prompt_action"] as const
export type ClientEvent = (typeof CLIENT_EVENTS)[number]

export type ServerEvent = (typeof SERVER_EVENTS)[number]
export type EventValue = string | number | boolean | null
export type EventProps = Record<string, EventValue>

/** Labels direct homepage requests without storing or sending the visitor's URL. */
export function recordingEntry(request: Request): "homepage" | null {
  const referer = request.headers.get("referer")
  if (!referer || !URL.canParse(referer)) return null
  const source = new URL(referer)
  return source.origin === new URL(request.url).origin && source.pathname === "/" ? "homepage" : null
}

const KEY = /^[a-z][a-z0-9_]{0,39}$/
const MAX_TEXT = 64

/** Keeps only well-named keys and short primitive values, so free text cannot leak into analytics by accident. */
export function cleanProps(props: EventProps | undefined): EventProps {
  const out: EventProps = {}
  for (const [key, value] of Object.entries<unknown>(props ?? {})) {
    if (!KEY.test(key)) continue
    if (typeof value === "string") out[key] = value.slice(0, MAX_TEXT)
    else if (typeof value === "number") {
      if (Number.isFinite(value)) out[key] = value
    } else if (typeof value === "boolean" || value === null) out[key] = value
  }
  return out
}

/** The JSON body for PostHog's /i/v0/e/ capture endpoint. */
export function captureBody(
  apiKey: string,
  event: ServerEvent,
  distinctId: string,
  props?: EventProps,
  options: { set?: EventProps; setOnce?: EventProps; person?: boolean; now?: Date } = {},
) {
  const person = options.person !== false
  return {
    api_key: apiKey,
    event,
    distinct_id: distinctId,
    timestamp: (options.now ?? new Date()).toISOString(),
    properties: {
      ...cleanProps(props),
      $lib: "vertov-server",
      ...(person ? {} : { $process_person_profile: false }),
      ...(options.set ? { $set: cleanProps(options.set) } : {}),
      ...(options.setOnce ? { $set_once: cleanProps(options.setOnce) } : {}),
    },
  }
}

/** Opaque stand-in for a workspace in events that have no user, such as billing webhooks. Carries no person profile. */
export const workspaceDistinctId = (workspaceId: string) => `workspace:${workspaceId}`
