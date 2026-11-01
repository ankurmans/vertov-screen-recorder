// Billing is part of the hosted service and is not included in this edition.
// A self-hosted install has no plans, limits or checkout, so these report "off".
export function billingEnabled(): boolean {
  return false
}

export function billingOptions() {
  return { enabled: false, yearly: false, extraHours: false }
}
