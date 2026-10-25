import { wallLength } from '../geometry'
import type { Op } from '../ops'
import { editPlan, loadPlan } from '../service'
import { putAsset } from '../store'
import type { Plan, Pt, Source, Wall } from '../types'
import { calibrate, rescaleAround, type Measurement } from './calibrate'
import { detectWalls } from './detect'
import { scanDiff } from './diff'
import { describeDoor, readDoor, readDoors } from './doors'
import { newOpenings } from './openings'
import { profile, roundRun } from './profile'
import { convertToPng, loadGray, mmPerPxFor, resolveSource, type Raster } from './raster'
import { register } from './register'
import { snapWalls } from './snap'
import { scanView, type Rect } from './view'

// Claude's scan tools: everything needed to turn a scanned or exported
// drawing into plan walls without a human at the editor — look, measure,
// calibrate, detect, snap — each returning an image to check the result.

const SRC = { type: 'string', description: 'Source drawing id (default: the only source, else the underlay)' }
const RECT = {
  type: 'object',
  description: 'Area in plan mm: {x,y,w,h}',
  properties: { x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' } },
  required: ['x', 'y', 'w', 'h'],
}
const PT = { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] }

export const SCAN_TOOLS = [
  {
    name: 'plan_source_add',
    description:
      'Adds a source drawing (archive TIF, PDF export, PNG/JPG photo of a drawing) to a plan. It is converted to PNG on the server and placed in plan mm from its scale and resolution (PDF pages are rendered at 200 dpi). Calibrate it with plan_scan_calibrate before tracing.',
    inputSchema: {
      type: 'object',
      properties: {
        plan_id: { type: 'string' },
        base_revision: { type: 'number' },
        id: { type: 'string', description: 'Short id, e.g. "arkiv-1950" or "efter-skiss"' },
        name: { type: 'string' },
        role: { type: 'string', enum: ['archive', 'before', 'after', 'other'] },
        filename: { type: 'string', description: 'Original file name (extension decides the format)' },
        data_base64: { type: 'string' },
        scale: { type: 'number', description: 'Drawing scale denominator, e.g. 100 for 1:100' },
        dpi: { type: 'number', description: 'Scan resolution if not in the file' },
        mm_per_px: { type: 'number', description: 'Overrides scale/dpi' },
        x: { type: 'number', description: 'Plan mm of the image top-left (default 0)' },
        y: { type: 'number' },
      },
      required: ['plan_id', 'base_revision', 'id', 'filename', 'data_base64'],
    },
  },
  {
    name: 'plan_scan_view',
    description:
      'Shows an area of a source drawing in plan mm with a labelled mm grid (read positions off it). overlay=true draws the plan\'s walls on top (red existing, orange rivs, blue ny, ids labelled; openings purple) to check tracing.',
    inputSchema: {
      type: 'object',
      properties: { plan_id: { type: 'string' }, source_id: SRC, rect: RECT, grid_mm: { type: 'number' }, overlay: { type: 'boolean' }, view: { type: 'string', enum: ['fore', 'efter'] }, max_px: { type: 'number' } },
      required: ['plan_id', 'rect'],
    },
  },
  {
    name: 'plan_scan_profile',
    description: 'Ink runs along a line across a source drawing, in mm from the line start — measures wall thickness and position exactly. Draw the line across the wall(s).',
    inputSchema: {
      type: 'object',
      properties: { plan_id: { type: 'string' }, source_id: SRC, from: PT, to: PT, threshold: { type: 'number' } },
      required: ['plan_id', 'from', 'to'],
    },
  },
  {
    name: 'plan_scan_calibrate',
    description:
      'Fits a source drawing\'s scale to known distances (laser measurements, dimension figures, scale bar). Each measurement: two points read off the drawing in plan mm (current calibration) and the true length. Returns the factor and residual per measurement; apply=true saves it, scaling around anchor (default: first point) so nearby tracing stays put.',
    inputSchema: {
      type: 'object',
      properties: {
        plan_id: { type: 'string' },
        base_revision: { type: 'number' },
        source_id: SRC,
        measurements: { type: 'array', items: { type: 'object', properties: { a: PT, b: PT, mm: { type: 'number' }, label: { type: 'string' } }, required: ['a', 'b', 'mm'] } },
        apply: { type: 'boolean' },
        anchor: PT,
        offset: { type: 'object', description: 'Also move the source by {dx,dy} mm (align to the plan)', properties: { dx: { type: 'number' }, dy: { type: 'number' } } },
      },
      required: ['plan_id', 'measurements'],
    },
  },
  {
    name: 'plan_scan_detect_walls',
    description:
      'Finds horizontal and vertical walls in a source drawing (filled bands or pairs of outlines). Returns proposals with thickness and confidence plus an image with them drawn as p1, p2…; nothing is changed. Add the right ones with plan_scan_snap_walls.',
    inputSchema: {
      type: 'object',
      properties: {
        plan_id: { type: 'string' },
        source_id: SRC,
        rect: RECT,
        min_length_mm: { type: 'number', description: 'default 500' },
        min_thickness_mm: { type: 'number', description: 'default 60' },
        max_thickness_mm: { type: 'number', description: 'default 500' },
        threshold: { type: 'number' },
      },
      required: ['plan_id'],
    },
  },
  {
    name: 'plan_scan_snap_walls',
    description:
      'Snaps walls onto the source drawing: give existing wall_ids and/or rough new walls (same fields as plan_edit add wall, ~±100 mm is enough). Cross-sections find the drawn wall, a line fit sets position and angle, the median sets thickness, and ends near another wall are joined at the centreline. Returns a report per wall (confidence, shift, thickness, scatter) and an overlay image. apply=false previews only.',
    inputSchema: {
      type: 'object',
      properties: {
        plan_id: { type: 'string' },
        base_revision: { type: 'number' },
        source_id: SRC,
        wall_ids: { type: 'array', items: { type: 'string' } },
        walls: { type: 'array', items: { type: 'object' } },
        apply: { type: 'boolean', description: 'default true' },
        message: { type: 'string' },
        search_mm: { type: 'number' },
        keep_thickness: { type: 'boolean' },
        square: { type: 'boolean', description: 'Make walls within 3° of horizontal/vertical exactly straight (default true)' },
        join_mm: { type: 'number', description: 'default 250' },
        threshold: { type: 'number' },
      },
      required: ['plan_id'],
    },
  },
  {
    name: 'plan_scan_openings',
    description:
      'Finds openings in the plan\'s walls from a source drawing: where both drawn faces of a wall stop for at least min_width_mm, there is an opening. Each one is then read as a door (with hinge and swing, via the door reader) when a door symbol is clearly drawn there, otherwise as an open passage. Windows are not detected. apply=true adds them.',
    inputSchema: {
      type: 'object',
      properties: {
        plan_id: { type: 'string' },
        base_revision: { type: 'number' },
        source_id: SRC,
        wall_ids: { type: 'array', items: { type: 'string' }, description: 'Default: all walls' },
        apply: { type: 'boolean' },
        threshold: { type: 'number' },
      },
      required: ['plan_id'],
    },
  },
  {
    name: 'plan_scan_doors',
    description:
      'Reads which way the plan\'s doors open from a source drawing: for each door all four options (hinge at either jamb × leaf to either side) are scored by how much of their swing arc lies on ink. Reports the best option, its score against the runner-up, and whether it differs from the plan; apply=true saves the confident corrections. Use the drawing that shows the doors (a before drawing for doors being removed). Never set hinge/swing by eye.',
    inputSchema: {
      type: 'object',
      properties: {
        plan_id: { type: 'string' },
        base_revision: { type: 'number' },
        source_id: SRC,
        door_ids: { type: 'array', items: { type: 'string' }, description: 'Default: all doors' },
        apply: { type: 'boolean' },
        threshold: { type: 'number' },
      },
      required: ['plan_id'],
    },
  },
  {
    name: 'plan_scan_register',
    description:
      'Aligns a source drawing to a reference source (scale + offset) by matching ink over an area both show — e.g. a ventilation or structural drawing onto the architectural plan. Place it roughly first (within shift_mm). Returns the fit and an overlay image of both (reference red, aligned source blue); apply=true saves the new position.',
    inputSchema: {
      type: 'object',
      properties: {
        plan_id: { type: 'string' },
        base_revision: { type: 'number' },
        source_id: { type: 'string', description: 'The drawing to move' },
        reference: { type: 'string', description: 'Source id to align to' },
        rect: RECT,
        scale_min: { type: 'number', description: 'default 0.9' },
        scale_max: { type: 'number', description: 'default 1.1' },
        shift_mm: { type: 'number', description: 'Search ± this far (default 2000)' },
        apply: { type: 'boolean' },
        threshold: { type: 'number' },
      },
      required: ['plan_id', 'source_id', 'reference', 'rect'],
    },
  },
  {
    name: 'plan_scan_diff',
    description: 'Compares two calibrated source drawings (e.g. före and efter) over an area: red = only in the first (removed), blue = only in the second (added), grey = both.',
    inputSchema: {
      type: 'object',
      properties: { plan_id: { type: 'string' }, before_source: { type: 'string' }, after_source: { type: 'string' }, rect: RECT, threshold: { type: 'number' } },
      required: ['plan_id', 'before_source', 'after_source', 'rect'],
    },
  },
]

