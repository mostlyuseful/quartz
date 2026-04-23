import fs from "node:fs/promises"
import { createHash } from "node:crypto"
import { FilePath, joinSegments } from "./path"

export const BUILD_STATE_VERSION = 1
export const BUILD_STATE_FILENAME = ".quartz-build-state.json"

export type SourceFingerprint = {
  mtimeMs: number
  size: number
}

export type BuildMetadata = {
  quartzVersion?: string
  configHash: string
  pluginHash: string
}

export type BuildPlan = {
  added: FilePath[]
  changed: FilePath[]
  unchanged: FilePath[]
  deleted: FilePath[]
}

export type BuildState = {
  version: number
  generatedAt: string
  metadata: BuildMetadata
  sources: Record<FilePath, SourceFingerprint>
  outputsBySource: Record<FilePath, FilePath[]>
  ogFingerprints?: Record<FilePath, string>
}

function stableReplacer(_key: string, value: unknown) {
  if (typeof value === "function") {
    return `[Function:${value.name || "anonymous"}]`
  }

  if (typeof value === "bigint") {
    return value.toString()
  }

  return value
}

export function hashObject(value: unknown): string {
  const text = JSON.stringify(value, stableReplacer)
  return createHash("sha256").update(text).digest("hex")
}

export function deriveBuildPlan(
  previous: BuildState | null,
  current: Record<FilePath, SourceFingerprint>,
): BuildPlan {
  if (!previous) {
    const all = Object.keys(current) as FilePath[]
    return {
      added: all,
      changed: [],
      unchanged: [],
      deleted: [],
    }
  }

  const added: FilePath[] = []
  const changed: FilePath[] = []
  const unchanged: FilePath[] = []
  const deleted: FilePath[] = []

  const prevSources = previous.sources

  for (const [fp, fingerprint] of Object.entries(current) as [FilePath, SourceFingerprint][]) {
    const previousFingerprint = prevSources[fp]
    if (!previousFingerprint) {
      added.push(fp)
      continue
    }

    const isUnchanged =
      previousFingerprint.mtimeMs === fingerprint.mtimeMs &&
      previousFingerprint.size === fingerprint.size

    if (isUnchanged) {
      unchanged.push(fp)
    } else {
      changed.push(fp)
    }
  }

  for (const fp of Object.keys(prevSources) as FilePath[]) {
    if (!(fp in current)) {
      deleted.push(fp)
    }
  }

  return { added, changed, unchanged, deleted }
}

export async function loadBuildState(outputDir: string): Promise<BuildState | null> {
  try {
    const statePath = joinSegments(outputDir, BUILD_STATE_FILENAME)
    const raw = await fs.readFile(statePath, "utf-8")
    const parsed = JSON.parse(raw) as BuildState
    if (parsed.version !== BUILD_STATE_VERSION) {
      return null
    }

    return parsed
  } catch {
    return null
  }
}

export async function saveBuildState(outputDir: string, state: BuildState): Promise<void> {
  const statePath = joinSegments(outputDir, BUILD_STATE_FILENAME)
  await fs.mkdir(outputDir, { recursive: true })
  await fs.writeFile(statePath, JSON.stringify(state, null, 2))
}
