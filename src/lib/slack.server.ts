import { eq } from "drizzle-orm"
import { db } from "@/db"
import { workspaces } from "@/db/schema"

const HOOK_PREFIX = "https://hooks.slack.com/"

export const isSlackWebhook = (value: string) => value.startsWith(HOOK_PREFIX) && value.length < 300 && !/\s/.test(value)

/** Shows enough to recognise the hook without exposing it: the last four characters only. */
export const maskWebhook = (value: string) => `${HOOK_PREFIX}…${value.slice(-4)}`

async function post(webhook: string, text: string): Promise<boolean> {
  const response = await fetch(webhook, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(5000),
  })
  return response.ok
}

/** Sends a message to the workspace's Slack channel if it has one. Best effort: never throws and never logs the hook. */
export async function notify(workspaceId: string | null | undefined, text: string): Promise<void> {
  if (!workspaceId) return
  try {
    const row = await db.select({ hook: workspaces.slackWebhook }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1)
    const hook = row[0]?.hook
    if (hook && isSlackWebhook(hook)) await post(hook, text)
  } catch {
    // A failed notice must never break what triggered it.
  }
}

export async function sendTest(webhook: string, workspaceName: string): Promise<boolean> {
  return post(webhook, `Vertov is connected to ${workspaceName}. New videos and comments will show up here.`).catch(() => false)
}
