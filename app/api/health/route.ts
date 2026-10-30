import { accessMode, secured, userCount } from '@/lib/plan/access'
import { storageProbe } from '@/lib/plan/store'

export const runtime = 'nodejs'
export const maxDuration = 60

type Check = { ok: boolean; ms: number; detail?: string; error?: string }

async function check(fn: () => Promise<string | undefined>): Promise<Check> {
  const t = Date.now()
  try {
    const detail = await fn()
    return { ok: true, ms: Date.now() - t, ...(detail ? { detail } : {}) }
  } catch (e) {
    return { ok: false, ms: Date.now() - t, error: (e as Error).message }
  }
}

// What a deploy needs to work, tried for real: the store round trip, the
// native image libraries, and a PDF of a sheet (which reads the fonts).
// Behind login: it says what is configured.
export const GET = secured(async (): Promise<Response> => {
  const render = {
    sharp: await check(async () => {
      const sharp = (await import('sharp')).default
      const m = await sharp({ create: { width: 4, height: 3, channels: 3, background: '#fff' } }).png().toBuffer()
      return `${m.length} byte`
    }),
    canvas: await check(async () => {
      const { createCanvas } = await import('@napi-rs/canvas')
      const c = createCanvas(8, 8)
      c.getContext('2d').fillRect(0, 0, 4, 4)
      return `${c.toBuffer('image/png').length} byte`
    }),
    resvg: await check(async () => {
      const { Resvg } = await import('@resvg/resvg-js')
      return `${new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="4" height="4"/></svg>').render().asPng().length} byte`
    }),
    pdf: await check(async () => {
      const { demoPlan } = await import('@/lib/plan/demo')
      const { sheetPdf, sheetPng } = await import('@/lib/plan/export')
      const pdf = await sheetPdf(demoPlan(), ['fore', 'efter'])
      if (pdf.subarray(0, 4).toString() !== '%PDF') throw new Error('inte en PDF')
      return `pdf ${pdf.length} byte, png ${sheetPng(demoPlan(), 'fore', 600).length} byte`
    }),
  }
  const storage = await storageProbe()
  const ok = storage.ok && Object.values(render).every((c) => c.ok)
  return Response.json(
    {
      ok,
      build: { sha: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null, env: process.env.VERCEL_ENV ?? 'lokal', region: process.env.VERCEL_REGION ?? null, node: process.version },
      auth: { mode: accessMode(), users: userCount() },
      storage,
      render,
    },
    { status: ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  )
})
