# Product state and decisions

If `docs/product-state.md` exists, read it before planning or changing product behavior. It is the current state index; follow its links to the AI policy and feature evidence. Hosted operational documents are omitted from the public edition.

Keep that index current when work changes a feature, provider/model selection, deployment, migration, activation, verification result or owner decision. Record the date, evidence and outstanding checks. Distinguish proposed, implemented locally, tested, committed, pushed, deployed and activated; none implies the next. Update the short release/decision log as part of the same change. Do not call a feature shipped based only on source code or an old note. Never record credentials, browser sessions or access-bearing URLs.

Model/provider choices require explicit owner approval. Preserve existing choices during unrelated work; disclose fallback behavior. Follow the project AI policy when present, and document approved changes and the effective configuration.

# Cloudflare Workers

STOP. Your knowledge of Cloudflare Workers APIs and limits may be outdated. Always retrieve current documentation before any Workers, KV, R2, D1, Durable Objects, Queues, Vectorize, AI, or Agents SDK task.

## Docs

- https://developers.cloudflare.com/workers/
- MCP: `https://docs.mcp.cloudflare.com/mcp`

For all limits and quotas, retrieve from the product's `/platform/limits/` page. eg. `/workers/platform/limits`

## Commands

| Command | Purpose |
|---------|---------|
| `npx wrangler dev` | Local development |
| `npx wrangler deploy` | Deploy to Cloudflare |
| `npx wrangler types` | Generate TypeScript types |

Run `wrangler types` after changing bindings in wrangler.jsonc.

## Node.js Compatibility

https://developers.cloudflare.com/workers/runtime-apis/nodejs/

## Errors

- **Error 1102** (CPU/Memory exceeded): Retrieve limits from `/workers/platform/limits/`
- **All errors**: https://developers.cloudflare.com/workers/observability/errors/

## Product Docs

Retrieve API references and limits from:
`/kv/` · `/r2/` · `/d1/` · `/durable-objects/` · `/queues/` · `/vectorize/` · `/workers-ai/` · `/agents/`

## Best Practices (conditional)

If the application uses Durable Objects or Workflows, refer to the relevant best practices:

- Durable Objects: https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/
- Workflows: https://developers.cloudflare.com/workflows/build/rules-of-workflows/
