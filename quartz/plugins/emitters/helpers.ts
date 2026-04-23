import path from "path"
import fs from "fs"
import { BuildCtx } from "../../util/ctx"
import { FilePath, FullSlug, joinSegments } from "../../util/path"
import { Readable } from "stream"

type WriteOptions = {
  ctx: BuildCtx
  slug: FullSlug
  ext: `.${string}` | ""
  content: string | Buffer | Readable
  source?: FilePath
}

export const write = async ({
  ctx,
  slug,
  ext,
  content,
  source,
}: WriteOptions): Promise<FilePath> => {
  const pathToPage = joinSegments(ctx.argv.output, slug + ext) as FilePath
  const dir = path.dirname(pathToPage)
  await fs.promises.mkdir(dir, { recursive: true })
  await fs.promises.writeFile(pathToPage, content)

  if (source) {
    const knownOutputs = ctx.outputsBySource?.[source] ?? []
    if (!knownOutputs.includes(pathToPage)) {
      ctx.outputsBySource ??= {}
      ctx.outputsBySource[source] = [...knownOutputs, pathToPage]
    }
  }

  return pathToPage
}
