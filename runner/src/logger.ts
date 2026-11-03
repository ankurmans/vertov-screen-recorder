import type { RunnerLogger } from "./types"

const stamp = () => new Date().toISOString().slice(11, 19)
export const logger: RunnerLogger = {
  info: (message) => console.log(`${stamp()}  ${message}`),
  warn: (message) => console.warn(`${stamp()}  warn  ${message}`),
  error: (message) => console.error(`${stamp()}  error ${message}`),
}
