import { createFileRoute, redirect } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import { getRequest } from "@tanstack/react-start/server"
import { SimpleHome } from "@/components/simple-home"
import { getSessionUser, googleClientId } from "@/lib/auth.server"
import { APP_NAME } from "@/lib/brand"
import { libraryUrl, validateLibrarySearch } from "@/lib/library-search"
import type { LibrarySearch } from "@/lib/library-search"

const loadHome = createServerFn({ method: "GET" })
  .validator((search: LibrarySearch) => search)
  .handler(async ({ data }) => {
    const request = getRequest()
    if (await getSessionUser(request)) throw redirect({ href: libraryUrl(data) })
    return { origin: new URL(request.url).origin, googleClientId: googleClientId() }
  })

const TITLE = `${APP_NAME}: the screen recorder that replaces the meeting`
const DESCRIPTION =
  "Record your screen and camera, share a link, and skip the call. Priced by hours of video stored, with free viewers, edit by transcript, and an MCP server for agents. A Loom alternative."

export const Route = createFileRoute("/")({
  validateSearch: validateLibrarySearch,
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => loadHome({ data: deps }),
  head: ({ loaderData }) => {
    const image = loaderData ? `${loaderData.origin}/logo.png` : "/logo.png"
    return {
      meta: [
        { title: TITLE },
        { name: "description", content: DESCRIPTION },
        { property: "og:title", content: TITLE },
        { property: "og:description", content: DESCRIPTION },
        { property: "og:type", content: "website" },
        { property: "og:image", content: image },
        { name: "twitter:card", content: "summary" },
        { name: "twitter:image", content: image },
      ],
    }
  },
  component: HomePage,
})

function HomePage() {
  return <SimpleHome />
}
