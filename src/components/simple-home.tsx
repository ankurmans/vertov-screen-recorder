import { startAsGuest } from "@/lib/auth-client"
import { APP_NAME } from "@/lib/brand"

/** The signed-out home page of a self-hosted install: one button, no marketing. */
export function SimpleHome() {
  async function start() {
    location.assign((await startAsGuest()) ? "/record" : "/signin?redirect=/record")
  }
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-zinc-50 px-4 text-center text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <img src="/logo.png" alt="" width={64} height={64} className="size-16 rounded-2xl" />
      <h1 className="text-3xl font-bold tracking-tight">{APP_NAME}</h1>
      <p className="max-w-md text-zinc-600 dark:text-zinc-400">Record your screen and camera, share a link, and edit by transcript.</p>
      <div className="flex items-center gap-4">
        <button type="button" onClick={() => void start()} className="rounded-xl bg-red-600 px-5 py-3 font-semibold text-white hover:bg-red-500">
          Start recording
        </button>
        <a href="/signin" className="text-sm text-zinc-600 underline dark:text-zinc-400">
          Sign in
        </a>
      </div>
    </main>
  )
}
