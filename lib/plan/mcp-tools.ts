import { auditPlan, describeAudit, sourceIdOf } from './audit'
import { checkPlan } from './checks'
import { finishPlan } from './finish'
import { FIX_DOC, nextStep, verbsToOps } from './guided'
import { BASIC_INSTRUCTIONS, GUIDE, INSTRUCTIONS } from './guide'
import { autoTrace } from './trace'
import { describeReview, reviewPlan } from './review'
import { comparePlans } from './compare'
import { sheetPng } from './export'
import { wallLength } from './geometry'
import type { Op } from './ops'
import { describeDoor } from './scan/doors'
import { handleScanTool, SCAN_TOOLS } from './scan/tools'
import { resolveSource } from './scan/raster'
import { scanView } from './scan/view'
import { createPlan, editPlan, loadPlan } from './service'
import { getAsset, listPlans, listRevisions, putAsset } from './store'
import type { Plan, Pt, View } from './types'

// Claude tools for floor plans. Claude never regenerates a plan: it reads
// it, then sends small operations against a known revision, and gets a
// rendered preview back to check its own work.

const OPS_DOC = `Operations (all lengths in whole millimetres; x to the right, y DOWN; ids are stable strings):
- {"op":"add","kind":"wall","item":{"id":"v1","a":{"x":0,"y":0},"b":{"x":4000,"y":0},"thickness":100,"phase":"existing"|"demolish"|"new","loadBearing"?:true,"fireRating"?:"EI60","fireRatingAfter"?:""|"EI60","apartmentBoundary"?:true}}
- {"op":"add","kind":"mass","item":{"id":"m1","points":[{"x":..,"y":..},…],"phase":"existing","loadBearing"?:true}}  (a solid with a sloping outline a straight wall can't draw, e.g. tapered masonry beside a stairwell: convex, corners in order; split other shapes into several. Drawn and counted like walls; walls running into it disappear under it)
- {"op":"add","kind":"opening","item":{"id":"o1","wallId":"v1","kind":"door"|"opening"|"window","offset":1200,"width":900,"height"?:2100,"phase":"new","hinge"?:"a"|"b","swing"?:"left"|"right"}}  (offset = distance from the wall's a-end to the opening's near edge). "beam":"INP 22 (K-ritning 1936)" records the documented beam over a wide opening in a load-bearing wall. "through":true marks an open passage with no wall, door or frame in the stretch between two walls: the rooms either side count as one space (one label, one area). hinge/swing: don't set them by eye — with a source drawing run plan_scan_doors; plan_get lists each door in words ("gångjärn vid västra karmen, öppnar mot norr") to check.
- {"op":"add","kind":"fixture","item":{"id":"i1","kind":"kitchen"|"stove"|"sink"|"radiator"|"exhaust"|"shaft"|"wc"|"shower"|"bath"|"plug"|"box"|"balcony","x":..,"y":..,"w":..,"d":..,"rotation"?:0,"phase":"existing","label"?:"..."}}  (x,y = centre; a balcony: w along the facade, d out from its outer face)
- {"op":"add","kind":"room","item":{"id":"r1","name":"Kök","renamed"?:"Rum","goneAfter"?:true,"at":{"x":..,"y":..},"polygon"?:[{x,y},...]}}
- {"op":"add","kind":"dimension","item":{"id":"m1","a":{..},"b":{..},"offset":500}}
- {"op":"add","kind":"note","item":{"id":"n1","at":{..},"text":"..."}}
- {"op":"update","kind":"wall|mass|opening|fixture|room|dimension|note","id":"…","patch":{…fields to change…}}
- {"op":"delete","kind":"…","id":"…"}  (deleting a wall deletes its openings)
- {"op":"moveVertex","from":{x,y},"to":{x,y}}  (moves every wall end at that point — joined walls follow)
- {"op":"moveWall","id":"v1","dx":100,"dy":0}  (walls joined at its ends stretch)
- {"op":"setWallLength","id":"v1","length":3500,"fixed":"a"|"b"}
- {"op":"scale","origin":{"x":..,"y":..},"fx":1.01,"fy":1.006,"sources"?:1.008}  (scales the whole drawing about a point, separately along x and y; wall thicknesses and fixture sizes stay, openings keep their size. plan_finish with fit_outer does this to match the printed outside size)
- {"op":"setSheet","patch":{"paper":"A3"|"A4","orientation":"landscape"|"portrait","scale":50|100|150|200,"northAngle":0,"doorSwings":false}}  (doorSwings false = doors without swing arcs, for overview sheets)
- {"op":"setTitleBlock","patch":{"project","property","address","apartments","floor","drawingNumber","author","date"}}
Phases: "existing" = stays, "demolish" = exists today and is removed, "new" = added. Före shows today; efter marks rivs/ny.
All ops in one call succeed together or none are applied.`

