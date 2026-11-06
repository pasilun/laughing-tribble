import { auditPlan, describeAudit, sourceIdOf } from '../assist/audit'
import { autoTrace } from '../assist/trace'
import type { Op } from '../domain/ops'
import type { Plan, View } from '../domain/types'
import { editPlan, loadPlan } from '../service'
import { resolveSource } from '../scan/raster'
import { scanView } from '../scan/view'
import { preview } from './format'
import { FIX_DOC, verbsToOps } from './guided'
import { refuse, text, type Args, type Tool, type ToolResult } from './tool'

// Working from a source drawing: a first draft (plan_trace), what differs from the drawing (plan_audit), mending it
// (plan_fix) and looking at it (plan_view).

type Rect = { x: number; y: number; w: number; h: number }

// What audit, fix and view share: the plan, the printed size and the source asked for, and a picture over the drawing.
async function withPlan(args: Args) {
  const planId = String(args.plan_id ?? '')
  const view: View = args.view === 'fore' ? 'fore' : 'efter'
  const rev = await loadPlan(planId)
  if (!rev) return { missing: refuse(`Planen ${planId} finns inte`) }
  const po = args.printed_outer_mm as { width?: unknown; length?: unknown } | undefined
  const printed = po && typeof po.width === 'number' && typeof po.length === 'number' ? { width: po.width, length: po.length } : undefined
  const sourceId = typeof args.source_id === 'string' ? args.source_id : undefined
  const overlay = async (plan: Plan, rect?: Rect, what: 'overlay' | 'source' = 'overlay') => {
    const sid = sourceIdOf(plan, sourceId)
    if (!sid) return null
    const r = resolveSource(plan, sid)
    const area = rect ?? { x: r.x, y: r.y, w: r.widthPx * r.mmPerPx, h: r.heightPx * r.mmPerPx }
    const v = await scanView(planId, plan, r, area, { overlay: what === 'overlay', view, maxPx: 1400 })
    return { type: 'image' as const, data: v.png.toString('base64'), mimeType: 'image/png' }
  }
  return { missing: undefined, planId, view, rev, printed, sourceId, overlay }
}

