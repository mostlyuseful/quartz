import { FilePath } from "./path"

export const BUILD_STATE_VERSION = 1
export const BUILD_STATE_FILENAME = ".quartz-build-state.json"

export type SourceFingerprint = {
  mtimeMs: number
  size: number
}

export type EmittedFileState = {
  source: FilePath
  output: FilePath
}

export type BuildState = {
  version: number
  generatedAt: string
  metadata: {
    quartzVersion?: string
    configHash: string
    pluginHash: string
  }
  sources: Record<FilePath, SourceFingerprint>
  outputsBySource: Record<FilePath, FilePath[]>
}
