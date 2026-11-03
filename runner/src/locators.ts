import type { Locator as RecipeLocator } from "../../src/lib/tutorials/recipe"
import type { Locator, Page } from "playwright-core"

/** A recipe locator as the Playwright calls it maps to, kept separate from the page so it can be tested without a browser. */
export interface LocatorPlan {
  within?: { role: "dialog" | "navigation" | "list" | "main"; name?: string }
  kind: "role" | "label" | "text" | "testId" | "css"
  role?: string
  value: string
  exact?: boolean
  nth?: number
}

export function planLocator(target: RecipeLocator): LocatorPlan {
  const base = { within: target.within, nth: target.nth }
  if (target.role) return { ...base, kind: "role", role: target.role, value: target.name ?? "", exact: target.exact }
  if (target.label) return { ...base, kind: "label", value: target.label, exact: target.exact }
  if (target.text) return { ...base, kind: "text", value: target.text, exact: target.exact }
  if (target.testId) return { ...base, kind: "testId", value: target.testId }
  if (target.css) return { ...base, kind: "css", value: target.css }
  throw new Error("A locator needs a role, label, text, testId or css")
}

type Root = Pick<Page, "getByRole" | "getByLabel" | "getByText" | "getByTestId" | "locator">

export function applyPlan(page: Root, plan: LocatorPlan): Locator {
  const root: Root = plan.within ? (page.getByRole(plan.within.role, plan.within.name ? { name: plan.within.name } : undefined) as unknown as Root) : page
  let locator: Locator
  switch (plan.kind) {
    case "role":
      locator = root.getByRole(plan.role as Parameters<Page["getByRole"]>[0], plan.value ? { name: plan.value, exact: plan.exact } : undefined)
      break
    case "label":
      locator = root.getByLabel(plan.value, { exact: plan.exact })
      break
    case "text":
      locator = root.getByText(plan.value, { exact: plan.exact })
      break
    case "testId":
      locator = root.getByTestId(plan.value)
      break
    case "css":
      locator = root.locator(plan.value)
      break
  }
  return plan.nth === undefined ? locator : locator.nth(plan.nth)
}

export const resolveLocator = (page: Page, target: RecipeLocator) => applyPlan(page, planLocator(target))

/** For error messages: “Create a space” dialog, “Move” button. */
export function describeLocator(target: RecipeLocator): string {
  const plan = planLocator(target)
  const where = plan.within ? ` in the ${plan.within.name ? `“${plan.within.name}” ` : ""}${plan.within.role}` : ""
  if (plan.kind === "role") return `${plan.value ? `“${plan.value}” ` : ""}${plan.role}${where}`
  if (plan.kind === "label") return `field labelled “${plan.value}”${where}`
  if (plan.kind === "text") return `text “${plan.value}”${where}`
  return `${plan.kind} ${plan.value}${where}`
}
