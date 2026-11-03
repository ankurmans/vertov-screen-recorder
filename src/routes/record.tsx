import { createFileRoute, redirect } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import { getRequest } from "@tanstack/react-start/server"
import { Recorder } from "@/components/recorder"
import { getSessionUser } from "@/lib/auth.server"
import { APP_NAME } from "@/lib/brand"

const loadRecorder = createServerFn({ method: "GET" }).handler(async () => {
  const user = await getSessionUser(getRequest())
  return { signedIn: Boolean(user) }
})

export const Route = createFileRoute("/record")({
  // ?space=<id> records straight into a shared space.
  validateSearch: (search: Record<string, unknown>) => ({
    space: typeof search.space === "string" ? search.space : undefined,
    // Set when someone is recording for a "Request a video" link.
    request: typeof search.request === "string" ? search.request : undefined,
    // Set when another app (like Donezo Inbox) opened this window to get a finished recording back.
    embed: search.embed === "1" || search.embed === 1 ? true : undefined,
  }),
  loader: async () => {
    const { signedIn } = await loadRecorder()
    if (!signedIn)
      throw redirect({ to: "/signin", search: { redirect: "/record" } })
  },
  head: () => ({ meta: [{ title: `Record — ${APP_NAME}` }] }),
  component: RecordPage,
})

function RecordPage() {
  const { space, request, embed } = Route.useSearch()
  return <Recorder spaceId={space} requestId={request} embed={embed} />
}
