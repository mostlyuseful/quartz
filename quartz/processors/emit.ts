import { PerfTimer } from "../util/perf"
import { getStaticResourcesFromPlugins } from "../plugins"
import { ProcessedContent } from "../plugins/vfile"
import { QuartzLogger } from "../util/log"
import { trace } from "../util/trace"
import { BuildCtx } from "../util/ctx"
import { styleText } from "util"
import { ChangeEvent } from "../plugins/types"

const incrementalEmitters = new Set([
  "ContentPage",
  "FolderPage",
  "TagPage",
  "AliasRedirects",
  "CustomOgImages",
])

export async function emitContent(
  ctx: BuildCtx,
  content: ProcessedContent[],
  changeEvents: ChangeEvent[] = [],
) {
  const { argv, cfg } = ctx
  const perf = new PerfTimer()
  const log = new QuartzLogger(ctx.argv.verbose)

  log.start(`Emitting files`)

  let emittedFiles = 0
  const staticResources = getStaticResourcesFromPlugins(ctx)
  const emitterRuns = await Promise.all(
    cfg.plugins.emitters.map(async (emitter) => {
      const shouldUsePartial =
        ctx.incremental && incrementalEmitters.has(emitter.name) && emitter.partialEmit
      const predictableTotal = emitter.estimateEmittedFiles
        ? await emitter.estimateEmittedFiles(ctx, content, staticResources, changeEvents)
        : null

      return {
        emitter,
        shouldUsePartial,
        predictableTotal: predictableTotal === null ? null : Math.max(0, predictableTotal),
      }
    }),
  )

  const predictableWorkTotal = emitterRuns.reduce(
    (sum, run) => sum + (run.predictableTotal ?? 0),
    0,
  )
  let predictableWorkDone = 0

  if (predictableWorkTotal > 0) {
    log.updateProgress(predictableWorkDone, predictableWorkTotal)
  }

  await Promise.all(
    emitterRuns.map(async ({ emitter, shouldUsePartial, predictableTotal }) => {
      let predictableSeen = 0

      const markPredictable = (delta: number) => {
        if (predictableTotal === null || predictableWorkTotal === 0) {
          return
        }

        predictableSeen += delta
        predictableWorkDone = Math.min(predictableWorkTotal, predictableWorkDone + delta)
        log.updateProgress(predictableWorkDone, predictableWorkTotal)
      }

      try {
        const emitted = shouldUsePartial
          ? await emitter.partialEmit!(ctx, content, staticResources, changeEvents)
          : await emitter.emit(ctx, content, staticResources)

        if (emitted === null) {
          return
        }

        if (Symbol.asyncIterator in emitted) {
          // Async generator case
          for await (const file of emitted) {
            emittedFiles++
            markPredictable(1)
            if (ctx.argv.verbose) {
              console.log(`[emit:${emitter.name}] ${file}`)
            } else {
              log.updateText(`${emitter.name} -> ${styleText("gray", file)}`)
            }
          }
        } else {
          // Array case
          emittedFiles += emitted.length
          markPredictable(emitted.length)
          for (const file of emitted) {
            if (ctx.argv.verbose) {
              console.log(`[emit:${emitter.name}] ${file}`)
            } else {
              log.updateText(`${emitter.name} -> ${styleText("gray", file)}`)
            }
          }
        }
      } catch (err) {
        trace(`Failed to emit from plugin \`${emitter.name}\``, err as Error)
      } finally {
        if (predictableTotal !== null && predictableSeen < predictableTotal) {
          markPredictable(predictableTotal - predictableSeen)
        }
      }
    }),
  )

  log.end(`Emitted ${emittedFiles} files to \`${argv.output}\` in ${perf.timeSince()}`)
}
