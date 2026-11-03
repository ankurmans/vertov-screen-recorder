/**
 * PostHog product analytics, behind a consent choice.
 *
 * Until a visitor accepts, PostHog runs in cookieless mode: no cookies or browser storage, and
 * PostHog counts visitors with a daily-salted hash on its servers (the project must have
 * "Cookieless server hash mode" turned on, or those events are dropped). Accepting switches to
 * normal tracking, which allows identifying signed-in users. Embeds on other sites never load it.
 */

export interface AnalyticsConfig {
  key: string
  host: string
}

interface PostHogLike {
  __loaded?: boolean
  get_explicit_consent_status?: () => "granted" | "denied" | "pending"
  opt_in_capturing: () => void
  opt_out_capturing: () => void
  identify: (id: string) => void
}

declare global {
  interface Window {
    posthog?: PostHogLike
  }
}

export const ANALYTICS_LOADED = "vertov:analytics-loaded"

// PostHog's published loader stub: queues calls until /static/array.js arrives.
const LOADER = '!function(t,e){var o,n,p,r;e.__SV||(window.posthog && window.posthog.__loaded)||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}p||((p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",p.onerror=function(){p=null},(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r));var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],Object.defineProperty(u,"toString",{configurable:!0,enumerable:!0,writable:!0,value:function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e}}),Object.defineProperty(u.people,"toString",{configurable:!0,enumerable:!0,writable:!0,value:function(){return u.toString(1)+".people (stub)"}}),o="rh ah uh hh ph init Uh Wh Nh qh Jh Ku Hh Zh Fh sd rd od ad ld ud capture getExtension Vh pr Bh zh calculateEventProperties dd register register_once register_for_session unregister unregister_for_session md Lh fd getFeatureFlag getFeatureFlagPayload getFeatureFlagResult getAllFeatureFlags isFeatureEnabled reloadFeatureFlags updateFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSurveysLoaded onSessionId getSurveys getActiveMatchingSurveys onActiveMatchingSurveysChanged renderSurvey displaySurvey cancelPendingSurvey canRenderSurvey canRenderSurveyAsync yd identify setPersonProperties unsetPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset bd shutdown setIdentity clearIdentity get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException addExceptionStep captureLog startExceptionAutocapture stopExceptionAutocapture loadToolbar get_property getSessionProperty pd Xh createPersonProfile setInternalOrTestUser gd bh mh opt_in_capturing opt_out_capturing yh has_opted_in_capturing has_opted_out_capturing get_explicit_consent_status is_capturing clear_opt_in_out_capturing Kh debug Yu Fs getPageViewId captureTraceFeedback captureTraceMetric Ah".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);'

/** The inline script for the document head: the loader stub plus init, skipped inside embeds. */
export function analyticsScript(config: AnalyticsConfig): string {
  const options = {
    api_host: config.host,
    defaults: "2026-05-30",
    person_profiles: "identified_only",
    cookieless_mode: "on_reject",
    // No choice yet counts as opted out, which on_reject captures cookieless.
    opt_out_capturing_by_default: true,
    session_recording: { maskAllInputs: true },
  }
  // Values are JSON-encoded with "<" escaped so nothing can close the script tag.
  const json = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c")
  const init = `posthog.init(${json(config.key)},Object.assign(${json(options)},{loaded:function(){window.dispatchEvent(new Event(${json(ANALYTICS_LOADED)}))}}))`
  return `if(!location.pathname.startsWith("/embed/")){${LOADER}${init}}`
}

export const consentStatus = () => (window.posthog?.__loaded ? (window.posthog.get_explicit_consent_status?.() ?? "pending") : null)
export const acceptAnalytics = () => window.posthog?.opt_in_capturing()
export const declineAnalytics = () => window.posthog?.opt_out_capturing()

/** Ties events to a signed-in account, only after the visitor accepted cookies. */
export function identifyUser(id: string) {
  if (consentStatus() === "granted") window.posthog?.identify(id)
}
