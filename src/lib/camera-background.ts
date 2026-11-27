// Camera background effects are part of the hosted service and are not included in this edition.
// The recorder hides its Background picker because backgroundSupported() is false.

export const WEB_BACKGROUNDS = [{ value: "none", label: "No effect" }] as const

export type WebBackground = (typeof WEB_BACKGROUNDS)[number]["value"]

export function backgroundSupported(): boolean {
  return false
}

export function applyBackground(
  source: MediaStream,
  _background: WebBackground,
): Promise<{ stream: MediaStream; stop: () => void }> {
  return Promise.resolve({ stream: source, stop: () => {} })
}
