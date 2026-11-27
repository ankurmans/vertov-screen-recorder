import { getPreferenceValues, open } from "@raycast/api"

export default async function Command() {
  const { baseUrl } = getPreferenceValues<{ baseUrl?: string }>()
  await open(`${(baseUrl || "https://vertov.app").replace(/\/+$/, "")}/record`)
}
