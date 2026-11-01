import { createFileRoute } from "@tanstack/react-router"
import { getSessionUser } from "@/lib/auth.server"
import { handleRpc } from "@/lib/mcp.server"
import { getWorkspaceContext } from "@/lib/workspace.server"

const unauthorized = () =>
  Response.json(
    { jsonrpc: "2.0", id: null, error: { code: -32001, message: "Send an API key: Authorization: Bearer rk_… (create one in Settings → API keys)" } },
    { status: 401, headers: { "www-authenticate": 'Bearer realm="mcp"' } },
  )

/** MCP endpoint (Streamable HTTP, stateless, JSON responses). See src/lib/mcp.server.ts. */
export const Route = createFileRoute("/mcp")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const user = await getSessionUser(request)
        if (!user) return unauthorized()
        const context = await getWorkspaceContext(request, user)
        const origin = new URL(request.url).origin
        const body: unknown = await request.json().catch(() => null)
        if (body === null || typeof body !== "object") {
          return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 })
        }
        const messages = Array.isArray(body) ? body : [body]
        const replies = []
        for (const message of messages) {
          try {
            const reply = await handleRpc(message, user, context, origin)
            if (reply) replies.push(reply)
          } catch (error) {
            console.error(JSON.stringify({ message: "MCP call failed", error: error instanceof Error ? error.message : String(error) }))
            replies.push({ jsonrpc: "2.0", id: (message as { id?: unknown }).id ?? null, error: { code: -32603, message: "Internal error" } })
          }
        }
        if (replies.length === 0) return new Response(null, { status: 202 })
        return Response.json(Array.isArray(body) ? replies : replies[0])
      },
      // Stateless server: no server-initiated stream.
      GET: () => new Response("Method not allowed", { status: 405, headers: { allow: "POST" } }),
    },
  },
})
