import assert from "node:assert"
import test, { describe } from "node:test"
import {
  BUILD_STATE_VERSION,
  deriveBuildPlan,
  loadBuildState,
  saveBuildState,
  type BuildState,
} from "./buildState"
import { FilePath } from "./path"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

describe("buildState", () => {
  test("deriveBuildPlan marks all files as added when no previous state exists", () => {
    const a = "notes/a.md" as FilePath
    const b = "notes/b.md" as FilePath

    const plan = deriveBuildPlan(null, {
      [a]: { mtimeMs: 1, size: 100 },
      [b]: { mtimeMs: 2, size: 200 },
    })

    assert.deepStrictEqual(plan.added.sort(), [a, b])
    assert.deepStrictEqual(plan.changed, [])
    assert.deepStrictEqual(plan.unchanged, [])
    assert.deepStrictEqual(plan.deleted, [])
  })

  test("deriveBuildPlan identifies added/changed/unchanged/deleted", () => {
    const a = "notes/a.md" as FilePath
    const b = "notes/b.md" as FilePath
    const c = "notes/c.md" as FilePath

    const previous: BuildState = {
      version: BUILD_STATE_VERSION,
      generatedAt: new Date().toISOString(),
      metadata: {
        configHash: "cfg",
        pluginHash: "plugins",
      },
      sources: {
        [a]: { mtimeMs: 1, size: 100 },
        [b]: { mtimeMs: 2, size: 200 },
      },
      outputsBySource: {},
    }

    const plan = deriveBuildPlan(previous, {
      [a]: { mtimeMs: 1, size: 100 },
      [b]: { mtimeMs: 3, size: 200 },
      [c]: { mtimeMs: 4, size: 300 },
    })

    assert.deepStrictEqual(plan.added, [c])
    assert.deepStrictEqual(plan.changed, [b])
    assert.deepStrictEqual(plan.unchanged, [a])
    assert.deepStrictEqual(plan.deleted, [])
  })

  test("saveBuildState/loadBuildState round trip", async () => {
    const dir = await mkdtemp(join(tmpdir(), "quartz-build-state-"))
    const a = "notes/a.md" as FilePath
    const output = "public/notes/a.html" as FilePath

    const state: BuildState = {
      version: BUILD_STATE_VERSION,
      generatedAt: new Date().toISOString(),
      metadata: {
        configHash: "cfg",
        pluginHash: "plugins",
      },
      sources: {
        [a]: { mtimeMs: 10, size: 400 },
      },
      outputsBySource: {
        [a]: [output],
      },
      ogFingerprints: {
        [a]: "fingerprint",
      },
    }

    try {
      await saveBuildState(dir, state)
      const loaded = await loadBuildState(dir)
      assert.deepStrictEqual(loaded, state)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