type Content = Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>
type Result = { content: Content; isError?: boolean }

const text = (t: string) => ({ type: 'text' as const, text: t })
const image = (png: Buffer) => ({ type: 'image' as const, data: png.toString('base64'), mimeType: 'image/png' })
const err = (t: string): Result => ({ content: [text(t)], isError: true })

function rectOf(v: unknown): Rect | undefined {
  const r = v as Rect | undefined
  if (!r || ![r.x, r.y, r.w, r.h].every((n) => typeof n === 'number') || r.w <= 0 || r.h <= 0) return undefined
  return r
}

// Area around a set of walls, with a margin.
function around(walls: Wall[], margin = 800): Rect {
  const xs = walls.flatMap((w) => [w.a.x, w.b.x])
  const ys = walls.flatMap((w) => [w.a.y, w.b.y])
  const x = Math.min(...xs) - margin
  const y = Math.min(...ys) - margin
  return { x, y, w: Math.max(...xs) + margin - x, h: Math.max(...ys) + margin - y }
}

function sourceOps(plan: Plan, r: Raster, patch: Partial<Source>): Op[] {
  if (r.id === 'underlay' && plan.underlay) return [{ op: 'setUnderlay', underlay: { ...plan.underlay, ...patch } }]
  return [{ op: 'update', kind: 'source', id: r.id, patch }]
}

