import { createFileRoute } from "@tanstack/react-router"
import { APP_NAME } from "@/lib/brand"

const SECTIONS: Array<{ title: string; body: Array<string> }> = [
  {
    title: "What the extension records",
    body: [
      "Only what you choose, when you press record: a browser tab, a screen or window you pick in Chrome's own picker, your camera and your microphone. Nothing is captured before you start or after you stop.",
      "Video, audio and a still image for the link preview upload to your workspace on the server you connected to, while you record, so the share link is ready the moment you stop.",
    ],
  },
  {
    title: "Optional: click capture for AI agents",
    body: [
      "If you turn on \"Capture clicks for AI agents\", the extension notes which element you clicked (its visible label and a selector) and which pages you opened, with timestamps, and attaches them to that recording's agent brief. It never records what you type. It is off by default.",
    ],
  },
  {
    title: "Camera backgrounds, sizing and live viewing",
    body: [
      "Blurring or replacing your background and resizing a recording happen on your computer, in the extension, before anything is uploaded. The segmentation model ships inside the extension and nothing is sent anywhere to run it.",
      "If you turn on \"Let viewers watch live\", a second copy of the recording uploads a few seconds at a time so people with the link can watch while you record. It is deleted when the recording ends.",
    ],
  },
  {
    title: "Importing from Loom",
    body: [
      "When you ask it to copy a Loom, the extension reads that Loom using your own Loom sign-in in this browser, so private ones work, and sends the video to your workspace. It does not read or store your Loom password.",
    ],
  },
  {
    title: "Browsing and permissions",
    body: [
      "The extension asks for access to all sites only so the camera bubble and drawing tools can appear on the tab you are recording and so old Loom links can open your copy. It does not read page content except for the optional click capture above, and it does not track your browsing.",
      "The connection to your workspace is an API key stored in the extension's local storage. You can disconnect any time from the popup, and revoke the key in settings.",
    ],
  },
  {
    title: "This website",
    body: [
      "We count, per day, how many times the home page was opened and how many sign-up buttons were clicked. The counts hold no identifier, no IP address and nothing about you, and they set no cookie.",
      "If you open the chat on the home page, your question is matched against the page's own text in your browser. It is not sent anywhere.",
    ],
  },
  {
    title: "Signing in with Google",
    body: [
      `If you choose Google, ${APP_NAME} receives your name, email address and profile picture, and nothing else. We use them only to create your account and show who recorded a video. We never read your Google mail, files, calendar or contacts, and we do not share Google account data with anyone.`,
      "Guest accounts need no sign-in at all. If you add a passkey or sign in with Google or an email link later, your videos move to that account.",
    ],
  },
  {
    title: "What we do with your data",
    body: [
      `${APP_NAME} stores your recordings so you and the people you share with can watch them. We do not sell data, show ads or use your recordings to train models. Transcripts and summaries, on plans that include them, are produced by a speech and language provider from the audio of that recording only.`,
      "Delete a video and its files go with it. Free workspaces delete videos nobody else has watched in 90 days, after warning you first.",
    ],
  },
]

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: `Privacy · ${APP_NAME}` },
      { name: "description", content: `What the ${APP_NAME} app and Chrome extension record, where it goes and what we do with it.` },
    ],
  }),
  component: Privacy,
})

function Privacy() {
  return (
    <div className="min-h-dvh bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <header className="mx-auto max-w-2xl px-4 pt-8"><a href="/" className="font-semibold">{APP_NAME}</a></header>
      <main className="mx-auto max-w-2xl px-4 py-16">
        <h1 className="text-4xl font-bold tracking-tight">Privacy</h1>
        <p className="mt-4 leading-relaxed text-zinc-600 dark:text-zinc-400">What the app and the Chrome extension record, where it goes, and what we do with it.</p>
        {SECTIONS.map((section) => (
          <section key={section.title} className="mt-10">
            <h2 className="text-xl font-semibold tracking-tight">{section.title}</h2>
            {section.body.map((paragraph) => (
              <p key={paragraph} className="mt-3 leading-relaxed text-zinc-700 dark:text-zinc-300">
                {paragraph}
              </p>
            ))}
          </section>
        ))}
      </main>
    </div>
  )
}