export const TRACE_TOOLS: Tool[] = [
  {
    name: 'plan_trace',
    description:
      'A first draft of the plan from the uploaded drawing in one call: calibrates against the printed outside size (printed_outer_mm), finds and fits the walls, marks the facade, reads openings, windows and doors. Returns what it did and a short list of what needs your judgement, with one picture. It is a draft: run plan_audit next. If the house cannot be found safely it says so; then give dimensions (end points of the printed dimension lines). Calling it again on a plan that has walls only reads openings and doors.',
    inputSchema: {
      type: 'object',
      properties: {
        plan_id: { type: 'string' },
        source_id: { type: 'string', description: 'Default: the drawing that was uploaded' },
        printed_outer_mm: { type: 'object', description: 'Overall outside size printed on the drawing, e.g. {"width":6080,"length":10500}', properties: { width: { type: 'number' }, length: { type: 'number' } }, required: ['width', 'length'] },
        dimensions: { type: 'array', description: 'Printed dimension lines: [{a:{x,y}, b:{x,y}, mm}] with rough end points in plan mm (plan_view shows a mm grid)', items: { type: 'object' } },
      },
      required: ['plan_id'],
    },
    run: async (args) => {
      const planId = String(args.plan_id ?? '')
      const po = args.printed_outer_mm as { width?: unknown; length?: unknown } | undefined
      const printed = po && typeof po.width === 'number' && typeof po.length === 'number' ? { width: po.width, length: po.length } : undefined
      const dims = Array.isArray(args.dimensions) ? (args.dimensions as Array<{ a: { x: number; y: number }; b: { x: number; y: number }; mm: number; label?: string }>) : undefined
      const out = await autoTrace(planId, { sourceId: typeof args.source_id === 'string' ? args.source_id : undefined, printed, dimensions: dims })
      return { content: [text(out.text), ...(out.png ? [{ type: 'image' as const, data: out.png.toString('base64'), mimeType: 'image/png' }] : [])], ...(out.isError ? { isError: true } : {}) }
    },
  },
  {
    name: 'plan_audit',
    description:
      'Checks the plan against the drawing it was traced from and lists what differs, as numbered findings: walls off their drawn position or thickness, openings where the drawing shows solid wall, doors with the wrong swing, outside size against the printed size, plus the review and permit checks. Findings that can be mended carry the exact fix; plan_fix applies them by id. Read this instead of hunting for differences in pictures.',
    inputSchema: {
      type: 'object',
      properties: {
        plan_id: { type: 'string' },
        source_id: { type: 'string' },
        printed_outer_mm: { type: 'object', properties: { width: { type: 'number' }, length: { type: 'number' } }, required: ['width', 'length'] },
        image: { type: 'boolean', description: 'Also a picture of the plan over the drawing' },
      },
      required: ['plan_id'],
    },
    run: async (args) => {
      const c = await withPlan(args)
      if (c.missing) return c.missing
      const items = await auditPlan(c.planId, c.rev.plan, { sourceId: c.sourceId, printed: c.printed })
      const content: ToolResult['content'] = [text(`Revision ${c.rev.meta.n}.\n${describeAudit(items)}`)]
      if (args.image) {
        const img = await c.overlay(c.rev.plan)
        if (img) content.push(img)
      }
      return { content }
    },
  },
  {
    name: 'plan_fix',
    description: `Mends the plan and saves one revision. apply: finding ids from plan_audit (e.g. ["wall:w3","door:o4"]) or "alla" for every finding that has a fix. set: simple changes by id.\n${FIX_DOC}`,
    inputSchema: {
      type: 'object',
      properties: {
        plan_id: { type: 'string' },
        base_revision: { type: 'number', description: 'Default: the latest revision' },
        apply: { description: 'Finding ids from plan_audit, or "alla"' },
        set: { type: 'array', items: { type: 'object' } },
        printed_outer_mm: { type: 'object', properties: { width: { type: 'number' }, length: { type: 'number' } } },
        message: { type: 'string' },
      },
      required: ['plan_id'],
    },
    run: async (args) => {
      const c = await withPlan(args)
      if (c.missing) return c.missing
      const { planId, rev, printed, sourceId } = c
      const apply = args.apply
      const set = Array.isArray(args.set) ? (args.set as Array<Record<string, unknown>>) : []
      if (!apply && !set.length) return refuse('Ange apply (id från plan_audit, eller "alla") och/eller set (lista med ändringar).')
      const ops: Op[] = []
      const notes: string[] = []
      if (apply) {
        const items = await auditPlan(planId, rev.plan, { sourceId, printed })
        const wanted = apply === 'alla' || apply === 'all' ? items.filter((i) => i.fix).map((i) => i.id) : (Array.isArray(apply) ? apply : [apply]).map(String)
        for (const id of wanted) {
          const it = items.find((i) => i.id === id)
          if (!it) notes.push(`${id}: finns inte (längre) i granskningen`)
          else if (!it.fix) notes.push(`${id}: har ingen automatisk rättning – ändra med set eller plan_edit`)
          else {
            ops.push(...it.fix)
            notes.push(`${id}: ${it.fixText ?? 'rättad'}`)
          }
        }
      }
      if (set.length) {
        const v = verbsToOps(rev.plan, set)
        if (v.errors.length) return refuse(`Ingen ändring sparades:\n${v.errors.join('\n')}`)
        ops.push(...v.ops)
        notes.push(`${set.length} ändringar`)
      }
      if (!ops.length) return refuse(`Inget att ändra.\n${notes.join('\n')}`)
      const res = await editPlan(planId, ops, typeof args.base_revision === 'number' ? args.base_revision : rev.meta.n, 'claude', String(args.message ?? 'Rättat (plan_fix)'))
      if (res.status !== 200) return refuse(`Ingen ändring sparades:\n${res.errors.join('\n')}${res.status === 409 ? '\nLäs planen igen (plan_get) och försök mot senaste revisionen.' : ''}`)
      const left = (await auditPlan(planId, res.plan, { sourceId, printed })).filter((i) => i.level !== 'info')
      return { content: [text(`Sparad som revision ${res.revision.n}.\n${notes.map((n) => `- ${n}`).join('\n')}\nKvar: ${left.length ? `${left.length} anmärkningar (${left.slice(0, 5).map((i) => i.id).join(', ')}${left.length > 5 ? ', …' : ''}) – plan_audit visar dem.` : 'inga anmärkningar mot ritningen.'}`)] }
    },
  },
  {
    name: 'plan_view',
    description: 'One picture. what: "overlay" (default) the plan drawn on the source drawing, "source" the drawing alone, "plan" the plan sheet. rect {x,y,w,h} in plan mm zooms in (the grid is in mm: read coordinates off it). Without rect: the whole drawing.',
    inputSchema: {
      type: 'object',
      properties: {
        plan_id: { type: 'string' },
        what: { type: 'string', enum: ['overlay', 'source', 'plan'] },
        rect: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' } }, required: ['x', 'y', 'w', 'h'] },
        source_id: { type: 'string' },
        view: { type: 'string', enum: ['fore', 'efter'] },
      },
      required: ['plan_id'],
    },
    run: async (args) => {
      const c = await withPlan(args)
      if (c.missing) return c.missing
      const { rev, view } = c
      const what = args.what === 'plan' ? 'plan' : args.what === 'source' ? 'source' : 'overlay'
      if (what === 'plan') return { content: [text(`Revision ${rev.meta.n}`), await preview(rev.plan, view, false)] }
      const r = args.rect as { x?: unknown; y?: unknown; w?: unknown; h?: unknown } | undefined
      const rect = r && [r.x, r.y, r.w, r.h].every((n) => typeof n === 'number') && (r.w as number) > 0 && (r.h as number) > 0 ? (r as Rect) : undefined
      const img = await c.overlay(rev.plan, rect, what)
      if (!img) return { content: [text('Planen har ingen källritning. Visar planbladet.'), await preview(rev.plan, view, false)] }
      return { content: [text(`Revision ${rev.meta.n}, ${what === 'overlay' ? 'planen över ritningen' : 'ritningen'}; rutnätet är i mm${rect ? '' : ' (hela ritningen)'}.`), img] }
    },
  },
]
