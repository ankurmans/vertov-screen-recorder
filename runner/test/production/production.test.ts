import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, describe, it } from "node:test"
import { estimateSeconds } from "../../../src/lib/tutorials/recipe"
import { recipeById } from "../../../src/lib/tutorials/recipes"
import { bindRecipe } from "../../../src/lib/tutorials/recipe"
import { deriveZooms, produce } from "../../src/production/compose"
import { narrationCostEstimate, prepareNarration } from "../../src/production/narration"
import type { ExecutionResult, RunnerLogger } from "../../src/types"

const logger: RunnerLogger = { info() {}, warn() {}, error() {} }
const recipe = bindRecipe(recipeById("create-space-and-organize")!, { spaceName: "Design reviews" })
const root = mkdtempSync(join(tmpdir(), "vertov-production-"))
after(() => rmSync(root, { recursive: true, force: true }))

const probe = (path: string, entries: string, stream?: string) =>
  execFileSync("ffprobe", ["-v", "error", ...(stream ? ["-select_streams", stream] : []), "-show_entries", entries, "-of", "default=nw=1", path]).toString()

function makeWebm(path: string, seconds: number) {
  execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", `testsrc=size=1920x1080:rate=15:duration=${seconds}`, "-c:v", "libvpx", "-b:v", "1M", "-deadline", "realtime", "-cpu-used", "8", path])
}

describe("narration", () => {
  it("fixture mode gives every step silence the length of its estimate", async () => {
    const plan = await prepareNarration(recipe, { workdir: join(root, "narr"), presenter: false, logger })
    assert.equal(plan.synthesized, false)
    assert.equal(plan.steps.length, recipe.steps.length)
    for (const [i, step] of plan.steps.entries()) {
      assert.ok(Math.abs(step.seconds - estimateSeconds(step.text)) < 1e-9)
      const real = Number(probe(step.audioPath!, "format=duration").split("=")[1])
      assert.ok(Math.abs(real - step.seconds) < 0.05, `${recipe.steps[i].id}: ${real} vs ${step.seconds}`)
    }
    assert.ok(Math.abs(plan.wpm - 175) < 1, `wpm ${plan.wpm}`)
  })

  it("estimates the paid usage from the script", () => {
    const estimate = narrationCostEstimate(recipe)
    assert.equal(estimate.characters, recipe.steps.reduce((sum, s) => sum + s.narration.length, 0))
    assert.match(estimate.note, /characters/)
  })

  it("the ElevenLabs path refuses to run unconfirmed and makes no network call", async () => {
    const before = { mode: process.env.TUTORIAL_NARRATION, ok: process.env.TUTORIAL_NARRATION_CONFIRMED }
    const realFetch = globalThis.fetch
    let calls = 0
    globalThis.fetch = (async () => (calls++, new Response("{}"))) as typeof fetch
    process.env.TUTORIAL_NARRATION = "elevenlabs"
    delete process.env.TUTORIAL_NARRATION_CONFIRMED
    try {
      await assert.rejects(prepareNarration(recipe, { workdir: join(root, "eleven-no"), presenter: false, logger }), /Paid narration not confirmed/)
      assert.equal(calls, 0)
    } finally {
      globalThis.fetch = realFetch
      process.env.TUTORIAL_NARRATION = before.mode
      if (before.mode === undefined) delete process.env.TUTORIAL_NARRATION
      if (before.ok !== undefined) process.env.TUTORIAL_NARRATION_CONFIRMED = before.ok
    }
  })

  it("with confirmation it verifies the model and exact voice, pins them, paces to ~175 WPM and caches audio (mocked fetch)", async () => {
    const saved = { ...process.env }
    const realFetch = globalThis.fetch
    const seen: Array<{ url: string; body?: any }> = []
    const mp3 = join(root, "tone.mp3")
    // ~ words at 175 WPM would be seconds = words/175*60; synthesise by speed so the pacing loop has something to adjust.
    const makeAudio = (seconds: number) => {
      execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", `sine=frequency=220:duration=${seconds}`, "-c:a", "libmp3lame", mp3])
      return new Uint8Array(execFileSync("cat", [mp3]))
    }
    const twoSteps = { ...recipe, steps: recipe.steps.slice(0, 2) }
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      seen.push({ url, body })
      const headerKey = (init?.headers as Record<string, string>)["xi-api-key"]
      assert.equal(headerKey, "test-key")
      if (url.endsWith("/v1/models")) return Response.json([{ model_id: "eleven_multilingual_v2", can_do_text_to_speech: true }, { model_id: "eleven_v4", name: "Eleven v4", can_do_text_to_speech: true }])
      if (url.includes("/v2/voices")) return Response.json({ voices: [{ voice_id: "wrong", name: "Ankur DJI Old" }, { voice_id: "voice-1", name: "Ankur DJI" }] })
      const words = body.text.split(/\s+/).length
      // At speed 1 the voice is slow (140 WPM); at the adjusted speed it lands near 175.
      const wpm = 140 * (body.voice_settings.speed ?? 1)
      return new Response(makeAudio((words / wpm) * 60), { headers: { "content-type": "audio/mpeg" } })
    }) as typeof fetch
    Object.assign(process.env, { TUTORIAL_NARRATION: "elevenlabs", TUTORIAL_NARRATION_CONFIRMED: "1", ELEVENLABS_API_KEY: "test-key", TUTORIAL_PRESENTER_PROFILE: join(root, "none.json") })
    delete process.env.TUTORIAL_ELEVENLABS_MODEL
    try {
      const workdir = join(root, "eleven-yes")
      const plan = await prepareNarration(twoSteps, { workdir, presenter: false, logger })
      assert.equal(plan.synthesized, true)
      assert.equal(plan.voice, "Ankur DJI")
      const speech = seen.filter((c) => c.url.includes("/v1/text-to-speech/"))
      assert.ok(speech.every((c) => c.url.includes("/voice-1?")), "uses the exact-name voice")
      assert.ok(speech.every((c) => c.body.model_id === "eleven_v4"), "uses the model the account lists")
      assert.ok(speech.length <= twoSteps.steps.length * 2, "at most two attempts per step")
      assert.ok(plan.wpm > 165 && plan.wpm < 180, `wpm ${plan.wpm}`)
      const calls = seen.length
      await prepareNarration(twoSteps, { workdir, presenter: false, logger })
      assert.equal(seen.length, calls, "a re-run reuses the pin and the cached audio")
    } finally {
      globalThis.fetch = realFetch
      for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]
      Object.assign(process.env, saved)
    }
  })

  it("fails with the available ids when no v4 model is listed", async () => {
    const saved = { ...process.env }
    const realFetch = globalThis.fetch
    globalThis.fetch = (async (url: string) => {
      if (url.endsWith("/v1/models")) return Response.json([{ model_id: "eleven_multilingual_v2", can_do_text_to_speech: true }, { model_id: "scribe_v1", can_do_text_to_speech: false }])
      return Response.json({ voices: [{ voice_id: "voice-1", name: "Ankur DJI" }] })
    }) as typeof fetch
    Object.assign(process.env, { TUTORIAL_NARRATION: "elevenlabs", TUTORIAL_NARRATION_CONFIRMED: "1", ELEVENLABS_API_KEY: "test-key", TUTORIAL_PRESENTER_PROFILE: join(root, "none.json") })
    try {
      await assert.rejects(prepareNarration(recipe, { workdir: join(root, "eleven-nov4"), presenter: false, logger }), /Available TTS models: eleven_multilingual_v2/)
    } finally {
      globalThis.fetch = realFetch
      for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]
      Object.assign(process.env, saved)
    }
  })
})