async function save(planId: string, base: unknown, ops: Op[], message: string): Promise<{ n: number; plan: Plan } | string> {
  if (typeof base !== 'number') return 'base_revision krävs för att spara'
  const res = await editPlan(planId, ops, base, 'claude', message)
  if (res.status !== 200) return `Ingen ändring sparades:\n${res.errors.join('\n')}${res.status === 409 ? '\nLäs planen igen (plan_get) och använd senaste revision.' : ''}`
  return { n: res.revision.n, plan: res.plan }
}

export async function handleScanTool(name: string, args: Record<string, unknown>): Promise<Result | null> {
  if (!SCAN_TOOLS.some((t) => t.name === name)) return null
  const planId = String(args.plan_id ?? '')
  const rev = await loadPlan(planId)
  if (!rev) return err(`Planen ${planId} finns inte`)
  const plan = rev.plan
  try {
    if (name === 'plan_source_add') {
      const id = String(args.id ?? '')
      if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(id)) return err('id: gemener, siffror och bindestreck')
      const filename = String(args.filename ?? '')
      const data = Buffer.from(String(args.data_base64 ?? ''), 'base64')
      if (data.length === 0) return err('data_base64 är tom')
      const conv = await convertToPng(data, filename)
      const dpi = typeof args.dpi === 'number' ? args.dpi : conv.dpi
      const scale = typeof args.scale === 'number' ? args.scale : undefined
      let note = ''
      let mmPerPx: number
      if (typeof args.mm_per_px === 'number') mmPerPx = args.mm_per_px
      else if (scale && dpi) mmPerPx = mmPerPxFor(dpi, scale)
      else {
        mmPerPx = mmPerPxFor(dpi ?? 300, scale ?? 100)
        note = `\nOBS: skala/upplösning saknas – antog ${scale ?? 100} och ${dpi ?? 300} dpi. Kalibrera med plan_scan_calibrate.`
      }
      const src = await putAsset(planId, `src-${id}.png`, conv.png, 'image/png')
      const source: Source = {
        id,
        name: String(args.name ?? filename),
        role: (['archive', 'before', 'after', 'other'].includes(String(args.role)) ? args.role : 'other') as Source['role'],
        src,
        widthPx: conv.widthPx,
        heightPx: conv.heightPx,
        dpi,
        mmPerPx,
        x: typeof args.x === 'number' ? args.x : 0,
        y: typeof args.y === 'number' ? args.y : 0,
        rotation: 0,
      }
      const saved = await save(planId, args.base_revision, [{ op: 'add', kind: 'source', item: source }], `Källritning ${source.name}`)
      if (typeof saved === 'string') return err(saved)
      const wMm = Math.round(conv.widthPx * mmPerPx)
      const hMm = Math.round(conv.heightPx * mmPerPx)
      const r = resolveSource(saved.plan, id)
      const view = await scanView(planId, saved.plan, r, { x: source.x, y: source.y, w: wMm, h: hMm }, { maxPx: 1200 })
      return {
        content: [
          text(`Sparad som revision ${saved.n}. Källa ${id}: ${conv.widthPx}×${conv.heightPx} px (${conv.kind}${dpi ? `, ${Math.round(dpi)} dpi` : ''}), ${mmPerPx.toFixed(4)} mm/px ≈ ${wMm}×${hMm} mm, övre vänstra hörnet (${source.x},${source.y}).${note}`),
          image(view.png),
        ],
      }
    }

    const r = resolveSource(plan, typeof args.source_id === 'string' ? args.source_id : undefined)

    if (name === 'plan_scan_view') {
      const rect = rectOf(args.rect)
      if (!rect) return err('rect {x,y,w,h} i mm krävs')
      const v = await scanView(planId, plan, r, rect, {
        gridMm: typeof args.grid_mm === 'number' ? args.grid_mm : undefined,
        overlay: !!args.overlay,
        view: args.view === 'fore' ? 'fore' : 'efter',
        maxPx: typeof args.max_px === 'number' ? Math.min(2400, args.max_px) : undefined,
      })
      return { content: [text(`Källa ${r.id}, utsnitt (${rect.x},${rect.y}) ${rect.w}×${rect.h} mm, ${(1 / v.scale).toFixed(2)} mm per bildpixel (källan ${r.mmPerPx.toFixed(3)} mm/px).`), image(v.png)] }
    }

    const g = await loadGray(planId, r)
    const threshold = typeof args.threshold === 'number' ? args.threshold : undefined

    if (name === 'plan_scan_profile') {
      const from = args.from as Pt
      const to = args.to as Pt
      const p = profile(g, r, from, to, threshold)
      const runs = p.runs.map(roundRun)
      const lines = runs.map((x, i) => `${i + 1}. ${x.from}–${x.to} mm (bredd ${x.width}, mitt ${x.mid})`)
      return { content: [text(`Linje ${Math.round(p.length)} mm i källa ${r.id}, ${runs.length} mörka partier (± ${r.mmPerPx.toFixed(1)} mm):\n${lines.join('\n') || '–'}`)] }
    }

    if (name === 'plan_scan_calibrate') {
      const ms = (Array.isArray(args.measurements) ? args.measurements : []) as Measurement[]
      const c = calibrate(r, ms)
      const res = c.residuals.map((x) => `- ${x.label}: uppmätt ${x.measuredMm}, ritat ${x.drawnMm} (${x.residualMm >= 0 ? '+' : ''}${x.residualMm} mm, ${x.residualPct}%)`).join('\n')
      let out = `Faktor ${c.factor.toFixed(5)} (${((c.factor - 1) * 100).toFixed(2)}%) → ${c.mmPerPx.toFixed(4)} mm/px. RMS ${c.rmsMm} mm.\n${res}`
      if (args.apply) {
        const anchor = (args.anchor as Pt | undefined) ?? ms[0].a
        const next = rescaleAround(r, c.factor, anchor)
        const off = (args.offset ?? {}) as { dx?: number; dy?: number }
        const patch = { mmPerPx: next.mmPerPx, x: Math.round(next.x + (off.dx ?? 0)), y: Math.round(next.y + (off.dy ?? 0)), calibration: `${ms.length} mått, RMS ${c.rmsMm} mm` }
        const saved = await save(planId, args.base_revision, sourceOps(plan, r, patch), `Kalibrerade ${r.id} (${((c.factor - 1) * 100).toFixed(2)}%)`)
        if (typeof saved === 'string') return err(`${out}\n\n${saved}`)
        out += `\nSparad som revision ${saved.n}.`
      }
      return { content: [text(out)] }
    }

    if (name === 'plan_scan_detect_walls') {
      const rect = rectOf(args.rect)
      const found = detectWalls(g, r, {
        rect,
        minLengthMm: typeof args.min_length_mm === 'number' ? args.min_length_mm : undefined,
        minThicknessMm: typeof args.min_thickness_mm === 'number' ? args.min_thickness_mm : undefined,
        maxThicknessMm: typeof args.max_thickness_mm === 'number' ? args.max_thickness_mm : undefined,
        threshold,
      })
      const walls: Wall[] = found.map((p, i) => ({ id: `p${i + 1}`, a: p.a, b: p.b, thickness: p.thickness, phase: 'existing' }))
      const lines = found.map((p, i) => `p${i + 1}: (${p.a.x},${p.a.y})→(${p.b.x},${p.b.y}) längd ${Math.round(Math.hypot(p.b.x - p.a.x, p.b.y - p.a.y))} tj ${p.thickness} ${p.style === 'filled' ? 'fylld' : 'konturer'} säkerhet ${p.confidence}`)
      const area = rect ?? { x: r.x, y: r.y, w: r.widthPx * r.mmPerPx, h: r.heightPx * r.mmPerPx }
      const content: Content = [text(`${found.length} förslag (inget ändrat):\n${lines.join('\n') || '–'}`)]
      if (walls.length) content.push(image((await scanView(planId, { ...plan, walls, openings: [] }, r, area, { overlay: true })).png))
      return { content }
    }

    if (name === 'plan_scan_snap_walls') {
      const ids = Array.isArray(args.wall_ids) ? args.wall_ids.map(String) : []
      const add = (Array.isArray(args.walls) ? args.walls : []) as Wall[]
      if (!ids.length && !add.length) return err('ange wall_ids och/eller walls')
      for (const w of add) if (!w.id || !w.a || !w.b) return err('varje ny vägg behöver id, a och b')
      const res = snapWalls(g, r, plan, { ids, add }, {
        searchMm: typeof args.search_mm === 'number' ? args.search_mm : undefined,
        keepThickness: !!args.keep_thickness,
        square: args.square !== false,
        joinMm: typeof args.join_mm === 'number' ? args.join_mm : undefined,
        threshold,
      })
      const lines = res.reports.map((x) =>
        `- ${x.id}: ${x.ok ? 'ok' : 'OSÄKER'} säkerhet ${x.confidence} (${x.sections} tvärsnitt), flytt ${x.shiftMm} mm, vinkel ${x.angleDeg}°, tj ${x.thicknessMm}, spridning ${x.rmsMm} mm${x.note ? ` – ${x.note}` : ''}`)
      const apply = args.apply !== false
      let head = 'Förhandsvisning (inget sparat).'
      let after = plan
      if (apply) {
        const saved = await save(planId, args.base_revision, res.ops, String(args.message ?? `Fäste ${res.walls.length} väggar mot ${r.id}`))
        if (typeof saved === 'string') return err(`${saved}\n${lines.join('\n')}`)
        head = `Sparad som revision ${saved.n}.`
        after = saved.plan
      } else {
        const byId = new Map(res.walls.map((w) => [w.id, w]))
        after = { ...plan, walls: [...plan.walls.map((w) => byId.get(w.id) ?? w), ...res.walls.filter((w) => !plan.walls.some((p) => p.id === w.id))] }
      }
      const summary = res.walls.map((w) => `  ${w.id}: (${w.a.x},${w.a.y})→(${w.b.x},${w.b.y}) längd ${Math.round(wallLength(w))} tj ${w.thickness}`)
      const v = await scanView(planId, after, r, around(res.walls), { overlay: true })
      return { content: [text(`${head}\n${lines.join('\n')}\nResultat:\n${summary.join('\n')}`), image(v.png)] }
    }

    if (name === 'plan_scan_openings') {
      const ids = Array.isArray(args.wall_ids) ? args.wall_ids.map(String) : undefined
      const found = newOpenings(g, r, plan, ids, threshold)
      const lines: string[] = []
      const ops: Op[] = []
      for (const o of found) {
        const wall = plan.walls.find((w) => w.id === o.wallId)!
        const rd = readDoor(g, r, wall, { ...o, kind: 'door' }, threshold)
        const item: typeof o = rd.best && rd.confident ? { ...o, kind: 'door', hinge: rd.best.hinge, swing: rd.best.swing } : o
        ops.push({ op: 'add', kind: 'opening', item })
        lines.push(`- ${item.id}: ${item.kind === 'door' ? `dörr ${describeDoor(wall, item)}` : 'öppning'} i ${o.wallId}, offset ${o.offset}, bredd ${o.width}${item.kind === 'door' ? '' : ` [dörr? ${rd.candidates.map((c) => `${c.hinge}/${c.swing} ${Math.round(c.score * 100)}%`).join(', ')}]`}`)
      }
      let head = `${found.length} öppningar hittade (fönster ingår inte).`
      let after = plan
      if (args.apply && ops.length) {
        const saved = await save(planId, args.base_revision, ops, `Öppningar och dörrar från ${r.id}`)
        if (typeof saved === 'string') return err(`${head}\n${lines.join('\n')}\n\n${saved}`)
        head += ` Sparad som revision ${saved.n}.`
        after = saved.plan
      }
      const content: Content = [text(`${head}\n${lines.join('\n')}`)]
      if (after.walls.length) content.push(image((await scanView(planId, after, r, around(after.walls, 400), { overlay: true, view: 'fore' })).png))
      return { content }
    }

    if (name === 'plan_scan_doors') {
      const ids = Array.isArray(args.door_ids) ? args.door_ids.map(String) : undefined
      const { readings, ops } = readDoors(g, r, plan, ids, threshold)
      const fmt = (c: { hinge: string; swing: string; score: number }) => `${c.hinge}/${c.swing} ${Math.round(c.score * 100)}%`
      const lines = readings.map((x) => {
        const o = plan.openings.find((q) => q.id === x.id)!
        const wall = plan.walls.find((w) => w.id === o.wallId)!
        const status = !x.best ? 'HITTAS INTE i ritningen' : !x.confident ? 'OSÄKER' : x.changed ? 'FEL i planen →' : 'ok'
        const shown = x.best && x.confident ? describeDoor(wall, { ...o, hinge: x.best.hinge, swing: x.best.swing }) : describeDoor(wall, o)
        const off = x.best?.shiftMm ? ` (ritad ${x.best.shiftMm} mm från planens läge)` : ''
        return `- ${x.id}: ${status} ${shown}${off} [${x.candidates.map(fmt).join(', ')}]`
      })
      let head = `${readings.length} dörrar mot ${r.id}; ${ops.length} att rätta.`
      let after = plan
      if (args.apply && ops.length) {
        const saved = await save(planId, args.base_revision, ops, `Dörrar enligt ${r.id} (${ops.length} rättade)`)
        if (typeof saved === 'string') return err(`${head}\n${lines.join('\n')}\n\n${saved}`)
        head += ` Sparad som revision ${saved.n}.`
        after = saved.plan
      }
      const doorWalls = after.walls.filter((w) => after.openings.some((o) => o.kind === 'door' && o.wallId === w.id && (!ids || ids.includes(o.id))))
      const content: Content = [text(`${head}\n${lines.join('\n')}`)]
      if (doorWalls.length) content.push(image((await scanView(planId, after, r, around(doorWalls, 1200), { overlay: true, view: 'fore' })).png))
      return { content }
    }

    if (name === 'plan_scan_register') {
      const rect = rectOf(args.rect)
      if (!rect) return err('rect {x,y,w,h} i mm krävs')
      const rr = resolveSource(plan, String(args.reference))
      if (rr.id === r.id) return err('source_id och reference måste vara olika källor')
      const fit = register({ g: await loadGray(planId, rr), r: rr }, { g, r }, rect, {
        scaleMin: typeof args.scale_min === 'number' ? args.scale_min : undefined,
        scaleMax: typeof args.scale_max === 'number' ? args.scale_max : undefined,
        shiftMm: typeof args.shift_mm === 'number' ? args.shift_mm : undefined,
        threshold,
      })
      let out = `${r.id} mot ${rr.id}: skala ×${fit.scale.toFixed(4)} → ${fit.mmPerPx.toFixed(4)} mm/px, flytt (${fit.dx}, ${fit.dy}) mm → övre vänstra hörnet (${fit.x},${fit.y}). Överlapp ${fit.score} (1 = perfekt; under ~0.3 är tveksamt).`
      const moved: Raster = { ...r, mmPerPx: fit.mmPerPx, x: fit.x, y: fit.y }
      if (args.apply) {
        const saved = await save(planId, args.base_revision, sourceOps(plan, r, { mmPerPx: fit.mmPerPx, x: fit.x, y: fit.y, calibration: `inpassad mot ${rr.id} (överlapp ${fit.score})` }), `Passade in ${r.id} mot ${rr.id}`)
        if (typeof saved === 'string') return err(`${out}\n\n${saved}`)
        out += `\nSparad som revision ${saved.n}.`
      }
      const d = await scanDiff({ g: await loadGray(planId, rr), r: rr }, { g, r: moved }, rect, { threshold })
      return { content: [text(`${out}\nBild: rött = bara ${rr.id}, blått = bara ${r.id}, grått = båda.`), image(d.png)] }
    }

    // plan_scan_diff
    const rect = rectOf(args.rect)
    if (!rect) return err('rect {x,y,w,h} i mm krävs')
    const rb = resolveSource(plan, String(args.before_source))
    const ra = resolveSource(plan, String(args.after_source))
    const d = await scanDiff({ g: await loadGray(planId, rb), r: rb }, { g: await loadGray(planId, ra), r: ra }, rect, { threshold })
    return { content: [text(`Rött = bara i ${rb.id} (${d.removedPct}% av bläcket), blått = bara i ${ra.id} (${d.addedPct}%), grått = i båda.`), image(d.png)] }
  } catch (e) {
    return err((e as Error).message)
  }
}
