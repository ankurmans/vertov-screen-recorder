import { createCsrfMiddleware, createMiddleware, createStart } from "@tanstack/react-start"
import { trackError } from "@/lib/error-report.server"

// A failed query's message lists the values it was given (titles, tokens), which must not reach reports or alert mail.
function withoutValues(error: Error): Error {
  const [message = ""] = error.message.split("\nparams:")
  if (message === error.message) return error
  const safe = new Error(message, { cause: error.cause })
  safe.name = error.name
  // The values are in the stack's first lines too. A stack that doesn't quote the message is replaced rather than trusted.
  if (error.stack?.includes(error.message)) safe.stack = error.stack.replace(error.message, () => message)
  return safe
}

// The framework turns a route's throw into a 500 before src/server.ts sees it, and logs no cause, so it is recorded here.
const reportRouteErrors = createMiddleware().server(async ({ next, pathname }) => {
  try {
    return await next()
  } catch (error) {
    // Redirects and not-found are thrown too, and are not errors.
    if (error instanceof Error) trackError(withoutValues(error), { source: pathname.startsWith("/api/") ? "api" : "fetch", route: pathname })
    throw error
  }
})

// Declaring a start instance replaces the framework's default middleware, so its server function CSRF check is repeated here.
const csrf = createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === "serverFn" })

export const startInstance = createStart(() => ({ requestMiddleware: [reportRouteErrors, csrf] }))