describe("deriveZooms", () => {
  const click = (tMs: number, x = 0.5, y = 0.5) => ({ tMs, x, y })
  it("starts 0.4s early, lasts 2.4s, scale 1.6", () => {
    assert.deepEqual(deriveZooms([click(5000, 0.2, 0.7)]), [{ id: "zoom-0", start: 4.6, duration: 2.4, x: 0.2, y: 0.7, scale: 1.6 }])
  })
  it("never starts before zero", () => assert.equal(deriveZooms([click(100)])[0].start, 0))
  it("drops clicks closer than 3s to the previous zoom", () => {
    const zooms = deriveZooms([click(5000), click(6500), click(8000), click(8100)])
    assert.deepEqual(zooms.map((z) => z.start), [4.6, 7.6])
  })
  it("never overlaps and sorts unordered input", () => {
    const zooms = deriveZooms([click(20000), click(5000), click(10000)])
    for (let i = 1; i < zooms.length; i++) assert.ok(zooms[i].start >= zooms[i - 1].start + zooms[i - 1].duration)
    assert.deepEqual(zooms.map((z) => z.start), [4.6, 9.6, 19.6])
  })
  it("caps at twelve", () => assert.equal(deriveZooms(Array.from({ length: 40 }, (_, i) => click(5000 + i * 4000))).length, 12))
  it("clamps coordinates and ignores bad points, and stays inside the video", () => {
    const zooms = deriveZooms([click(5000, 1.4, -0.2), { tMs: Number.NaN, x: 0.5, y: 0.5 }, click(-10), click(9000)], 10)
    assert.equal(zooms.length, 1)
    assert.equal(zooms[0].x, 1)
    assert.equal(zooms[0].y, 0)
  })
})

