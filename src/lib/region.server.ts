import { env } from "cloudflare:workers"
import { appOrigin, regionChoiceEnabled, regionOf, type Region, type RegionEnv } from "@/lib/region"

const source = (): RegionEnv => ({
  VERTOV_REGION: Reflect.get(env, "VERTOV_REGION") as string | undefined,
  APP_URL: Reflect.get(env, "APP_URL") as string | undefined,
  EU_SIGNUP: Reflect.get(env, "EU_SIGNUP") as string | undefined,
})

/** The stack this Worker is, from the deploy-time VERTOV_REGION var (default `us`). */
export const currentRegion = (): Region => regionOf(source())

/** Where this stack's own links point (no trailing slash). */
export const currentAppOrigin = (): string => appOrigin(source())

/** Whether sign-up asks where the account should live (off until the EU stack is live). */
export const regionChoiceOn = (): boolean => regionChoiceEnabled(source())

/**
 * Container Durable Objects on the EU stack are created in the EU jurisdiction, as well as running their containers under the
 * `constraints.jurisdiction` in wrangler.jsonc. The US stack keeps the plain namespace so its existing objects are untouched.
 */
export const inRegion = <T extends Rpc.DurableObjectBranded | undefined>(binding: DurableObjectNamespace<T>): DurableObjectNamespace<T> =>
  currentRegion() === "eu" ? binding.jurisdiction("eu") : binding
