import sourceMapSupport from "source-map-support"
sourceMapSupport.install(options)
import path from "path"
import { PerfTimer } from "./util/perf"
import { rm, stat } from "fs/promises"
import { GlobbyFilterFunction, isGitIgnored } from "globby"
import { styleText } from "util"
import { parseMarkdown } from "./processors/parse"
import { filterContent } from "./processors/filter"
import { emitContent } from "./processors/emit"
import cfg from "../quartz.config"
import { FilePath, joinSegments, slugifyFilePath } from "./util/path"
import chokidar from "chokidar"
import { ProcessedContent } from "./plugins/vfile"
import { Argv, BuildCtx } from "./util/ctx"
import { glob, toPosixPath } from "./util/glob"
import { trace } from "./util/trace"
import { options } from "./util/sourcemap"
import { Mutex } from "async-mutex"
import { getStaticResourcesFromPlugins } from "./plugins"
import { randomIdNonSecure } from "./util/random"
import { ChangeEvent } from "./plugins/types"
import { minimatch } from "minimatch"
import {
  BUILD_STATE_VERSION,
  deriveBuildPlan,
  hashObject,
  loadBuildState,
  saveBuildState,
  SourceFingerprint,
} from "./util/buildState"

type ContentMap = Map<
  FilePath,
  | {
      type: "markdown"
      content: ProcessedContent
    }
  | {
      type: "other"
    }
>

type BuildData = {
  ctx: BuildCtx
  ignored: GlobbyFilterFunction
  mut: Mutex
  contentMap: ContentMap
  changesSinceLastBuild: Record<FilePath, ChangeEvent["type"]>
  lastBuildMs: number
}

function getBuildMetadata() {
  return {
    configHash: hashObject(cfg.configuration),
    pluginHash: hashObject({
      transformers: cfg.plugins.transformers.map((plugin) => plugin.name),
      filters: cfg.plugins.filters.map((plugin) => plugin.name),
      emitters: cfg.plugins.emitters.map((plugin) => plugin.name),
    }),
  }
}

