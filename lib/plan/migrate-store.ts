import type { Backend } from './store'

// Copies a store into another (Blob into Turso), a page at a time so a function that may run for a minute
// can do it in several calls. Every key is read from the source and written to the target, overwriting
// what is there, so running it again is harmless and picks up what changed since. Nothing is removed
// from the source.

export type Source = {
  page(cursor?: string, limit?: number): Promise<{ keys: string[]; cursor?: string }>
  read(key: string): Promise<Buffer | null>
}

export type CopyProgress = { copied: number; missing: string[]; bytes: number; cursor?: string; done: boolean }

const type = (k: string) => (k.endsWith('.json') ? 'application/json' : k.endsWith('.png') ? 'image/png' : /\.jpe?g$/.test(k) ? 'image/jpeg' : 'application/octet-stream')

export async function copyPages(source: Source, target: Backend, opts: { cursor?: string; budgetMs?: number; limit?: number } = {}): Promise<CopyProgress> {
  const t0 = Date.now()
  const out: CopyProgress = { copied: 0, missing: [], bytes: 0, cursor: opts.cursor, done: false }
  do {
    const page = await source.page(out.cursor, opts.limit ?? 100)
    for (let i = 0; i < page.keys.length; i += 6) {
      await Promise.all(
        page.keys.slice(i, i + 6).map(async (k) => {
          const data = await source.read(k)
          if (!data) return void out.missing.push(k)
          await target.write(k, data, type(k))
          out.copied++
          out.bytes += data.length
        }),
      )
    }
    out.cursor = page.cursor
    if (!page.cursor) out.done = true
  } while (!out.done && Date.now() - t0 < (opts.budgetMs ?? 40_000))
  return out
}
