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
  const totalEmitters = cfg.plugins.emitters.length
  let completedEmitters = 0
  log.updateProgress(completedEmitters, totalEmitters)

  await Promise.all(
    cfg.plugins.emitters.map(async (emitter) => {
      try {
        const shouldUsePartial =
          ctx.incremental && incrementalEmitters.has(emitter.name) && emitter.partialEmit

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
            if (ctx.argv.verbose) {
              console.log(`[emit:${emitter.name}] ${file}`)
            } else {
              log.updateText(`${emitter.name} -> ${styleText("gray", file)}`)
            }
          }
        } else {
          // Array case
          emittedFiles += emitted.length
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
        completedEmitters++
        log.updateProgress(completedEmitters, totalEmitters)
      }
    }),
  )

  log.end(`Emitted ${emittedFiles} files to \`${argv.output}\` in ${perf.timeSince()}`)
}