const OPS_SHORT = `Operations (whole mm, x right, y DOWN, stable string ids). The full reference with every field: plan_guide {"topic":"ops"}. For simple changes plan_fix is easier.
- {"op":"add","kind":"wall"|"opening"|"fixture"|"room"|"dimension"|"note"|"mass","item":{…}} e.g. wall {"id":"v1","a":{"x":0,"y":0},"b":{"x":4000,"y":0},"thickness":100,"phase":"existing"}; opening {"id":"o1","wallId":"v1","kind":"door"|"opening"|"window","offset":1200,"width":900,"phase":"existing"}; room {"id":"r1","name":"Kök","at":{"x":..,"y":..}}
- {"op":"update","kind":"…","id":"…","patch":{…}} · {"op":"delete","kind":"…","id":"…"} · {"op":"moveVertex","from":{x,y},"to":{x,y}} · {"op":"moveWall","id","dx","dy"} · {"op":"setWallLength","id","length","fixed":"a"|"b"} · {"op":"scale","origin","fx","fy"} · {"op":"setSheet","patch":{…}} · {"op":"setTitleBlock","patch":{…}}
Phases: "existing" = stays, "demolish" = removed, "new" = added. All ops in one call succeed together or none are applied.`

export const PLAN_TOOLS = [
  {
    name: 'plan_guide',
    description: 'The working order for making a plan that can be trusted: getting the drawing into the plan, calibrating, tracing, comparing, reviewing, filling in the sheet. Read it before drawing anything from a drawing or photo.',
    inputSchema: { type: 'object', properties: { topic: { type: 'string', enum: ['ops'], description: 'ops = the full reference for plan_edit operations' } } },
  },
  {
    name: 'plan_next',
    description: 'Where the plan stands and the one thing to do now, with the next call and its arguments filled in. Call it after every step; follow it.',
    inputSchema: { type: 'object', properties: { plan_id: { type: 'string' } }, required: ['plan_id'] },
  },
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
  },
  {
    name: 'plan_upload_link',
    description:
      'Returns a link where the user drops a drawing (PNG, JPG, TIF or PDF, up to about 4 MB) so it becomes a source of the plan. A chat attachment cannot be passed to a tool, so use this whenever the user has a drawing or photo to trace. Afterwards read the plan (plan_get), view the source (plan_scan_view) and calibrate it (plan_scan_calibrate).',
    inputSchema: { type: 'object', properties: { plan_id: { type: 'string' } }, required: ['plan_id'] },
  },
  {
    name: 'plan_finish',
    description:
      'The last mechanical steps of a plan, in one call: sets the largest sheet scale (and orientation) where the plan fills the paper, adds the overall dimension lines if there are none, optionally marks the exterior walls load-bearing, runs plan_review and plan_check, and lists what only the user can supply (property, address, flat number, drawn by). Saves one revision if it changed anything. Call it when the drawing is traced, then fix what it lists and ask the user for the missing title block fields in one question.',
    inputSchema: {
      type: 'object',
      properties: {
        plan_id: { type: 'string' },
        base_revision: { type: 'number', description: 'Defaults to the latest revision' },
        mark_exterior_load_bearing: { type: 'boolean', description: 'Mark exterior walls load-bearing (basements and masonry houses). Default false.' },
        fit_outer: { type: 'boolean', description: 'With printed_outer_mm: when the traced outside size is more than 30 mm but less than 3 % off the printed one, scale the plan (and the source drawing) to it. Use after tracing when the printed size is known.' },
        printed_outer_mm: {
          type: 'object',
          description: 'The overall outside size printed on the drawing, e.g. {"width":6080,"length":10500}. The traced plan is compared with it; more than 30 mm off is flagged. Always pass it when the drawing has them.',
          properties: { width: { type: 'number' }, length: { type: 'number' } },
          required: ['width', 'length'],
        },
        view: { type: 'string', enum: ['fore', 'efter'], description: 'Preview view (default efter)' },
      },
      required: ['plan_id'],
    },
  },
  {
    name: 'plan_list',
    description: 'Lists saved floor plans (planritningar) with their latest revision.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'plan_create',
    description:
      'Creates a new floor plan and returns its id and editor link. By default it records what exists today: do not add changes, demolition or a new layout unless the user asks. If the user has a drawing or photo, call plan_upload_link next and trace from it (see plan_guide); otherwise start empty and add walls with plan_edit, or pass a full plan.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Short name, e.g. "Källare Lundagatan 48 B"' },
        template: { type: 'string', enum: ['empty', 'demo'], description: 'demo = a made-up example plan' },
      },
      required: ['name'],
    },
  },
  {
    name: 'plan_get',
    description:
      'Reads a floor plan: a compact listing of every wall, opening, fixture and room with ids and measurements, the title block, the current revision number (needed for plan_edit), and a rendered drawing sheet. Set with_underlay to see the scanned drawing under the plan to check tracing.',
    inputSchema: {
      type: 'object',
      properties: {
        plan_id: { type: 'string' },
        revision: { type: 'number', description: 'Older revision to read (default latest)' },
        view: { type: 'string', enum: ['fore', 'efter'], description: 'Which sheet to render (default efter)' },
        with_underlay: { type: 'boolean' },
        include_json: { type: 'boolean', description: 'Also return the full plan JSON' },
        only: { type: 'array', items: { type: 'string', enum: ['sheet', 'walls', 'openings', 'fixtures', 'rooms', 'sources'] }, description: 'Only these parts (default all). Cheaper when reworking.' },
        since: { type: 'number', description: 'Only what changed since this revision' },
        image: { type: 'boolean', description: 'Picture of the sheet (default yes, but not with only/since)' },
      },
      required: ['plan_id'],
    },
  },
  {
    name: 'plan_edit',
    description: `Changes a floor plan with small operations and saves them as a new revision. Pass base_revision from plan_get; if the user has saved since, the call is rejected — read the plan again and redo the change. Returns the new revision and only the findings that are new (plan_check lists all); add image:true for a preview picture.\n\n${OPS_SHORT}`,
    inputSchema: {
      type: 'object',
      properties: {
        plan_id: { type: 'string' },
        base_revision: { type: 'number' },
        message: { type: 'string', description: 'What changed, in Swedish, e.g. "Breddade öppningen till 1000 mm"' },
        ops: { type: 'array', items: { type: 'object' } },
        view: { type: 'string', enum: ['fore', 'efter'] },
        image: { type: 'boolean', description: 'Also return a picture of the sheet (default no)' },
      },
      required: ['plan_id', 'base_revision', 'message', 'ops'],
    },
  },
  {
    name: 'plan_check',
    description: 'Checks a floor plan against what an anmälan for interior work needs to show (title block, scale fits, demolition of load-bearing walls, fire-cell boundaries, plugged connections, ventilation). Flags only — not a legal judgment.',
    inputSchema: { type: 'object', properties: { plan_id: { type: 'string' } }, required: ['plan_id'] },
  },
  {
    name: 'plan_review',
    description: 'Reviews a floor plan like an architect walking it: which rooms each door and opening joins, one entrance per flat (rooms need apartment set), every room reachable, no doors between flats or into walls, WC not off a kitchen and opening outward, doors not slamming into closets, habitable rooms with windows. Facts and flags to judge against the sources, not verdicts — see docs/plan-review.md.',
    inputSchema: { type: 'object', properties: { plan_id: { type: 'string' }, view: { type: 'string', enum: ['fore', 'efter'] } }, required: ['plan_id'] },
  },
  {
    name: 'plan_revisions',
    description: 'Lists the revision history of a floor plan (who changed what, issued revision letters).',
    inputSchema: { type: 'object', properties: { plan_id: { type: 'string' } }, required: ['plan_id'] },
  },
  {
    name: 'plan_import',
    description: 'Creates a new floor plan from a full plan JSON (walls, openings, fixtures, rooms, sheet…), e.g. one traced elsewhere or exported with plan_get include_json. Returns the new id.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        plan: { type: 'object' },
        copy_sources_from: { type: 'string', description: 'Plan id whose source drawings (plan.sources ids) are copied into the new plan; without it sources are dropped' },
      },
      required: ['name', 'plan'],
    },
  },
  {
    name: 'plan_compare',
    description:
      'Compares a plan with a reference plan of the same floor (e.g. archive-built vs surveyed). Walls are paired by id and the reference is mapped into the plan\'s frame by a fitted scale+offset per axis. Reports each wall\'s centreline and thickness difference, walls in only one plan, and openings matched (centre and width difference), missed and extra – a score for how well a plan was built.',
    inputSchema: {
      type: 'object',
      properties: { plan_id: { type: 'string' }, reference_id: { type: 'string' }, match_mm: { type: 'number', description: 'Max centre distance for an opening match (default 450)' } },
      required: ['plan_id', 'reference_id'],
    },
  },
  ...SCAN_TOOLS,
]

