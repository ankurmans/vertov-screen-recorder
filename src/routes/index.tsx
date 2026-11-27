import { createFileRoute, redirect } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import { getRequest } from "@tanstack/react-start/server"
import type { LibrarySearch } from "@/lib/library-search"
import { SimpleHome } from "@/components/simple-home"
import { getSessionUser } from "@/lib/auth.server"
import { APP_NAME } from "@/lib/brand"
import { libraryUrl, validateLibrarySearch } from "@/lib/library-search"

const loadHome = createServerFn({ method: "GET" })
  .validator((search: LibrarySearch) => search)
  .handler(async ({ data }) => {
    const request = getRequest()
    if (await getSessionUser(request)) throw redirect({ href: libraryUrl(data) })
    return { origin: new URL(request.url).origin }
  })

const TITLE = `${APP_NAME}: record your screen and share a link`
const DESCRIPTION = "Record your screen in the browser, then share a link."

export const Route = createFileRoute("/")({
  validateSearch: (search): LibrarySearch => validateLibrarySearch(search),
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
      ],
    }
  },
  component: SimpleHome,
})
