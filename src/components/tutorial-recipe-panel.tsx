import { useEffect, useState } from "react"
import { VertovIcon } from "@/components/vertov-icon"
import { formatSeconds } from "@/components/tutorial-types"
import type { RecipeSummary } from "@/components/tutorial-types"

/** Pick a recipe, review what will be said and done, set its parameters, and queue the recording. */
export function TutorialRecipePanel({
  recipes,
  runnerOnline,
  onStarted,
}: {
  recipes: Array<RecipeSummary>
  runnerOnline: boolean
  onStarted: () => void
}) {
  const [recipeId, setRecipeId] = useState<string | null>(recipes[0]?.id ?? null)
  const recipe = recipes.find((item) => item.id === recipeId) ?? null
  const [values, setValues] = useState<Record<string, string>>({})
  const [presenter, setPresenter] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!recipe) return
    setValues(Object.fromEntries(recipe.parameters.map((parameter) => [parameter.name, parameter.default])))
    setError(null)
  }, [recipe])

  async function start() {
    if (!recipe || busy) return
    setBusy(true)
    setError(null)
    try {
      const response = await fetch("/api/v1/tutorials/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ recipeId: recipe.id, parameters: values, presenter }),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        setError(body?.error ?? "Couldn't start the recording.")
        return
      }
      onStarted()
    } catch {
      setError("Couldn't reach Vertov. Check your connection and try again.")
    } finally {
      setBusy(false)
    }
  }

  if (recipes.length === 0) return <p className="mt-4 text-sm text-neutral-500">No tutorial recipes are available yet.</p>

  return (
    <div className="mt-4 grid gap-8 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <ul aria-label="Tutorial recipes" className="flex flex-col gap-1">
        {recipes.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => setRecipeId(item.id)}
              aria-pressed={item.id === recipeId}
              className={`flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm ${item.id === recipeId ? "bg-neutral-200/70 font-medium text-neutral-900" : "text-neutral-600 hover:bg-neutral-200/60"}`}
            >
              <VertovIcon name="tutorial" size={16} className="mt-0.5 text-neutral-500" />
              <span>{item.title}</span>
            </button>
          </li>
        ))}
      </ul>

      {recipe && (
        <section aria-labelledby="recipe-title" className="min-w-0">
          <h3 id="recipe-title" className="text-xl font-semibold tracking-tight">
            {recipe.title}
          </h3>
          <p className="mt-2 max-w-prose text-sm text-neutral-600">{recipe.summary}</p>

          {recipe.preconditions.length > 0 && (
            <div className="mt-5">
              <h4 className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">Before it starts</h4>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-neutral-700">
                {recipe.preconditions.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}

          {recipe.parameters.length > 0 && (
            <div className="mt-5 grid max-w-md gap-4">
              {recipe.parameters.map((parameter) => (
                <div key={parameter.name}>
                  <label htmlFor={`param-${parameter.name}`} className="block text-sm font-medium">
                    {parameter.label}
                  </label>
                  <input
                    id={`param-${parameter.name}`}
                    value={values[parameter.name] ?? ""}
                    maxLength={parameter.maxLength}
                    onChange={(event) => setValues((current) => ({ ...current, [parameter.name]: event.target.value }))}
                    aria-describedby={parameter.description ? `param-${parameter.name}-hint` : undefined}
                    className="mt-1.5 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
                  />
                  {parameter.description && (
                    <p id={`param-${parameter.name}-hint`} className="mt-1 text-xs text-neutral-500">
                      {parameter.description}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="mt-6">
            <h4 className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">Script</h4>
            <p className="mt-1 text-xs text-neutral-500">
              {recipe.steps.length} steps, {recipe.words} words, about {formatSeconds(recipe.estimatedSeconds)} at 175 words a minute.
            </p>
            <ol aria-label="Narration script" className="mt-3 divide-y divide-neutral-200 border-y border-neutral-200">
              {recipe.steps.map((step, index) => (
                <li key={step.id} className="py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-sm font-medium">
                      {index + 1}. {step.goal}
                    </p>
                    <span className="shrink-0 text-xs text-neutral-500 tabular-nums">{formatSeconds(step.seconds)}</span>
                  </div>
                  <p className="mt-1 text-sm leading-relaxed text-neutral-600">{step.narration}</p>
                </li>
              ))}
            </ol>
          </div>

          <label className="mt-5 flex cursor-pointer items-start gap-2.5 text-sm">
            <input type="checkbox" checked={presenter} onChange={(event) => setPresenter(event.target.checked)} className="mt-1" />
            <span>
              Add the presenter portrait
              <span className="block text-xs text-neutral-500">A still image in the corner. It is not lip-synced.</span>
            </span>
          </label>

          {error && (
            <p role="alert" className="mt-4 text-sm text-red-700">
              {error}
            </p>
          )}
          {!runnerOnline && (
            <p className="mt-4 text-sm text-neutral-600">
              No runner is connected, so the job will wait in the queue until one starts. Start it from the status line above.
            </p>
          )}
          <button
            type="button"
            onClick={() => void start()}
            disabled={busy}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            <VertovIcon name="screen" size={16} />
            {busy ? "Queuing…" : "Start recording"}
          </button>
        </section>
      )}
    </div>
  )
}
