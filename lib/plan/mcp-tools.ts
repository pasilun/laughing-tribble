import { checkPlan } from './checks'
import { sheetPng } from './export'
import { wallLength } from './geometry'
import type { Op } from './ops'
import { describeDoor } from './scan/doors'
import { handleScanTool, SCAN_TOOLS } from './scan/tools'
import { createPlan, editPlan, loadPlan } from './service'
import { getAsset, listPlans, listRevisions, putAsset } from './store'
import type { Plan, View } from './types'

// Claude tools for floor plans. Claude never regenerates a plan: it reads
// it, then sends small operations against a known revision, and gets a
// rendered preview back to check its own work.

const OPS_DOC = `Operations (all lengths in whole millimetres; x to the right, y DOWN; ids are stable strings):
- {"op":"add","kind":"wall","item":{"id":"v1","a":{"x":0,"y":0},"b":{"x":4000,"y":0},"thickness":100,"phase":"existing"|"demolish"|"new","loadBearing"?:true,"fireRating"?:"EI60","fireRatingAfter"?:""|"EI60","apartmentBoundary"?:true}}
- {"op":"add","kind":"opening","item":{"id":"o1","wallId":"v1","kind":"door"|"opening"|"window","offset":1200,"width":900,"height"?:2100,"phase":"new","hinge"?:"a"|"b","swing"?:"left"|"right"}}  (offset = distance from the wall's a-end to the opening's near edge). hinge/swing: don't set them by eye — with a source drawing run plan_scan_doors; plan_get lists each door in words ("gångjärn vid västra karmen, öppnar mot norr") to check.
- {"op":"add","kind":"fixture","item":{"id":"i1","kind":"kitchen"|"stove"|"sink"|"radiator"|"exhaust"|"shaft"|"wc"|"shower"|"bath"|"plug"|"box","x":..,"y":..,"w":..,"d":..,"rotation"?:0,"phase":"existing","label"?:"..."}}  (x,y = centre)
- {"op":"add","kind":"room","item":{"id":"r1","name":"Kök","renamed"?:"Rum","goneAfter"?:true,"at":{"x":..,"y":..},"polygon"?:[{x,y},...]}}
- {"op":"add","kind":"dimension","item":{"id":"m1","a":{..},"b":{..},"offset":500}}
- {"op":"add","kind":"note","item":{"id":"n1","at":{..},"text":"..."}}
- {"op":"update","kind":"wall|opening|fixture|room|dimension|note","id":"…","patch":{…fields to change…}}
- {"op":"delete","kind":"…","id":"…"}  (deleting a wall deletes its openings)
- {"op":"moveVertex","from":{x,y},"to":{x,y}}  (moves every wall end at that point — joined walls follow)
- {"op":"moveWall","id":"v1","dx":100,"dy":0}  (walls joined at its ends stretch)
- {"op":"setWallLength","id":"v1","length":3500,"fixed":"a"|"b"}
- {"op":"setSheet","patch":{"paper":"A3"|"A4","orientation":"landscape"|"portrait","scale":50|100,"northAngle":0}}
- {"op":"setTitleBlock","patch":{"project","property","address","apartments","floor","drawingNumber","author","date"}}
Phases: "existing" = stays, "demolish" = exists today and is removed, "new" = added. Före shows today; efter marks rivs/ny.
All ops in one call succeed together or none are applied.`

