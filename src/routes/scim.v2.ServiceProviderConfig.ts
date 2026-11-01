import { createFileRoute } from "@tanstack/react-router"
import { scimApi, scimJson } from "@/lib/scim.server"

/** Tells identity providers what this SCIM server supports: users only, no bulk or sorting. */
export const Route = createFileRoute("/scim/v2/ServiceProviderConfig")({
  server: {
    handlers: {
      GET: ({ request }) =>
        scimApi(request, async () =>
          scimJson({
            schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
            patch: { supported: true },
            bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
            filter: { supported: true, maxResults: 200 },
            changePassword: { supported: false },
            sort: { supported: false },
            etag: { supported: false },
            authenticationSchemes: [{ type: "oauthbearertoken", name: "Bearer token", description: "Workspace SCIM token" }],
          }),
        ),
    },
  },
})
