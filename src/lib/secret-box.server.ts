import { env } from "cloudflare:workers"

const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
const unbase64 = (text: string) => Uint8Array.from(atob(text), (char) => char.charCodeAt(0))

async function key(): Promise<CryptoKey> {
  const secret = (env as unknown as Record<string, string | undefined>).BETTER_AUTH_SECRET || "local-dev-secret"
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`vertov-secret-box:${secret}`))
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"])
}

/** Encrypts a third-party key for storage: AES-GCM under a key derived from the auth secret. */
export async function seal(plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(), new TextEncoder().encode(plain)))
  return `${base64(iv)}.${base64(sealed)}`
}

/** The original text, or null when it was sealed under a different secret or is damaged. */
export async function unseal(stored: string): Promise<string | null> {
  try {
    const [iv, data] = stored.split(".")
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unbase64(iv) }, await key(), unbase64(data))
    return new TextDecoder().decode(plain)
  } catch {
    return null
  }
}
