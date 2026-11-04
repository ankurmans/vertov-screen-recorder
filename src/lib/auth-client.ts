import { passkeyClient } from "@better-auth/passkey/client"
import { anonymousClient, magicLinkClient } from "better-auth/client/plugins"
import { createAuthClient } from "better-auth/react"

export const authClient = createAuthClient({
  basePath: "/api/auth",
  plugins: [passkeyClient(), magicLinkClient(), anonymousClient()],
})

/** A passkey needs an account to live on, so start an anonymous one and attach it. */
export async function signUpWithPasskey(name: string) {
  const session = await authClient.getSession()
  if (!session.data) {
    const anon = await authClient.signIn.anonymous()
    if (anon.error) throw new Error(anon.error.message ?? "Couldn't start sign-up.")
  }
  if (name.trim()) await authClient.updateUser({ name: name.trim() })
  const added = await authClient.passkey.addPasskey({ name: name.trim() || "My videos" })
  if (added.error) throw new Error(added.error.message ?? "The passkey wasn't saved.")
}

export async function signInWithPasskey() {
  const res = await authClient.signIn.passkey()
  if (res.error) throw new Error(res.error.message ?? "That passkey didn't work.")
}

export async function sendMagicLink(email: string, callbackURL: string) {
  const res = await authClient.signIn.magicLink({ email, callbackURL })
  if (res.error) throw new Error(res.error.message ?? "Couldn't send the link.")
}

/** Email and password, for accounts an operator created (app-directory reviewers). There's no password sign-up. */
export async function signInWithPassword(email: string, password: string) {
  const res = await authClient.signIn.email({ email, password })
  if (res.error) throw new Error(res.error.message ?? "That email and password didn't match.")
}

export async function signInWithGoogle(callbackURL: string) {
  const res = await authClient.signIn.social({ provider: "google", callbackURL })
  if (res.error) throw new Error(res.error.message ?? "Google sign-in isn't available.")
}

/** Company single sign-on (OIDC): asks the server for the provider's login URL and goes there. */
export async function signInWithSso(callbackURL: string) {
  const res = await fetch("/api/auth/sign-in/oauth2", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ providerId: "sso", callbackURL }),
  })
  const body = ((await res.json().catch(() => ({}))) ?? {}) as { url?: string; message?: string }
  if (!res.ok || !body.url) throw new Error(body.message ?? "Single sign-on isn't available.")
  location.assign(body.url)
}

/** Landing-page "Start recording": signs in as a guest (if not already signed in) and returns whether it worked. */
export async function startAsGuest(): Promise<boolean> {
  try {
    const session = await authClient.getSession()
    if (session.data) return true
    const anon = await authClient.signIn.anonymous()
    return !anon.error
  } catch {
    return false
  }
}