async function buildQuartz(argv: Argv, mut: Mutex, clientRefresh: () => void) {
  const ctx: BuildCtx = {
    buildId: randomIdNonSecure(),
    argv,
    cfg,
    allSlugs: [],
    allFiles: [],
    incremental: !argv.fullRebuild,
    previousBuildState: null,
  }

  const perf = new PerfTimer()
  const output = argv.output

  const pluginCount = Object.values(cfg.plugins).flat().length
  const pluginNames = (key: "transformers" | "filters" | "emitters") =>
    cfg.plugins[key].map((plugin) => plugin.name)
  if (argv.verbose) {
    console.log(`Loaded ${pluginCount} plugins`)
    console.log(`  Transformers: ${pluginNames("transformers").join(", ")}`)
    console.log(`  Filters: ${pluginNames("filters").join(", ")}`)
    console.log(`  Emitters: ${pluginNames("emitters").join(", ")}`)
  }

  const release = await mut.acquire()
  const previousState = argv.fullRebuild ? null : await loadBuildState(output)
  ctx.previousBuildState = previousState

  const currentMetadata = getBuildMetadata()
  const metadataMismatch =
    previousState !== null &&
    (previousState.metadata.configHash !== currentMetadata.configHash ||
      previousState.metadata.pluginHash !== currentMetadata.pluginHash)

  const shouldFullRebuild = argv.fullRebuild || metadataMismatch
  const activePreviousState = shouldFullRebuild ? null : previousState
  ctx.incremental = !shouldFullRebuild

  if (metadataMismatch) {
    console.log(
      styleText(
        "yellow",
        "Build config or plugin set changed since last run. Forcing full rebuild.",
      ),
    )
  }

  if (shouldFullRebuild) {
    perf.addEvent("clean")
    await rm(output, { recursive: true, force: true })
    console.log(`Cleaned output directory \`${output}\` in ${perf.timeSince("clean")}`)
  }

  perf.addEvent("glob")
  const allFiles = await glob("**/*.*", argv.directory, cfg.configuration.ignorePatterns)
  const markdownPaths = allFiles.filter((fp) => fp.endsWith(".md")).sort()
  const fingerprintsEntries = await Promise.all(
    allFiles.map(async (fp) => {
      const fullPath = joinSegments(argv.directory, fp) as FilePath
      const fpStat = await stat(fullPath)
      return [
        fp as FilePath,
        { mtimeMs: fpStat.mtimeMs, size: fpStat.size } satisfies SourceFingerprint,
      ]
    }),
  )
  const sourceFingerprints = Object.fromEntries(fingerprintsEntries) as Record<
    FilePath,
    SourceFingerprint
  >

  const buildPlan = deriveBuildPlan(activePreviousState, sourceFingerprints)
  ctx.buildPlan = buildPlan

  if (!shouldFullRebuild && activePreviousState) {
    const staleOutputs = new Set<FilePath>()

    for (const sourcePath of buildPlan.deleted) {
      for (const outputPath of activePreviousState.outputsBySource[sourcePath] ?? []) {
        staleOutputs.add(outputPath)
      }
    }

    for (const sourcePath of buildPlan.changed) {
      for (const outputPath of activePreviousState.outputsBySource[sourcePath] ?? []) {
        if (outputPath.endsWith("-og-image.webp")) {
          continue
        }

        staleOutputs.add(outputPath)
      }
    }

    for (const outputPath of staleOutputs) {
      await rm(outputPath, { force: true })
    }
  }

  console.log(
    `Found ${markdownPaths.length} input files from \`${argv.directory}\` in ${perf.timeSince("glob")}`,
  )

  if (!argv.fullRebuild) {
    console.log(
      `Incremental plan: +${buildPlan.added.length} ~${buildPlan.changed.length} -${buildPlan.deleted.length} =${buildPlan.unchanged.length}`,
    )
  }

  const filePaths = markdownPaths.map((fp) => joinSegments(argv.directory, fp) as FilePath)
  ctx.allFiles = allFiles
  ctx.allSlugs = allFiles.map((fp) => slugifyFilePath(fp as FilePath))

  const parsedFiles = await parseMarkdown(ctx, filePaths)
  const filteredContent = filterContent(ctx, parsedFiles)

  const filesByRelativePath = new Map<FilePath, ProcessedContent>()
  for (const processed of filteredContent) {
    const relativePath = processed[1].data.relativePath
    if (relativePath) {
      filesByRelativePath.set(relativePath, processed)
    }
  }

  ctx.outputsBySource = {}
  ctx.ogFingerprints = { ...(activePreviousState?.ogFingerprints ?? {}) }
  for (const changedPath of [...buildPlan.added, ...buildPlan.changed]) {
    if (changedPath.endsWith(".md")) {
      ctx.outputsBySource[changedPath] = []
    }
  }

  const changeEvents: ChangeEvent[] = [
    ...buildPlan.added.map((path) => ({
      type: "add" as const,
      path,
      file: filesByRelativePath.get(path)?.[1],
    })),
    ...buildPlan.changed.map((path) => ({
      type: "change" as const,
      path,
      file: filesByRelativePath.get(path)?.[1],
    })),
    ...buildPlan.deleted.map((path) => ({
      type: "delete" as const,
      path,
    })),
  ]

  const deletedMarkdown = buildPlan.deleted.filter((path) => path.endsWith(".md"))
  if (ctx.incremental && deletedMarkdown.length > 0) {
    console.log(
      styleText(
        "yellow",
        `Detected ${deletedMarkdown.length} deleted markdown files. Conservatively marking all current markdown pages for rebuild to avoid stale link/backlink state.`,
      ),
    )

    const existingChanged = new Set(
      changeEvents
        .filter((event) => event.type !== "delete")
        .map((event) => event.path)
        .filter((path) => path.endsWith(".md")),
    )

    for (const [relativePath, processedContent] of filesByRelativePath.entries()) {
      if (existingChanged.has(relativePath)) continue
      changeEvents.push({
        type: "change",
        path: relativePath,
        file: processedContent[1],
      })
    }
  }

  await emitContent(ctx, filteredContent, changeEvents)
  const { configHash, pluginHash } = currentMetadata

  const outputsBySource = { ...(activePreviousState?.outputsBySource ?? {}) }
  for (const sourcePath of buildPlan.deleted) {
    delete outputsBySource[sourcePath]
    delete ctx.ogFingerprints[sourcePath]
  }

  for (const [sourcePath, emittedOutputs] of Object.entries(ctx.outputsBySource)) {
    outputsBySource[sourcePath as FilePath] = emittedOutputs
  }

  for (const sourcePath of buildPlan.changed) {
    if (!ctx.outputsBySource[sourcePath] && sourcePath.endsWith(".md")) {
      delete ctx.ogFingerprints[sourcePath]
    }
  }

  await saveBuildState(output, {
    version: BUILD_STATE_VERSION,
    generatedAt: new Date().toISOString(),
    metadata: {
      configHash,
      pluginHash,
    },
    sources: sourceFingerprints,
    outputsBySource,
    ogFingerprints: ctx.ogFingerprints,
  })

  console.log(
    styleText("green", `Done processing ${markdownPaths.length} files in ${perf.timeSince()}`),
  )
  release()

  if (argv.watch) {
    ctx.incremental = true
    return startWatching(ctx, mut, parsedFiles, clientRefresh)
  }
}