type Content = Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>
export type ToolResult = { content: Content; isError?: boolean }

function host(): string {
  return process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:3000'
}

function links(id: string, rev: number): string {
  const h = host()
  return [
    `Editor: ${h}/plans/${id}`,
    `PDF (före + efter): ${h}/api/plans/${id}/sheet?view=both&format=pdf&rev=${rev}`,
    `DXF efter: ${h}/api/plans/${id}/sheet?view=efter&format=dxf&rev=${rev}`,
  ].join('\n')
}

export const SECTIONS = ['sheet', 'walls', 'openings', 'fixtures', 'rooms', 'sources'] as const
export type Section = (typeof SECTIONS)[number]

// only: just these parts (a review or a rework rarely needs all of the plan again).
export function summarisePlan(plan: Plan, only?: Section[]): string {
  const want = (k: Section) => !only || only.includes(k)
  const tb = plan.sheet.titleBlock
  const lines: string[] = []
  lines.push(`Plan "${plan.name}" (${plan.id}) – ${plan.sheet.paper} 1:${plan.sheet.scale}`)
  if (want('sheet')) lines.push(`Ritningshuvud: ${JSON.stringify(tb)}`)
  if (want('walls')) {
  lines.push(`Väggar (${plan.walls.length}):`)
  for (const w of plan.walls) {
    const flags = [w.loadBearing && 'bärande', w.fireRating && `brand ${w.fireRating}${w.fireRatingAfter !== undefined ? `→${w.fireRatingAfter || 'ingen'}` : ''}`, w.apartmentBoundary && 'lgh-skiljande']
      .filter(Boolean)
      .join(', ')
    lines.push(`- ${w.id}: (${w.a.x},${w.a.y})→(${w.b.x},${w.b.y}) längd ${Math.round(wallLength(w))} tj ${w.thickness} ${w.phase}${flags ? ` [${flags}]` : ''}`)
  }
  if (plan.masses?.length) {
    lines.push(`Massor (${plan.masses.length}):`)
    for (const m of plan.masses) lines.push(`- ${m.id}: ${m.points.map((p) => `(${p.x},${p.y})`).join(' ')} ${m.phase}${m.loadBearing ? ' [bärande]' : ''}`)
  }
  }
  if (want('openings')) {
  lines.push(`Öppningar (${plan.openings.length}):`)
  for (const o of plan.openings) {
    const w = plan.walls.find((x) => x.id === o.wallId)
    const swing = o.kind === 'door' && w ? `, ${describeDoor(w, o)}` : ''
    lines.push(`- ${o.id}: ${o.kind} i ${o.wallId} offset ${o.offset} bredd ${o.width}${o.height ? ` höjd ${o.height}` : ''} ${o.phase}${swing}${o.through ? ', genomgång (rummen går ihop)' : ''}${o.beam ? `, balk ${o.beam}` : ''}`)
  }
  }
  if (want('fixtures')) {
  lines.push(`Inredning (${plan.fixtures.length}):`)
  for (const f of plan.fixtures) lines.push(`- ${f.id}: ${f.kind} @(${f.x},${f.y}) ${f.w}×${f.d} ${f.phase}${f.label ? ` "${f.label}"` : ''}`)
  }
  if (want('rooms')) {
  lines.push(`Rum: ${plan.rooms.map((r) => `${r.id} "${r.name}${r.renamed ? `→${r.renamed}` : ''}" @(${r.at.x},${r.at.y})`).join('; ') || '–'}`)
  if (plan.dimensions.length) lines.push(`Mått: ${plan.dimensions.map((d) => `${d.id} (${d.a.x},${d.a.y})–(${d.b.x},${d.b.y})`).join('; ')}`)
  }
  if (want('sources'))
  for (const src of plan.sources ?? [])
    lines.push(`Källa ${src.id} (${src.role}) "${src.name}": ${src.widthPx}×${src.heightPx} px, ${src.mmPerPx.toFixed(4)} mm/px vid (${src.x},${src.y})${src.calibration ? `, kalibrerad: ${src.calibration}` : ', ej kalibrerad'}`)
  if (want('sources') && plan.underlay) lines.push(`Underlag: ${plan.underlay.widthPx}×${plan.underlay.heightPx} px, ${plan.underlay.mmPerPx.toFixed(3)} mm/px vid (${plan.underlay.x},${plan.underlay.y})`)
  const sources = plan.sources ?? []
  if (plan.walls.length && !sources.length && !plan.underlay)
    lines.push('OBS: planen har ingen källritning – måtten är uppskattade, inte avritade. Be användaren ladda upp ritningen (plan_upload_link) och läs plan_guide.')
  else if (sources.length && !sources.some((x) => x.calibration))
    lines.push('OBS: ingen källa är kalibrerad mot angivna mått – kalibrera med plan_scan_calibrate innan du ritar av den.')
  return lines.join('\n')
}

