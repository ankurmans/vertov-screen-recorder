import { z } from "zod"

/**
 * A tutorial recipe: data only. A submitted job names a registered recipe and supplies parameters; it never carries code,
 * credentials or browser state. The runner executes these steps in a dedicated browser limited to the recipe's origins.
 */

const text = (max: number) => z.string().trim().min(1).max(max)

/** Accessible locators first; `css` exists for the rare control with no role or label and may not contain script. */
export const locatorSchema = z
  .object({
    role: z.enum(["button", "link", "textbox", "radio", "checkbox", "combobox", "heading", "dialog", "menuitem", "listitem", "navigation", "list"]).optional(),
    name: text(120).optional(),
    exact: z.boolean().optional(),
    label: text(120).optional(),
    text: text(200).optional(),
    testId: text(80).optional(),
    css: z.string().trim().min(1).max(200).regex(/^[\w\s.#\-\[\]="':>,*+~^$|()]+$/, "Selector characters only").optional(),
    /** Which match to use when the page has several (0 is first). */
    nth: z.number().int().min(0).max(20).optional(),
    /** Narrow to elements inside a dialog or landmark first. */
    within: z.object({ role: z.enum(["dialog", "navigation", "list", "main"]), name: text(120).optional() }).optional(),
  })
  .refine((l) => [l.role, l.label, l.text, l.testId, l.css].filter((v) => v !== undefined).length === 1, "Give exactly one of role, label, text, testId or css")

export type Locator = z.infer<typeof locatorSchema>

const path = z
  .string()
  .regex(/^\/(?!\/)[\w\-./?=&%#]*$/, "A path on the app, starting with a single /")
  .max(200)

export const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("goto"), path }),
  z.object({ type: z.literal("click"), target: locatorSchema }),
  z.object({ type: z.literal("fill"), target: locatorSchema, value: z.string().max(200) }),
  z.object({ type: z.literal("scroll"), target: locatorSchema.optional(), direction: z.enum(["up", "down"]), amount: z.number().int().min(50).max(1200).default(400) }),
  z.object({ type: z.literal("wait"), until: locatorSchema }),
  z.object({ type: z.literal("pause"), seconds: z.number().min(0.2).max(6) }),
])
export type Action = z.infer<typeof actionSchema>

export const expectationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("visible"), target: locatorSchema }),
  z.object({ type: z.literal("hidden"), target: locatorSchema }),
  z.object({ type: z.literal("url"), path: path }),
])
export type Expectation = z.infer<typeof expectationSchema>

export const stepSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  goal: text(160),
  /** Spoken while this step's footage is on screen. {{param}} placeholders are filled from the job's parameters. */
  narration: text(700),
  actions: z.array(actionSchema).min(1).max(12),
  /** What must be true on screen afterwards. A step without expectations is an unverified click sequence. */
  expect: z.array(expectationSchema).max(6).default([]),
  /** Extra seconds to hold the result on screen after the narration, for the viewer to read it. */
  hold: z.number().min(0).max(6).default(1.5),
})
export type Step = z.infer<typeof stepSchema>

export const parameterSchema = z.object({
  name: z.string().regex(/^[a-zA-Z][a-zA-Z0-9]{0,30}$/),
  label: text(60),
  description: text(160).optional(),
  default: z.string().max(80),
  maxLength: z.number().int().min(1).max(80).default(40),
})

export const recipeSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{3,60}$/),
    version: z.number().int().min(1),
    title: text(100),
    summary: text(300),
    /** The only origins the browser may load or act on. Matched against the origin the job targets, never wildcards. */
    allowedOrigins: z.array(z.enum(["app"])).min(1),
    /** What the demo account must have before recording, so a missing precondition fails early instead of mid-recording. */
    preconditions: z.array(text(160)).max(6),
    parameters: z.array(parameterSchema).max(6),
    steps: z.array(stepSchema).min(1).max(20),
  })
  .superRefine((recipe, ctx) => {
    const ids = new Set<string>()
    for (const step of recipe.steps) {
      if (ids.has(step.id)) ctx.addIssue({ code: "custom", message: `Duplicate step id ${step.id}` })
      ids.add(step.id)
    }
    const names = new Set(recipe.parameters.map((p) => p.name))
    const used = JSON.stringify(recipe).matchAll(/\{\{(\w+)\}\}/g)
    for (const match of used) if (!names.has(match[1])) ctx.addIssue({ code: "custom", message: `Unknown parameter {{${match[1]}}}` })
  })

export type Recipe = z.infer<typeof recipeSchema>

/** Values for a recipe's parameters: defaults filled in, unknown names rejected, length limits enforced. */
export function resolveParameters(recipe: Recipe, given: unknown): { ok: true; values: Record<string, string> } | { ok: false; error: string } {
  const input = given && typeof given === "object" && !Array.isArray(given) ? (given as Record<string, unknown>) : {}
  const known = new Set(recipe.parameters.map((p) => p.name))
  for (const name of Object.keys(input)) if (!known.has(name)) return { ok: false, error: `Unknown parameter “${name}”` }
  const values: Record<string, string> = {}
  for (const parameter of recipe.parameters) {
    const raw = input[parameter.name]
    const value = typeof raw === "string" ? raw.trim() : raw === undefined ? parameter.default : null
    if (value === null) return { ok: false, error: `${parameter.label} must be text` }
    if (!value) return { ok: false, error: `${parameter.label} can't be empty` }
    if (value.length > parameter.maxLength) return { ok: false, error: `${parameter.label} is longer than ${parameter.maxLength} characters` }
    if (/[<>\u0000-\u001f]/.test(value)) return { ok: false, error: `${parameter.label} has characters that aren't allowed` }
    values[parameter.name] = value
  }
  return { ok: true, values }
}

export const fill = (template: string, values: Record<string, string>) => template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => values[name] ?? "")

/** A recipe with every placeholder filled in, ready for the runner. */
export function bindRecipe(recipe: Recipe, values: Record<string, string>): Recipe {
  return JSON.parse(fill(JSON.stringify(recipe), Object.fromEntries(Object.entries(values).map(([k, v]) => [k, JSON.stringify(v).slice(1, -1)])))) as Recipe
}

export const TARGET_WPM = 175
export const wordCount = (value: string) => value.trim().split(/\s+/).filter(Boolean).length
/** Seconds the narration takes at the teaching pace; the real audio length replaces this once synthesised. */
export const estimateSeconds = (value: string, wpm = TARGET_WPM) => (wordCount(value) / wpm) * 60