export const PLAN_TOOLS = [
  {
    name: 'plan_list',
    description: 'Lists saved floor plans (planritningar) with their latest revision.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'plan_create',
    description:
      'Creates a new floor plan for an interior change (e.g. joining two apartments) and returns its id and editor link. Start empty and add walls with plan_edit, or pass a full plan. The user can also trace a scanned drawing in the editor.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Short name, e.g. "Väggöppning lgh 153–154"' },
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
      },
      required: ['plan_id'],
    },
  },
  {
    name: 'plan_edit',
    description: `Changes a floor plan with small operations and saves them as a new revision. Pass base_revision from plan_get; if the user has saved since, the call is rejected — read the plan again and redo the change. Returns the new revision, the permit checklist and a preview image: look at it and fix mistakes with another edit.\n\n${OPS_DOC}`,
    inputSchema: {
      type: 'object',
      properties: {
        plan_id: { type: 'string' },
        base_revision: { type: 'number' },
        message: { type: 'string', description: 'What changed, in Swedish, e.g. "Breddade öppningen till 1000 mm"' },
        ops: { type: 'array', items: { type: 'object' } },
        view: { type: 'string', enum: ['fore', 'efter'] },
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

export function summarisePlan(plan: Plan): string {
  const tb = plan.sheet.titleBlock
  const lines: string[] = []
  lines.push(`Plan "${plan.name}" (${plan.id}) – ${plan.sheet.paper} 1:${plan.sheet.scale}`)
  lines.push(`Ritningshuvud: ${JSON.stringify(tb)}`)
  lines.push(`Väggar (${plan.walls.length}):`)
  for (const w of plan.walls) {
    const flags = [w.loadBearing && 'bärande', w.fireRating && `brand ${w.fireRating}${w.fireRatingAfter !== undefined ? `→${w.fireRatingAfter || 'ingen'}` : ''}`, w.apartmentBoundary && 'lgh-skiljande']
      .filter(Boolean)
      .join(', ')
    lines.push(`- ${w.id}: (${w.a.x},${w.a.y})→(${w.b.x},${w.b.y}) längd ${Math.round(wallLength(w))} tj ${w.thickness} ${w.phase}${flags ? ` [${flags}]` : ''}`)
  }
  lines.push(`Öppningar (${plan.openings.length}):`)
  for (const o of plan.openings) {
    const w = plan.walls.find((x) => x.id === o.wallId)
    const swing = o.kind === 'door' && w ? `, ${describeDoor(w, o)}` : ''
    lines.push(`- ${o.id}: ${o.kind} i ${o.wallId} offset ${o.offset} bredd ${o.width}${o.height ? ` höjd ${o.height}` : ''} ${o.phase}${swing}`)
  }
  lines.push(`Inredning (${plan.fixtures.length}):`)
  for (const f of plan.fixtures) lines.push(`- ${f.id}: ${f.kind} @(${f.x},${f.y}) ${f.w}×${f.d} ${f.phase}${f.label ? ` "${f.label}"` : ''}`)
  lines.push(`Rum: ${plan.rooms.map((r) => `${r.id} "${r.name}${r.renamed ? `→${r.renamed}` : ''}" @(${r.at.x},${r.at.y})`).join('; ') || '–'}`)
  if (plan.dimensions.length) lines.push(`Mått: ${plan.dimensions.map((d) => `${d.id} (${d.a.x},${d.a.y})–(${d.b.x},${d.b.y})`).join('; ')}`)
  for (const src of plan.sources ?? [])
    lines.push(`Källa ${src.id} (${src.role}) "${src.name}": ${src.widthPx}×${src.heightPx} px, ${src.mmPerPx.toFixed(4)} mm/px vid (${src.x},${src.y})${src.calibration ? `, kalibrerad: ${src.calibration}` : ', ej kalibrerad'}`)
  if (plan.underlay) lines.push(`Underlag: ${plan.underlay.widthPx}×${plan.underlay.heightPx} px, ${plan.underlay.mmPerPx.toFixed(3)} mm/px vid (${plan.underlay.x},${plan.underlay.y})`)
  return lines.join('\n')
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

  if (name === 'plan_list') {
    const plans = await listPlans()
    return { content: [text(plans.length ? plans.map((p) => `${p.id}: ${p.name} (rev ${p.revision}${p.issued.length ? `, utfärdad ${p.issued.at(-1)}` : ''})`).join('\n') : 'Inga planer.')] }
  }

  if (name === 'plan_create') {
    const res = await createPlan({ name: String(args.name ?? 'Planritning'), template: args.template === 'demo' ? 'demo' : 'empty', author: 'claude' })
    if ('errors' in res) return { content: [text(res.errors!.join('\n'))], isError: true }
    return { content: [text(`Skapad: ${res.plan.id}, revision ${res.revision.n}\n${links(res.plan.id, res.revision.n)}`), await preview(res.plan, 'efter', false)] }
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
    const parts: Content = [text(`Revision ${rev.meta.n} (${rev.meta.message})\n${summarisePlan(rev.plan)}\n\n${links(planId, rev.meta.n)}`)]
    if (args.include_json) parts.push(text(JSON.stringify({ ...rev.plan, underlay: rev.plan.underlay ? { ...rev.plan.underlay, src: '…' } : undefined })))
    parts.push(await preview(rev.plan, view, !!args.with_underlay))
    return { content: parts }
  }

  if (name === 'plan_edit') {
    if (!Array.isArray(args.ops) || typeof args.base_revision !== 'number') return { content: [text('ops (lista) och base_revision (nummer) krävs')], isError: true }
    const res = await editPlan(planId, args.ops as Op[], args.base_revision, 'claude', String(args.message ?? 'Ändring av Claude'))
    if (res.status !== 200) {
      const hint = res.status === 409 ? '\nLäs planen igen med plan_get och gör om ändringen mot den senaste revisionen.' : ''
      return { content: [text(`Ingen ändring sparades:\n${res.errors.join('\n')}${hint}`)], isError: true }
    }
    const findings = checkPlan(res.plan)
    const checks = findings.length ? findings.map((f) => `- [${f.level}] ${f.message}`).join('\n') : '- inga anmärkningar'
    return {
      content: [text(`Sparad som revision ${res.revision.n}.\nKontroll:\n${checks}\n\n${summarisePlan(res.plan)}`), await preview(res.plan, view, false)],
    }
  }

  if (name === 'plan_check') {
    const rev = await loadPlan(planId)
    if (!rev) return { content: [text(`Planen ${planId} finns inte`)], isError: true }
    const findings = checkPlan(rev.plan)
    return { content: [text(`Revision ${rev.meta.n}:\n${findings.map((f) => `- [${f.level}] ${f.message}`).join('\n') || '- inga anmärkningar'}\n\nKontrollen visar vad ritningen behöver visa; den gör ingen juridisk bedömning.`)] }
  }

  // plan_revisions
  const revs = await listRevisions(planId)
  return { content: [text(revs.map((r) => `${r.n}${r.issued ? ` (rev ${r.issued})` : ''} ${r.createdAt.slice(0, 16)} ${r.author}: ${r.message}`).join('\n') || 'Inga revisioner.')] }
}