// setup watcher for rebuilds
async function startWatching(
  ctx: BuildCtx,
  mut: Mutex,
  initialContent: ProcessedContent[],
  clientRefresh: () => void,
) {
  const { argv, allFiles } = ctx

  const contentMap: ContentMap = new Map()
  for (const filePath of allFiles) {
    contentMap.set(filePath, {
      type: "other",
    })
  }

  for (const content of initialContent) {
    const [_tree, vfile] = content
    contentMap.set(vfile.data.relativePath!, {
      type: "markdown",
      content,
    })
  }

  const gitIgnoredMatcher = await isGitIgnored()
  const buildData: BuildData = {
    ctx,
    mut,
    contentMap,
    ignored: (fp) => {
      const pathStr = toPosixPath(fp.toString())
      if (pathStr.startsWith(".git/")) return true
      if (gitIgnoredMatcher(pathStr)) return true
      for (const pattern of cfg.configuration.ignorePatterns) {
        if (minimatch(pathStr, pattern)) {
          return true
        }
      }

      return false
    },

    changesSinceLastBuild: {},
    lastBuildMs: 0,
  }

  const watcher = chokidar.watch(".", {
    awaitWriteFinish: { stabilityThreshold: 250 },
    persistent: true,
    cwd: argv.directory,
    ignoreInitial: true,
  })

  const changes: ChangeEvent[] = []
  watcher
    .on("add", (fp) => {
      fp = toPosixPath(fp)
      if (buildData.ignored(fp)) return
      changes.push({ path: fp as FilePath, type: "add" })
      void rebuild(changes, clientRefresh, buildData)
    })
    .on("change", (fp) => {
      fp = toPosixPath(fp)
      if (buildData.ignored(fp)) return
      changes.push({ path: fp as FilePath, type: "change" })
      void rebuild(changes, clientRefresh, buildData)
    })
    .on("unlink", (fp) => {
      fp = toPosixPath(fp)
      if (buildData.ignored(fp)) return
      changes.push({ path: fp as FilePath, type: "delete" })
      void rebuild(changes, clientRefresh, buildData)
    })

  return async () => {
    await watcher.close()
  }
}

