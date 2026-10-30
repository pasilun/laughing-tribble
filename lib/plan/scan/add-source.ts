import { editPlan, loadPlan } from '../service'
import { putAsset } from '../store'
import type { Plan, Source } from '../types'
import { convertToPng, mmPerPxFor } from './raster'

// A drawing (TIF, PDF, PNG, JPG) becomes a source of the plan: converted to PNG,
// placed in plan mm from its scale and resolution, saved as a revision. Used by
// the plan_source_add tool (the bytes as base64) and by the upload route and page
// (the bytes straight from the browser).

export type SourceInput = {
  id: string
  name?: string
  role?: string
  filename: string
  scale?: number
  dpi?: number
  mm_per_px?: number
  x?: number
  y?: number
  year?: number
  view?: string
  // Without one, the latest revision is used.
  base_revision?: number
  author?: 'user' | 'claude'
}

export type AddedSource = {
  n: number
  plan: Plan
  source: Source
  kind: string
  widthPx: number
  heightPx: number
  dpi?: number
  mmPerPx: number
  note: string
}

export const SOURCE_ID = /^[a-z0-9][a-z0-9-]{0,40}$/

export async function addSource(planId: string, input: SourceInput, data: Buffer): Promise<AddedSource | { errors: string[]; status: number }> {
  if (!SOURCE_ID.test(input.id)) return { errors: ['id: gemener, siffror och bindestreck'], status: 400 }
  if (data.length === 0) return { errors: ['filen är tom'], status: 400 }
  const rev = await loadPlan(planId)
  if (!rev) return { errors: [`Planen ${planId} finns inte`], status: 404 }
  const conv = await convertToPng(data, input.filename)
  const dpi = typeof input.dpi === 'number' ? input.dpi : conv.dpi
  const scale = typeof input.scale === 'number' ? input.scale : undefined
  let note = ''
  let mmPerPx: number
  if (typeof input.mm_per_px === 'number') mmPerPx = input.mm_per_px
  else if (scale && dpi) mmPerPx = mmPerPxFor(dpi, scale)
  else {
    mmPerPx = mmPerPxFor(dpi ?? 300, scale ?? 100)
    note = `\nOBS: skala/upplösning saknas – antog ${scale ?? 100} och ${dpi ?? 300} dpi. Kalibrera med plan_scan_calibrate.`
  }
  const src = await putAsset(planId, `src-${input.id}.png`, conv.png, 'image/png')
  const source: Source = {
    id: input.id,
    name: input.name || input.filename,
    role: (['archive', 'before', 'after', 'other'].includes(String(input.role)) ? input.role : 'other') as Source['role'],
    src,
    widthPx: conv.widthPx,
    heightPx: conv.heightPx,
    dpi,
    mmPerPx,
    x: typeof input.x === 'number' ? input.x : 0,
    y: typeof input.y === 'number' ? input.y : 0,
    rotation: 0,
    ...(typeof input.year === 'number' ? { year: input.year } : {}),
    ...(input.view === 'elevation' ? { view: 'elevation' as const } : {}),
  }
  const res = await editPlan(planId, [{ op: 'add', kind: 'source', item: source }], input.base_revision ?? rev.meta.n, input.author ?? 'claude', `Källritning ${source.name}`)
  if (res.status !== 200) return { errors: res.errors, status: res.status }
  return { n: res.revision.n, plan: res.plan, source, kind: conv.kind, widthPx: conv.widthPx, heightPx: conv.heightPx, dpi, mmPerPx, note }
}