// What differs between two revisions, by id: added, changed, removed.
export function changedSince(old: Plan, now: Plan): string {
  const out: string[] = []
  const lists: Array<[string, Array<{ id: string }>, Array<{ id: string }>]> = [
    ['vägg', old.walls, now.walls],
    ['öppning', old.openings, now.openings],
    ['inredning', old.fixtures, now.fixtures],
    ['rum', old.rooms, now.rooms],
    ['mått', old.dimensions, now.dimensions],
  ]
  for (const [label, a, b] of lists) {
    const was = new Map(a.map((x) => [x.id, JSON.stringify(x)]))
    for (const x of b) {
      const w = was.get(x.id)
      if (w === undefined) out.push(`+ ${label} ${x.id}: ${brief(x)}`)
      else if (w !== JSON.stringify(x)) out.push(`~ ${label} ${x.id}: ${brief(x)}`)
    }
    for (const x of a) if (!b.some((y) => y.id === x.id)) out.push(`- ${label} ${x.id}`)
  }
  if (JSON.stringify(old.sheet) !== JSON.stringify(now.sheet)) out.push('~ blad/ritningshuvud ändrat')
  return out.slice(0, 40).join('\n') + (out.length > 40 ? `\n… och ${out.length - 40} till` : '')
}

function brief(x: unknown): string {
  const o = x as Record<string, unknown>
  const p = (v: unknown) => (v && typeof v === 'object' ? `(${(v as Pt).x},${(v as Pt).y})` : '')
  if (o.a && o.b) return `${p(o.a)}→${p(o.b)} tj ${o.thickness}`
  if (o.wallId) return `${o.kind} i ${o.wallId} offset ${o.offset} bredd ${o.width}`
  if (o.at) return `"${o.name}" ${p(o.at)}`
  if (typeof o.x === 'number') return `${o.kind} @(${o.x},${o.y})`
  return ''
}

