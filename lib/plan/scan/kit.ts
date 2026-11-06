import type { Op } from '../domain/ops'
import type { Plan, Source, Wall } from '../domain/types'
import { editPlan } from '../service'
import type { Raster } from './raster'
import type { Rect } from './view'

// What the scan tools share: how they are written down, the pieces of schema, and the small helpers they all use.

export type Content = Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>
export type Result = { content: Content; isError?: boolean }
// A scan tool runs on a plan that exists; the arguments are Claude's.
export type ScanTool = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  run: (c: { planId: string; plan: Plan; args: Record<string, unknown> }) => Promise<Result>
}

export const SRC = { type: 'string', description: 'Source drawing id (default: the only source, else the underlay)' }
export const RECT = {
  type: 'object',
  description: 'Area in plan mm: {x,y,w,h}',
  properties: { x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' } },
  required: ['x', 'y', 'w', 'h'],
}
export const PT = { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] }

export const text = (t: string) => ({ type: 'text' as const, text: t })
export const image = (png: Buffer) => ({ type: 'image' as const, data: png.toString('base64'), mimeType: 'image/png' })
export const err = (t: string): Result => ({ content: [text(t)], isError: true })

export function rectOf(v: unknown): Rect | undefined {
  const r = v as Rect | undefined
  if (!r || ![r.x, r.y, r.w, r.h].every((n) => typeof n === 'number') || r.w <= 0 || r.h <= 0) return undefined
  return r
}

// Area around a set of walls, with a margin.
export function around(walls: Wall[], margin = 800): Rect {
  const xs = walls.flatMap((w) => [w.a.x, w.b.x])
  const ys = walls.flatMap((w) => [w.a.y, w.b.y])
  const x = Math.min(...xs) - margin
  const y = Math.min(...ys) - margin
  return { x, y, w: Math.max(...xs) + margin - x, h: Math.max(...ys) + margin - y }
}

export function sourceOps(plan: Plan, r: Raster, patch: Partial<Source>): Op[] {
  if (r.id === 'underlay' && plan.underlay) return [{ op: 'setUnderlay', underlay: { ...plan.underlay, ...patch } }]
  return [{ op: 'update', kind: 'source', id: r.id, patch }]
}

export async function save(planId: string, base: unknown, ops: Op[], message: string): Promise<{ n: number; plan: Plan } | string> {
  if (typeof base !== 'number') return 'base_revision krävs för att spara'
  const res = await editPlan(planId, ops, base, 'claude', message)
  if (res.status !== 200) return `Ingen ändring sparades:\n${res.errors.join('\n')}${res.status === 409 ? '\nLäs planen igen (plan_get) och använd senaste revision.' : ''}`
  return { n: res.revision.n, plan: res.plan }
}
