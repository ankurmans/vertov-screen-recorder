import { createFileRoute, redirect } from "@tanstack/react-router"

// The import flow opens from /?import=1. Old sign-in links used /signin?redirect=/import and ended on a 404.
export const Route = createFileRoute("/import")({
  beforeLoad: () => {
    throw redirect({ href: "/?import=1", statusCode: 301 })
  },
})
