import { createFileRoute, redirect } from "@tanstack/react-router"
import { libraryUrl, validateLibrarySearch } from "@/lib/library-search"

// The library moved to /home. Old emails, bookmarks and extension links still arrive here.
export const Route = createFileRoute("/app")({
  validateSearch: validateLibrarySearch,
  beforeLoad: ({ search }) => {
    throw redirect({ href: libraryUrl(search), statusCode: 301 })
  },
})