describe("produce", () => {
  const seconds = 6
  const execution = (videoPath: string): ExecutionResult => ({
    videoPath,
    width: 1920,
    height: 1080,
    durationMs: seconds * 1000,
    steps: [
      { stepId: recipe.steps[0].id, startMs: 500, actionsEndMs: 1500, endMs: 2500, verified: true },
      { stepId: recipe.steps[1].id, startMs: 2500, actionsEndMs: 3500, endMs: 5500, verified: true },
    ],
    clicks: [{ tMs: 3000, x: 0.3, y: 0.4 }],
  })

  it("makes a 1920x1080 H.264 + AAC MP4 of the recorded length that decodes cleanly, with aligned cues", async () => {
    const dir = join(root, "produce")
    execFileSync("mkdir", ["-p", dir])
    const video = join(dir, "recording.webm")
    makeWebm(video, seconds)
    const plan = await prepareNarration(recipe, { workdir: dir, presenter: false, logger })
    const produced = await produce({ execution: execution(video), narration: plan, recipe, presenter: false, workdir: dir, logger })
    const v = probe(produced.path, "stream=codec_name,width,height,pix_fmt", "v:0")
    assert.match(v, /codec_name=h264/)
    assert.match(v, /width=1920/)
    assert.match(v, /height=1080/)
    assert.match(v, /pix_fmt=yuv420p/)
    assert.match(probe(produced.path, "stream=codec_name", "a:0"), /codec_name=aac/)
    assert.ok(Math.abs(produced.durationSeconds - seconds) < 0.3, `duration ${produced.durationSeconds}`)
    const decode = execFileSync("ffmpeg", ["-v", "error", "-i", produced.path, "-f", "null", "-"], { encoding: "utf8" })
    assert.equal(decode.trim(), "")
    assert.equal(produced.cues.length, 2)
    assert.equal(produced.cues[0].start, 0.2)
    assert.equal(produced.cues[1].start, 2.2)
    assert.ok(Math.abs(produced.cues[0].end - (0.2 + plan.steps[0].seconds)) < 0.01)
    assert.equal(produced.cues[0].text, plan.steps[0].text)
    assert.equal(produced.zooms.length, 1)
  })

  it("adds a still circular presenter when the portrait exists, and still works without it", async () => {
    const dir = join(root, "presenter")
    execFileSync("mkdir", ["-p", dir])
    const video = join(dir, "recording.webm")
    makeWebm(video, 3)
    const portrait = join(dir, "portrait.png")
    execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=red:s=400x500", "-frames:v", "1", portrait])
    const plan = await prepareNarration({ ...recipe, steps: recipe.steps.slice(0, 1) }, { workdir: dir, presenter: true, logger })
    const base = { ...execution(video), durationMs: 3000, steps: [execution(video).steps[0]] }
    const run = (path: string) => produce({ execution: base, narration: plan, recipe, presenter: true, workdir: join(dir, path), logger })
    process.env.TUTORIAL_PRESENTER_PORTRAIT = portrait
    const withPresenter = await run("with")
    // A pixel inside the circle (bottom-right) is red; the corner of its bounding square is not.
    const raw = execFileSync("ffmpeg", ["-v", "error", "-ss", "1", "-i", withPresenter.path, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 16 * 1024 * 1024 })
    const pixel = (x: number, y: number) => raw.subarray((y * 1920 + x) * 3, (y * 1920 + x) * 3 + 3).toString("hex")
    process.env.TUTORIAL_PRESENTER_PORTRAIT = join(dir, "missing.png")
    const warnings: Array<string> = []
    const without = await produce({ execution: base, narration: plan, recipe, presenter: true, workdir: join(dir, "without"), logger: { ...logger, warn: (m) => warnings.push(m) } })
    delete process.env.TUTORIAL_PRESENTER_PORTRAIT
    const plain = execFileSync("ffmpeg", ["-v", "error", "-ss", "1", "-i", without.path, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 16 * 1024 * 1024 })
    const plainPixel = (x: number, y: number) => plain.subarray((y * 1920 + x) * 3, (y * 1920 + x) * 3 + 3).toString("hex")
    const center = pixel(1920 - 32 - 128, 1080 - 32 - 128)
    assert.ok(parseInt(center.slice(0, 2), 16) > 0xe0 && parseInt(center.slice(2, 4), 16) < 0x20, "portrait visible inside the circle")
    assert.notEqual(center, plainPixel(1920 - 32 - 128, 1080 - 32 - 128))
    const corner = [1920 - 32 - 250, 1080 - 32 - 250] as const
    const near = (a: string, b: string) => [0, 2, 4].every((i) => Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)) < 32)
    assert.ok(near(pixel(...corner), plainPixel(...corner)), "the square's corner outside the circle shows the screen, not the portrait")
    assert.match(warnings.join(), /screen-only/)
    assert.ok(without.durationSeconds > 2.5)
  })
})
