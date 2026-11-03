import { createFileRoute } from "@tanstack/react-router"
import { json, optionsResponse } from "@/lib/api.server"
import * as tutorials from "@/lib/tutorials.server"
import { workspaceApi } from "@/lib/workspace-api.server"

/** The tutorial recipes a runner can perform, with their scripts and parameters. */
export const Route = createFileRoute("/api/v1/tutorials/recipes")({
  server: { handlers: { GET: ({ request }) => workspaceApi(request, async () => json({ recipes: tutorials.listRecipes() }), { manage: true }), OPTIONS: () => optionsResponse() } },
})
