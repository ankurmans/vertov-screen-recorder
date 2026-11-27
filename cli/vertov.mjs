#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir, platform } from "node:os"
import { dirname, join } from "node:path"

const BASE = (process.env.VERTOV_URL || "https://vertov.app").replace(/\/+$/, "")
const CONFIG = join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "vertov", "cli.json")

const HELP = `vertov <command>

  login <rk_key>        save your API key (create one in Vertov settings)
  list [--json]         your recordings, newest first
  link <id|latest>      print the share link
  copy [id|latest]      copy the share link to the clipboard
  open [id|latest]      open a recording in the browser
  record                open the recorder

VERTOV_URL overrides the server (default https://vertov.app).`

const die = (message) => {
  console.error(message)
  process.exit(1)
}

function readKey() {
  if (process.env.VERTOV_KEY) return process.env.VERTOV_KEY
  try {
    return JSON.parse(readFileSync(CONFIG, "utf8")).key
  } catch {
    return undefined
  }
}

function saveKey(key) {
  mkdirSync(dirname(CONFIG), { recursive: true })
  writeFileSync(CONFIG, JSON.stringify({ key }) + "\n", { mode: 0o600 })
  chmodSync(CONFIG, 0o600)
}

async function videos() {
  const key = readKey()
  if (!key) die("Not logged in. Run: vertov login <rk_key>")
  const res = await fetch(`${BASE}/api/v1/videos`, { headers: { Authorization: `Bearer ${key}` } })
  if (res.status === 401) die("That API key was rejected. Run: vertov login <rk_key>")
  if (!res.ok) die(`Request failed: ${res.status}`)
  const body = await res.json()
  return body.videos ?? []
}

async function pick(arg) {
  const all = await videos()
  if (all.length === 0) die("No recordings yet.")
  if (!arg || arg === "latest") return all[0]
  const found = all.find((v) => v.id === arg || v.url?.endsWith(`/${arg}`))
  if (!found) die(`No recording matches "${arg}".`)
  return found
}

const urlOf = (video) => (video.url?.startsWith("http") ? video.url : `${BASE}${video.url ?? `/${video.id}`}`)

function clock(seconds) {
  const total = Math.round(Number(seconds) || 0)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`
}

function openUrl(url) {
  const [cmd, args] =
    platform() === "darwin" ? ["open", [url]] : platform() === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]]
  spawn(cmd, args, { stdio: "ignore", detached: true }).unref()
}

function copyText(text) {
  const candidates = platform() === "darwin" ? [["pbcopy", []]] : platform() === "win32" ? [["clip", []]] : [["wl-copy", []], ["xclip", ["-selection", "clipboard"]], ["xsel", ["--clipboard", "--input"]]]
  for (const [cmd, args] of candidates) {
    const result = spawnSync(cmd, args, { input: text })
    if (!result.error && result.status === 0) return true
  }
  return false
}

const [command, ...rest] = process.argv.slice(2)

switch (command) {
  case "login": {
    const key = rest[0]
    if (!key || !key.startsWith("rk_")) die("Usage: vertov login <rk_key>  (keys start with rk_)")
    saveKey(key)
    console.log(`Saved to ${CONFIG}`)
    break
  }
  case "list": {
    const all = await videos()
    if (rest.includes("--json")) {
      console.log(JSON.stringify(all, null, 2))
      break
    }
    if (all.length === 0) console.log("No recordings yet.")
    for (const v of all) console.log(`${v.id}\t${clock(v.duration)}\t${v.status ?? ""}\t${v.title || "Untitled"}`)
    break
  }
  case "link":
    console.log(urlOf(await pick(rest[0] ?? "latest")))
    break
  case "copy": {
    const url = urlOf(await pick(rest[0]))
    console.log(copyText(url) ? `Copied ${url}` : url)
    break
  }
  case "open":
    openUrl(urlOf(await pick(rest[0])))
    break
  case "record":
    openUrl(`${BASE}/record`)
    break
  case undefined:
  case "help":
  case "--help":
  case "-h":
    console.log(HELP)
    break
  default:
    die(`Unknown command "${command}".\n\n${HELP}`)
}