async function preview(plan: Plan, view: View, withUnderlay: boolean): Promise<{ type: 'image'; data: string; mimeType: string }> {
  let p = plan
  if (withUnderlay && plan.underlay) {
    const name = decodeURIComponent(plan.underlay.src.split('/').pop() ?? '')
    const data = await getAsset(plan.id, name)
    if (data) p = { ...plan, underlay: { ...plan.underlay, src: `data:image/png;base64,${data.toString('base64')}` } }
  }
  const png = sheetPng(p, view, 1600, withUnderlay)
  return { type: 'image', data: png.toString('base64'), mimeType: 'image/png' }
}

const text = (t: string): { type: 'text'; text: string } => ({ type: 'text', text: t })

export async function handlePlanTool(name: string, args: Record<string, unknown>): Promise<ToolResult | null> {
  if (!PLAN_TOOLS.some((t) => t.name === name)) return null
  const scan = await handleScanTool(name, args)
  if (scan) return scan
  const planId = String(args.plan_id ?? '')
  const view: View = args.view === 'fore' ? 'fore' : 'efter'

  if (name === 'plan_finish') {
    const rev = await loadPlan(planId)
    if (!rev) return { content: [text(`Planen ${planId} finns inte`)], isError: true }
    const po = args.printed_outer_mm as { width?: unknown; length?: unknown } | undefined
    const printedOuter = po && typeof po.width === 'number' && typeof po.length === 'number' ? { width: po.width, length: po.length } : undefined
    const fin = finishPlan(rev.plan, { markExteriorLoadBearing: args.mark_exterior_load_bearing === true, printedOuter, fitOuter: args.fit_outer === true })
    let plan = rev.plan
    let n = rev.meta.n
    if (fin.ops.length) {
      const res = await editPlan(planId, fin.ops, typeof args.base_revision === 'number' ? args.base_revision : n, 'claude', 'Färdigställd: blad, yttermått, våningsplan')
      if (res.status !== 200) return { content: [text(`Ingen ändring sparades:\n${res.errors.join('\n')}${res.status === 409 ? '\nLäs planen igen med plan_get och kör plan_finish mot senaste revisionen.' : ''}`)], isError: true }
      plan = res.plan
      n = res.revision.n
    }
    const done = fin.done.length ? fin.done.map((d) => `- ${d}`).join('\n') : '- inget behövde ändras'
    const order = { error: 0, warning: 1, info: 2 }
    const left = [...fin.findings].sort((a, b) => order[a.level] - order[b.level]).map((f) => `- [${f.level}] ${f.message}`).join('\n') || '- inga'
    const ask = fin.ask.length ? `\n\nFråga användaren (ett meddelande): ${fin.ask.join('; ')}. Sätt fälten med setTitleBlock. Skriv inte in egna gissningar.` : ''
    return {
      content: [
        text(`Färdigställd, revision ${n}.\nGjort:\n${done}\n\nKvarstår att åtgärda eller förklara:\n${left}${ask}\n\n${links(planId, n)}`),
        await preview(plan, view, false),
      ],
    }
  }

  if (name === 'plan_guide') return { content: [text(args.topic === 'ops' ? OPS_DOC : GUIDE)] }

  if (name === 'plan_next') {
    const rev = await loadPlan(planId)
    if (!rev) return { content: [text(`Planen ${planId} finns inte`)], isError: true }
    const p = rev.plan
    const sources = (p.sources ?? []).filter((x) => x.view !== 'elevation')
    let open: number | undefined
    if (p.walls.length && p.openings.length && sources.some((x) => x.calibration)) open = (await auditPlan(planId, p)).filter((i) => i.level !== 'info').length
    const st = nextStep(p, { openIssues: open })
    return { content: [text(`Revision ${rev.meta.n}. Klart hittills: ${st.done.join(', ') || 'inget'}.\nNästa: ${st.next}${st.why ? `\n(${st.why})` : ''}`)] }
  }

  if (name === 'plan_trace') {
    const po = args.printed_outer_mm as { width?: unknown; length?: unknown } | undefined
    const printed = po && typeof po.width === 'number' && typeof po.length === 'number' ? { width: po.width, length: po.length } : undefined
    const dims = Array.isArray(args.dimensions) ? (args.dimensions as Array<{ a: { x: number; y: number }; b: { x: number; y: number }; mm: number; label?: string }>) : undefined
    const out = await autoTrace(planId, { sourceId: typeof args.source_id === 'string' ? args.source_id : undefined, printed, dimensions: dims })
    return { content: [text(out.text), ...(out.png ? [{ type: 'image' as const, data: out.png.toString('base64'), mimeType: 'image/png' }] : [])], ...(out.isError ? { isError: true } : {}) }
  }

  if (name === 'plan_audit' || name === 'plan_fix' || name === 'plan_view') {
    const rev = await loadPlan(planId)
    if (!rev) return { content: [text(`Planen ${planId} finns inte`)], isError: true }
    const po = args.printed_outer_mm as { width?: unknown; length?: unknown } | undefined
    const printed = po && typeof po.width === 'number' && typeof po.length === 'number' ? { width: po.width, length: po.length } : undefined
    const sourceId = typeof args.source_id === 'string' ? args.source_id : undefined
    const overlay = async (plan: Plan, rect?: { x: number; y: number; w: number; h: number }, what: 'overlay' | 'source' = 'overlay') => {
      const sid = sourceIdOf(plan, sourceId)
      if (!sid) return null
      const r = resolveSource(plan, sid)
      const area = rect ?? { x: r.x, y: r.y, w: r.widthPx * r.mmPerPx, h: r.heightPx * r.mmPerPx }
      const v = await scanView(planId, plan, r, area, { overlay: what === 'overlay', view, maxPx: 1400 })
      return { type: 'image' as const, data: v.png.toString('base64'), mimeType: 'image/png' }
    }

    if (name === 'plan_view') {
      const what = args.what === 'plan' ? 'plan' : args.what === 'source' ? 'source' : 'overlay'
      if (what === 'plan') return { content: [text(`Revision ${rev.meta.n}`), await preview(rev.plan, view, false)] }
      const r = args.rect as { x?: unknown; y?: unknown; w?: unknown; h?: unknown } | undefined
      const rect = r && [r.x, r.y, r.w, r.h].every((n) => typeof n === 'number') && (r.w as number) > 0 && (r.h as number) > 0 ? (r as { x: number; y: number; w: number; h: number }) : undefined
      const img = await overlay(rev.plan, rect, what)
      if (!img) return { content: [text('Planen har ingen källritning. Visar planbladet.'), await preview(rev.plan, view, false)] }
      return { content: [text(`Revision ${rev.meta.n}, ${what === 'overlay' ? 'planen över ritningen' : 'ritningen'}; rutnätet är i mm${rect ? '' : ' (hela ritningen)'}.`), img] }
    }

    if (name === 'plan_audit') {
      const items = await auditPlan(planId, rev.plan, { sourceId, printed })
      const content: ToolResult['content'] = [text(`Revision ${rev.meta.n}.\n${describeAudit(items)}`)]
      if (args.image) {
        const img = await overlay(rev.plan)
        if (img) content.push(img)
      }
      return { content }
    }

    // plan_fix
    const apply = args.apply
    const set = Array.isArray(args.set) ? (args.set as Array<Record<string, unknown>>) : []
    if (!apply && !set.length) return { content: [text('Ange apply (id från plan_audit, eller "alla") och/eller set (lista med ändringar).')], isError: true }
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
      if (v.errors.length) return { content: [text(`Ingen ändring sparades:\n${v.errors.join('\n')}`)], isError: true }
      ops.push(...v.ops)
      notes.push(`${set.length} ändringar`)
    }
    if (!ops.length) return { content: [text(`Inget att ändra.\n${notes.join('\n')}`)], isError: true }
    const res = await editPlan(planId, ops, typeof args.base_revision === 'number' ? args.base_revision : rev.meta.n, 'claude', String(args.message ?? 'Rättat (plan_fix)'))
    if (res.status !== 200) return { content: [text(`Ingen ändring sparades:\n${res.errors.join('\n')}${res.status === 409 ? '\nLäs planen igen (plan_get) och försök mot senaste revisionen.' : ''}`)], isError: true }
    const left = (await auditPlan(planId, res.plan, { sourceId, printed })).filter((i) => i.level !== 'info')
    return { content: [text(`Sparad som revision ${res.revision.n}.\n${notes.map((n) => `- ${n}`).join('\n')}\nKvar: ${left.length ? `${left.length} anmärkningar (${left.slice(0, 5).map((i) => i.id).join(', ')}${left.length > 5 ? ', …' : ''}) – plan_audit visar dem.` : 'inga anmärkningar mot ritningen.'}`)] }
  }

  if (name === 'plan_upload_link') {
    if (!(await loadPlan(planId))) return { content: [text(`Planen ${planId} finns inte`)], isError: true }
    return {
      content: [
        text(
          `Be användaren öppna länken och släppa ritningen där (logga in med den personliga nyckeln första gången):\n${host()}/plans/${planId}/upload\n\nBe om ritningens skala (t.ex. 1:100) och år. När användaren säger att den är uppladdad: läs planen med plan_get (revisionen har ökat), titta på källan med plan_scan_view och kalibrera mot angivna mått med plan_scan_calibrate. Läs plan_guide för resten av arbetsordningen.`,
        ),
      ],
    }
  }

  if (name === 'plan_list') {
    const plans = await listPlans()
    return { content: [text(plans.length ? plans.map((p) => `${p.id}: ${p.name} (rev ${p.revision}${p.issued.length ? `, utfärdad ${p.issued.at(-1)}` : ''})`).join('\n') : 'Inga planer.')] }
  }

  if (name === 'plan_create') {
    const res = await createPlan({ name: String(args.name ?? 'Planritning'), template: args.template === 'demo' ? 'demo' : 'empty', author: 'claude' })
    if ('errors' in res) return { content: [text(res.errors!.join('\n'))], isError: true }
    return { content: [text(`Skapad: ${res.plan.id}, revision ${res.revision.n}\n${links(res.plan.id, res.revision.n)}\n\nHar användaren en ritning eller bild att rita av? Anropa plan_upload_link nu och rita ingenting förrän ritningen är uppladdad. Rita det ritningen visar, inga ändringar om användaren inte ber om det.`), await preview(res.plan, 'efter', false)] }
  }

  if (name === 'plan_compare') {
    const a = await loadPlan(planId)
    const b = await loadPlan(String(args.reference_id ?? ''))
    if (!a || !b) return { content: [text('plan_id och reference_id måste finnas')], isError: true }
    const c = comparePlans(a.plan, b.plan, { matchMm: typeof args.match_mm === 'number' ? args.match_mm : undefined })
    const fit = (f: { scale: number; offset: number; rmsMm: number; n: number }) => `skala ${f.scale.toFixed(4)}, ${f.n} väggar, spridning ${f.rmsMm} mm`
    const lines = [
      `Inpassning x: ${fit(c.fit.x)}; y: ${fit(c.fit.y)}`,
      `Väggar (${c.walls.length} gemensamma): läge plan − referens, tjocklek plan − referens`,
      ...c.walls.map((w) => `- ${w.id} (${w.axis}): ${w.diffMm >= 0 ? '+' : ''}${w.diffMm} mm, tj ${w.thickness} mot ${w.refThickness} (${w.thicknessDiffMm >= 0 ? '+' : ''}${w.thicknessDiffMm})`),
      `Bara i referensen: ${c.wallsOnlyInRef.join(', ') || '–'}`,
      `Bara i planen: ${c.wallsOnlyInPlan.join(', ') || '–'}`,
      `Öppningar: ${c.openings.matched.length} matchade, ${c.openings.missed.length} saknas, ${c.openings.extra.length} extra`,
      ...c.openings.matched.map((m) => `- ✓ ${m.id} = ${m.refId}: mitt ${m.centreDiffMm} mm ifrån, bredd ${m.widthDiffMm >= 0 ? '+' : ''}${m.widthDiffMm}`),
      ...c.openings.missed.map((m) => `- ✗ saknas: ${m.refId} (${m.kind} i ${m.wallId})`),
      ...c.openings.extra.map((m) => `- + extra: ${m.id} (${m.kind} i ${m.wallId})`),
    ]
    return { content: [text(lines.join('\n'))] }
  }

  if (name === 'plan_import') {
    const input = args.plan as Partial<Plan> | undefined
    if (!input || !Array.isArray(input.walls) || !input.sheet) return { content: [text('plan med walls och sheet krävs')], isError: true }
    const plan = { openings: [], fixtures: [], rooms: [], dimensions: [], notes: [], ...input } as Plan
    // Sources and underlay point at another plan's files; they don't come along.
    delete plan.underlay
    const from = typeof args.copy_sources_from === 'string' ? args.copy_sources_from : undefined
    const wanted = from ? (plan.sources ?? []) : []
    delete plan.sources
    const res = await createPlan({ name: String(args.name ?? input.name ?? 'Planritning'), plan, author: 'claude' })
    if (!('errors' in res) && wanted.length && from) {
      // Copy each drawing's image into the new plan and point at it.
      const copied = []
      for (const src of wanted) {
        const name = decodeURIComponent(src.src.split('/').pop() ?? '')
        const data = await getAsset(from, name)
        if (!data) continue
        copied.push({ ...src, src: await putAsset(res.plan.id, name, data, 'image/png') })
      }
      const ops: Op[] = copied.map((item) => ({ op: 'add', kind: 'source', item }))
      const ed = await editPlan(res.plan.id, ops, res.revision.n, 'claude', `Källritningar kopierade från ${from}`)
      if (ed.status === 200) return { content: [text(`Importerad: ${res.plan.id}, revision ${ed.revision.n} (${copied.length} källritningar kopierade)\n${links(res.plan.id, ed.revision.n)}`)] }
    }
    if ('errors' in res) return { content: [text(`Kunde inte importera:\n${res.errors!.join('\n')}`)], isError: true }
    return { content: [text(`Importerad: ${res.plan.id}, revision ${res.revision.n}\n${links(res.plan.id, res.revision.n)}`), await preview(res.plan, 'efter', false)] }
  }

  if (name === 'plan_get') {
    const rev = await loadPlan(planId, typeof args.revision === 'number' ? args.revision : undefined)
    if (!rev) return { content: [text(`Planen ${planId} finns inte`)], isError: true }
    const only = Array.isArray(args.only) ? (args.only.filter((x): x is Section => (SECTIONS as readonly string[]).includes(String(x))) as Section[]) : undefined
    let body: string
    if (typeof args.since === 'number') {
      const old = await loadPlan(planId, args.since)
      if (!old) return { content: [text(`Revision ${args.since} finns inte`)], isError: true }
      body = changedSince(old.plan, rev.plan) || 'Inget har ändrats sedan dess.'
      body = `Ändrat sedan revision ${args.since}:\n${body}`
    } else body = summarisePlan(rev.plan, only?.length ? only : undefined)
    const parts: Content = [text(`Revision ${rev.meta.n} (${rev.meta.message})\n${body}\n\n${links(planId, rev.meta.n)}`)]
    if (args.include_json) parts.push(text(JSON.stringify({ ...rev.plan, underlay: rev.plan.underlay ? { ...rev.plan.underlay, src: '…' } : undefined })))
    const narrow = (only?.length ?? 0) > 0 || typeof args.since === 'number'
    if (args.image === true || (args.image !== false && !narrow)) parts.push(await preview(rev.plan, view, !!args.with_underlay))
    return { content: parts }
  }

  if (name === 'plan_edit') {
    if (!Array.isArray(args.ops) || typeof args.base_revision !== 'number') return { content: [text('ops (lista) och base_revision (nummer) krävs')], isError: true }
    const before = await loadPlan(planId)
    const res = await editPlan(planId, args.ops as Op[], args.base_revision, 'claude', String(args.message ?? 'Ändring av Claude'))
    if (res.status !== 200) {
      const hint = res.status === 409 ? '\nLäs planen igen med plan_get och gör om ändringen mot den senaste revisionen.' : ''
      return { content: [text(`Ingen ändring sparades:\n${res.errors.join('\n')}${hint}`)], isError: true }
    }
    // Only what this edit changed in the findings: the model already knows the rest.
    const key = (f: { level: string; message: string }) => `${f.level}|${f.message}`
    const was = new Set(before ? checkPlan(before.plan).map(key) : [])
    const now = checkPlan(res.plan)
    const fresh = now.filter((f) => !was.has(key(f)))
    const gone = (before ? checkPlan(before.plan) : []).filter((f) => !now.some((n) => key(n) === key(f))).length
    const changes = changedSince(before?.plan ?? res.plan, res.plan)
    const text1 = `Sparad som revision ${res.revision.n}.\n${changes ? `Ändrat:\n${changes}\n` : ''}Nya anmärkningar: ${fresh.length ? `\n${fresh.map((f) => `- [${f.level}] ${f.message}`).join('\n')}` : 'inga'}${gone ? `\n${gone} tidigare anmärkningar är borta.` : ''}\nTotalt ${now.length} anmärkningar (plan_check listar alla).`
    return { content: args.image === true ? [text(text1), await preview(res.plan, view, false)] : [text(text1)] }
  }

  if (name === 'plan_check') {
    const rev = await loadPlan(planId)
    if (!rev) return { content: [text(`Planen ${planId} finns inte`)], isError: true }
    const findings = checkPlan(rev.plan)
    return { content: [text(`Revision ${rev.meta.n}:\n${findings.map((f) => `- [${f.level}] ${f.message}`).join('\n') || '- inga anmärkningar'}\n\nKontrollen visar vad ritningen behöver visa; den gör ingen juridisk bedömning.`)] }
  }

  if (name === 'plan_review') {
    const rev = await loadPlan(planId)
    if (!rev) return { content: [text(`Planen ${planId} finns inte`)], isError: true }
    const v = args.view === 'efter' ? 'efter' : 'fore'
    return { content: [text(`Revision ${rev.meta.n}, ${v === 'fore' ? 'före' : 'efter'}:\n${describeReview(reviewPlan(rev.plan, v), rev.plan.rooms)}`)] }
  }

  // plan_revisions
  const revs = await listRevisions(planId)
  return { content: [text(revs.map((r) => `${r.n}${r.issued ? ` (rev ${r.issued})` : ''} ${r.createdAt.slice(0, 16)} ${r.author}: ${r.message}`).join('\n') || 'Inga revisioner.')] }
}

// What a connector lists. The default is every tool. ?tools=basic: the short surface for smaller
// models and for people who only want the drawing made; the scan tools stay behind plan_trace,
// plan_audit and plan_fix.
const BASIC = ['plan_next', 'plan_create', 'plan_list', 'plan_upload_link', 'plan_trace', 'plan_audit', 'plan_fix', 'plan_view', 'plan_get', 'plan_finish', 'plan_guide']

export function toolsFor(profile?: string | null) {
  return profile === 'basic' ? PLAN_TOOLS.filter((t) => BASIC.includes(t.name)) : PLAN_TOOLS
}

export const instructionsFor = (profile?: string | null) => (profile === 'basic' ? BASIC_INSTRUCTIONS : INSTRUCTIONS)