async function rebuild(changes: ChangeEvent[], clientRefresh: () => void, buildData: BuildData) {
  const { ctx, contentMap, mut, changesSinceLastBuild } = buildData
  const { argv, cfg } = ctx

  const buildId = randomIdNonSecure()
  ctx.buildId = buildId
  buildData.lastBuildMs = new Date().getTime()
  const numChangesInBuild = changes.length
  const release = await mut.acquire()

  // if there's another build after us, release and let them do it
  if (ctx.buildId !== buildId) {
    release()
    return
  }

  const perf = new PerfTimer()
  perf.addEvent("rebuild")
  console.log(styleText("yellow", "Detected change, rebuilding..."))

  // update changesSinceLastBuild
  for (const change of changes) {
    changesSinceLastBuild[change.path] = change.type
  }

  const staticResources = getStaticResourcesFromPlugins(ctx)
  const pathsToParse: FilePath[] = []
  for (const [fp, type] of Object.entries(changesSinceLastBuild)) {
    if (type === "delete" || path.extname(fp) !== ".md") continue
    const fullPath = joinSegments(argv.directory, toPosixPath(fp)) as FilePath
    pathsToParse.push(fullPath)
  }

  const parsed = await parseMarkdown(ctx, pathsToParse)
  for (const content of parsed) {
    contentMap.set(content[1].data.relativePath!, {
      type: "markdown",
      content,
    })
  }

  // update state using changesSinceLastBuild
  // we do this weird play of add => compute change events => remove
  // so that partialEmitters can do appropriate cleanup based on the content of deleted files
  for (const [file, change] of Object.entries(changesSinceLastBuild)) {
    if (change === "delete") {
      // universal delete case
      contentMap.delete(file as FilePath)
    }

    // manually track non-markdown files as processed files only
    // contains markdown files
    if (change === "add" && path.extname(file) !== ".md") {
      contentMap.set(file as FilePath, {
        type: "other",
      })
    }
  }

  const changeEvents: ChangeEvent[] = Object.entries(changesSinceLastBuild).map(([fp, type]) => {
    const path = fp as FilePath
    const processedContent = contentMap.get(path)
    if (processedContent?.type === "markdown") {
      const [_tree, file] = processedContent.content
      return {
        type,
        path,
        file,
      }
    }

    return {
      type,
      path,
    }
  })

  // update allFiles and then allSlugs with the consistent view of content map
  ctx.allFiles = Array.from(contentMap.keys())
  ctx.allSlugs = ctx.allFiles.map((fp) => slugifyFilePath(fp as FilePath))
  let processedFiles = filterContent(
    ctx,
    Array.from(contentMap.values())
      .filter((file) => file.type === "markdown")
      .map((file) => file.content),
  )

  let emittedFiles = 0
  for (const emitter of cfg.plugins.emitters) {
    // Try to use partialEmit if available, otherwise assume the output is static
    const emitFn = emitter.partialEmit ?? emitter.emit
    const emitted = await emitFn(ctx, processedFiles, staticResources, changeEvents)
    if (emitted === null) {
      continue
    }

    if (Symbol.asyncIterator in emitted) {
      // Async generator case
      for await (const file of emitted) {
        emittedFiles++
        if (ctx.argv.verbose) {
          console.log(`[emit:${emitter.name}] ${file}`)
        }
      }
    } else {
      // Array case
      emittedFiles += emitted.length
      if (ctx.argv.verbose) {
        for (const file of emitted) {
          console.log(`[emit:${emitter.name}] ${file}`)
        }
      }
    }
  }

  console.log(`Emitted ${emittedFiles} files to \`${argv.output}\` in ${perf.timeSince("rebuild")}`)
  console.log(styleText("green", `Done rebuilding in ${perf.timeSince()}`))
  changes.splice(0, numChangesInBuild)
  clientRefresh()
  release()
}

export default async (argv: Argv, mut: Mutex, clientRefresh: () => void) => {
  try {
    return await buildQuartz(argv, mut, clientRefresh)
  } catch (err) {
    trace("\nExiting Quartz due to a fatal error", err as Error)
  }
}
