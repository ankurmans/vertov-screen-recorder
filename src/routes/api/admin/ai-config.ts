import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";
import { textConfig } from "@/lib/ai.server";
import { json, protectedApi } from "@/lib/api.server";

/** Operator view (UPLOAD_TOKEN) of the text-AI configuration in effect. Change it with Worker variables; see docs/ai-policy.md. */
export const Route = createFileRoute("/api/admin/ai-config")({
  server: {
    handlers: {
      GET: ({ request }) => protectedApi(request, env.UPLOAD_TOKEN, async () => json(textConfig())),
    },
  },
});
