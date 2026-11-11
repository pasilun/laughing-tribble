import { sourceIdOf } from '../../assist/audit'
import { wallQuad } from '../../domain/geometry'
import type { Plan, View } from '../../domain/types'
import { preview } from '../../mcp/format'
import { resolveSource } from '../../scan/raster'
import { scanView } from '../../scan/view'
import { PLANS } from '../../storage/docs'
import { loadPlan } from '../../service'
import { answer } from '../answer'
import { badArgument, notFound } from '../findings'
import { SHEETS, VIEWS } from '../registries'
import { toToolResult, type ImageBlock, type ToolResult } from '../result'
import { finding } from '../answer'
import type { Finding } from '../types'
import type { Args } from './index'

type Rect = { x: number; y: number; w: number; h: number }
const fail = (findings: Finding[]) => toToolResult(answer({ ok: false, findings }), { summary: findings[0].message })

// The rectangle of an element, in plan mm, padded 500 mm: a wall, an opening (its wall) or a room (its label point).
function elementRect(plan: Plan, id: string): Rect | null {
  const pad = 500
  const around = (pts: Array<{ x: number; y: number }>): Rect => {
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y)
    const x = Math.min(...xs) - pad, y = Math.min(...ys) - pad
    return { x, y, w: Math.max(...xs) - Math.min(...xs) + 2 * pad, h: Math.max(...ys) - Math.min(...ys) + 2 * pad }
  }
  const w = plan.walls.find((x) => x.id === id)
  if (w) return around(wallQuad(w))
  const o = plan.openings.find((x) => x.id === id)
  const ow = o && plan.walls.find((x) => x.id === o.wallId)
  if (ow) return around(wallQuad(ow))
  const r = plan.rooms.find((x) => x.id === id)
  if (r) return around(r.polygon?.length ? r.polygon : [r.at])
  return null
}

// Width and height of a PNG, from its IHDR chunk.
const sizeOf = (png: Buffer): [number, number] => [png.readUInt32BE(16), png.readUInt32BE(20)]

export async function view(args: Args): Promise<ToolResult> {
  const id = args.id
  if (id === undefined || id === '') return fail([badArgument('id', 'krävs')])
  if (typeof id !== 'string') return fail([badArgument('id', 'ska vara en sträng')])
  if (!PLANS.id.test(id)) return fail([badArgument('id', 'ogiltigt id')])
  if (args.view !== undefined && typeof args.view !== 'string') return fail([badArgument('view', 'ska vara en sträng')])
  if (args.region !== undefined && (typeof args.region !== 'object' || args.region === null)) return fail([badArgument('region', 'ska vara ett objekt')])
  if (args.options !== undefined && (typeof args.options !== 'object' || args.options === null || Array.isArray(args.options))) return fail([badArgument('options', 'ska vara ett objekt')])
  if (args.max_tokens !== undefined && (typeof args.max_tokens !== 'number' || !Number.isInteger(args.max_tokens) || args.max_tokens < 1)) return fail([badArgument('max_tokens', 'ska vara ett positivt heltal')])
  const which = VIEWS.resolve((args.view as string | undefined) ?? 'sheet')
  if ('finding' in which) return fail([which.finding])
  const options = (args.options ?? {}) as Record<string, unknown>
  const sheet = SHEETS.resolve(typeof options.sheet === 'string' ? options.sheet : 'efter')
  if ('finding' in sheet) return fail([sheet.finding])
  if (sheet.entry.name === 'both') return fail([badArgument('options.sheet', 'both gäller bara export')])
  const sheetView = sheet.entry.name as View
  const rev = await loadPlan(id)
  if (!rev) return fail([notFound(id)])
  const plan = rev.plan
  const name = which.entry.name
  const done = (image: ImageBlock, summary: string, data?: Record<string, unknown>) => toToolResult(answer({ ok: true, id, revision: rev.meta.n, ...(data ? { data } : {}) }), { summary, images: [image] })
  if (name === 'sheet') {
    if (args.region !== undefined) return fail([badArgument('region', 'gäller bara vyerna overlay och source')])
    const img = await preview(plan, sheetView, false)
    return done(img, `Revision ${rev.meta.n}`, { image: { size_px: sizeOf(Buffer.from(img.data, 'base64')) } })
  }
  if (name !== 'overlay' && name !== 'source') return fail([finding({ code: 'not-implemented', level: 'error', message: `Vyn ${name} är inte klar än.` })])
  const sid = sourceIdOf(plan, typeof options.source === 'string' ? options.source : undefined)
  if (!sid) {
    const f = finding({ code: 'no-source', level: 'error', message: 'Planen har ingen källritning att visa.' })
    return toToolResult(answer({ ok: false, id, revision: rev.meta.n, findings: [f], next: [{ tool: 'source', arguments: { id, action: 'upload_link' }, why: 'Be användaren ladda upp ritningen.' }] }), { summary: f.message })
  }
  let raster
  try { raster = resolveSource(plan, sid) } catch (e) { return fail([badArgument('options', (e as Error).message)]) }
  let rect: Rect = { x: raster.x, y: raster.y, w: raster.widthPx * raster.mmPerPx, h: raster.heightPx * raster.mmPerPx }
  const region = args.region as { id?: unknown; rect_mm?: unknown } | undefined
  if (region) {
    if (typeof region.id === 'string') {
      const r = elementRect(plan, region.id)
      if (!r) return fail([finding({ code: 'unknown-element', level: 'error', refs: [region.id], message: `Elementet ${region.id} finns inte.` })])
      rect = r
    } else if (Array.isArray(region.rect_mm) && region.rect_mm.length === 4 && region.rect_mm.every((n) => typeof n === 'number') && (region.rect_mm[2] as number) > 0 && (region.rect_mm[3] as number) > 0) {
      const [x, y, w, h] = region.rect_mm as number[]
      rect = { x, y, w, h }
    } else return fail([badArgument('region', 'ge id eller rect_mm ([x, y, w, h] i mm)')])
  }
  try {
    const v = await scanView(id, plan, raster, rect, { overlay: name === 'overlay', view: sheetView, maxPx: Math.min(2576, Math.max(100, Math.round(28 * Math.sqrt((args.max_tokens as number | undefined) ?? 1600)))) })
    const img: ImageBlock = { type: 'image', data: v.png.toString('base64'), mimeType: 'image/png' }
    return done(img, `Revision ${rev.meta.n}, ${name === 'overlay' ? 'planen över ritningen' : 'ritningen'}; rutnätet är i mm.`, { rect_mm: [rect.x, rect.y, rect.w, rect.h], source: sid, image: { size_px: sizeOf(v.png), mm_per_px: Math.round((1 / v.scale) * 10000) / 10000, origin_mm: [rect.x, rect.y] } })
  } catch (e) {
    return fail([badArgument('region', (e as Error).message)])
  }
}
