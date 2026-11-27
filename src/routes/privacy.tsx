import { createFileRoute } from "@tanstack/react-router"
import { APP_NAME } from "@/lib/brand"

// A placeholder: replace the two paragraphs with the privacy policy for your own server.
export const Route = createFileRoute("/privacy")({
  head: () => ({ meta: [{ title: `Privacy | ${APP_NAME}` }, { name: "robots", content: "noindex" }] }),
  component: Privacy,
})

function Privacy() {
  return (
    <div className="v-kino-reading min-h-dvh">
      <header className="mx-auto max-w-2xl px-4 pt-8"><a href="/" className="font-semibold">{APP_NAME}</a></header>
      <main id="main" className="mx-auto max-w-2xl px-4 py-16">
        <h1 className="text-4xl font-bold tracking-tight">Privacy</h1>
        <p className="mt-4 leading-relaxed text-zinc-700 dark:text-zinc-300">
          This is a self-hosted copy of {APP_NAME}. Whoever runs this server decides what it stores and how that is used, and has not published a privacy policy here.
        </p>
        <p className="mt-3 leading-relaxed text-zinc-700 dark:text-zinc-300">For questions about your data, ask the person or organisation that runs this server.</p>
      </main>
    </div>
  )
}
