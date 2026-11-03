import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import crypto from "node:crypto"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
export const RUNNER_ROOT = path.resolve(here, "..")
const configDir = path.join(os.homedir(), ".config", "vertov")

export const SESSION_FILE = process.env.VERTOV_RUNNER_SESSION ?? path.join(configDir, "runner", "session.json")
export const PROFILE_DIR = path.join(RUNNER_ROOT, "state", "profile")
export const ARTIFACTS_DIR = process.env.VERTOV_RUNNER_ARTIFACTS ?? path.join(RUNNER_ROOT, "artifacts")

/** KEY=value lines; no quoting rules beyond stripping matching quotes. */
function readEnvFile(file: string): Record<string, string> {
  try {
    const values: Record<string, string> = {}
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line)
      if (match) values[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2")
    }
    return values
  } catch {
    return {}
  }
}

const fileEnv = readEnvFile(path.join(configDir, "runner.env"))
const setting = (name: string) => process.env[name]?.trim() || fileEnv[name]?.trim() || undefined

export const appUrl = () => new URL(setting("VERTOV_APP_URL") ?? "https://vertov.app").origin

/** The API key; the only place it is read, and it is never logged. */
export function apiKey(): string {
  const key = setting("VERTOV_API_KEY")
  if (!key || !key.startsWith("rk_")) throw new Error("Set VERTOV_API_KEY (an rk_ key from Settings → API keys) in the environment or ~/.config/vertov/runner.env")
  return key
}

export function runnerId(): string {
  const configured = setting("RUNNER_ID")
  if (configured) return configured
  const file = path.join(configDir, "runner-id")
  try {
    const existing = fs.readFileSync(file, "utf8").trim()
    if (existing) return existing
  } catch {
    // First run on this machine.
  }
  const id = `${os.hostname().toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30) || "runner"}-${crypto.randomBytes(3).toString("hex")}`
  fs.mkdirSync(configDir, { recursive: true, mode: 0o700 })
  fs.writeFileSync(file, `${id}\n`, { mode: 0o600 })
  return id
}

export function jobDir(jobId: string): string {
  const dir = path.join(ARTIFACTS_DIR, jobId.replace(/[^\w-]/g, "_"))
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

const CHROME_FOR_TESTING = path.join(os.homedir(), ".agent-browser", "browsers", "chrome-146.0.7680.80", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing")

/** A dedicated Chrome for Testing build; never the everyday Chrome profile. */
export function chromePath(): string {
  const configured = process.env.CHROME_PATH?.trim()
  if (configured) return configured
  if (fs.existsSync(CHROME_FOR_TESTING)) return CHROME_FOR_TESTING
  throw new Error("Set CHROME_PATH to a Chrome for Testing or Chromium executable (not your everyday Chrome).")
}

export const isLocalOrigin = (origin: string) => {
  const host = new URL(origin).hostname
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".localhost")
}

export function writePrivate(file: string, content: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  fs.writeFileSync(file, content, { mode: 0o600 })
  fs.chmodSync(file, 0o600)
}
