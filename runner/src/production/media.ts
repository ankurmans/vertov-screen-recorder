import { spawn } from "node:child_process"

/** Runs a binary, collecting output. Fails with the last 20 stderr lines when it exits non-zero. */
export function run(command: string, args: Array<string>): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => (stdout += chunk))
    child.stderr.on("data", (chunk) => (stderr += chunk))
    child.on("error", (error) => reject(new Error(`${command} could not start (${error.message}). Is it installed and on PATH?`)))
    child.on("close", (code) => {
      if (code === 0) return resolve({ stdout, stderr })
      const tail = stderr.trim().split("\n").slice(-20).join("\n")
      reject(new Error(`${command} exited with code ${code}:\n${tail}`))
    })
  })
}

export async function probeSeconds(path: string): Promise<number> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", path])
  const seconds = Number(stdout.trim())
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error(`Could not read the duration of ${path}`)
  return seconds
}
