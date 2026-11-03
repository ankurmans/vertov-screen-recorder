import { bindRecipe, resolveParameters } from "../../src/lib/tutorials/recipe"
import { recipeById } from "../../src/lib/tutorials/recipes"
import { jobDir } from "./config"
import { logger } from "./logger"
import { runPipeline } from "./pipeline"

/** npm run run-local -- <recipeId> [--param name=value] [--no-upload] [--presenter] [--headed] */
const argv = process.argv.slice(2)
const recipeId = argv.find((arg) => !arg.startsWith("--") && !arg.includes("="))
const flag = (name: string) => argv.includes(`--${name}`)
const params: Record<string, string> = {}
argv.forEach((arg, index) => {
  if (arg === "--param" && argv[index + 1]?.includes("=")) {
    const [name, ...rest] = argv[index + 1].split("=")
    params[name] = rest.join("=")
  }
})

const recipe = recipeId ? recipeById(recipeId) : null
if (!recipe) {
  console.error(`Usage: npm run run-local -- <recipeId> [--param name=value] [--no-upload] [--presenter] [--headed]\nUnknown recipe${recipeId ? ` “${recipeId}”` : ""}.`)
  process.exit(2)
}
const resolved = resolveParameters(recipe, params)
if (!resolved.ok) {
  console.error(resolved.error)
  process.exit(2)
}
const bound = bindRecipe(recipe, resolved.values)
const jobId = `local-${Date.now()}`
const workdir = jobDir(jobId)

try {
  const result = await runPipeline({
    jobId,
    title: bound.title,
    recipe: bound,
    presenter: flag("presenter"),
    workdir,
    progress: async (p) => {
      logger.info(`${p.stage}${p.step ? ` · ${p.step}` : ""}${p.message ? ` · ${p.message}` : ""}`)
      return { cancel: false }
    },
    logger,
    upload: !flag("no-upload"),
    headed: flag("headed"),
  })
  logger.info(`Finished. MP4: ${result.produced.path}${result.videoUrl ? `\nShare link: ${result.videoUrl}` : ""}`)
} catch (error) {
  logger.error(`${(error as Error).message}\nArtifacts: ${workdir}`)
  process.exit(1)
}
