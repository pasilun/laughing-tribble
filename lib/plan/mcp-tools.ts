import { checkPlan } from './checks'
import { GUIDE } from './guide'
import { describeReview, reviewPlan } from './review'
import { comparePlans } from './compare'
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
- {"op":"setSheet","patch":{"paper":"A3"|"A4","orientation":"landscape"|"portrait","scale":50|100|150|200,"northAngle":0,"doorSwings":false}}  (doorSwings false = doors without swing arcs, for overview sheets)
- {"op":"setTitleBlock","patch":{"project","property","address","apartments","floor","drawingNumber","author","date"}}
Phases: "existing" = stays, "demolish" = exists today and is removed, "new" = added. Före shows today; efter marks rivs/ny.
All ops in one call succeed together or none are applied.`

export const PLAN_TOOLS = [
  {
    name: 'plan_guide',
    description: 'The working order for making a plan that can be trusted: getting the drawing into the plan, calibrating, tracing, comparing, reviewing, filling in the sheet. Read it before drawing anything from a drawing or photo.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'plan_upload_link',
    description:
      'Returns a link where the user drops a drawing (PNG, JPG, TIF or PDF, up to about 4 MB) so it becomes a source of the plan. A chat attachment cannot be passed to a tool, so use this whenever the user has a drawing or photo to trace. Afterwards read the plan (plan_get), view the source (plan_scan_view) and calibrate it (plan_scan_calibrate).',
    inputSchema: { type: 'object', properties: { plan_id: { type: 'string' } }, required: ['plan_id'] },
  },
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
  if (plan.masses?.length) {
    lines.push(`Massor (${plan.masses.length}):`)
    for (const m of plan.masses) lines.push(`- ${m.id}: ${m.points.map((p) => `(${p.x},${p.y})`).join(' ')} ${m.phase}${m.loadBearing ? ' [bärande]' : ''}`)
  }
  lines.push(`Öppningar (${plan.openings.length}):`)
  for (const o of plan.openings) {
    const w = plan.walls.find((x) => x.id === o.wallId)
    const swing = o.kind === 'door' && w ? `, ${describeDoor(w, o)}` : ''
    lines.push(`- ${o.id}: ${o.kind} i ${o.wallId} offset ${o.offset} bredd ${o.width}${o.height ? ` höjd ${o.height}` : ''} ${o.phase}${swing}${o.through ? ', genomgång (rummen går ihop)' : ''}${o.beam ? `, balk ${o.beam}` : ''}`)
  }
  lines.push(`Inredning (${plan.fixtures.length}):`)
  for (const f of plan.fixtures) lines.push(`- ${f.id}: ${f.kind} @(${f.x},${f.y}) ${f.w}×${f.d} ${f.phase}${f.label ? ` "${f.label}"` : ''}`)
  lines.push(`Rum: ${plan.rooms.map((r) => `${r.id} "${r.name}${r.renamed ? `→${r.renamed}` : ''}" @(${r.at.x},${r.at.y})`).join('; ') || '–'}`)
  if (plan.dimensions.length) lines.push(`Mått: ${plan.dimensions.map((d) => `${d.id} (${d.a.x},${d.a.y})–(${d.b.x},${d.b.y})`).join('; ')}`)
  for (const src of plan.sources ?? [])
    lines.push(`Källa ${src.id} (${src.role}) "${src.name}": ${src.widthPx}×${src.heightPx} px, ${src.mmPerPx.toFixed(4)} mm/px vid (${src.x},${src.y})${src.calibration ? `, kalibrerad: ${src.calibration}` : ', ej kalibrerad'}`)
  if (plan.underlay) lines.push(`Underlag: ${plan.underlay.widthPx}×${plan.underlay.heightPx} px, ${plan.underlay.mmPerPx.toFixed(3)} mm/px vid (${plan.underlay.x},${plan.underlay.y})`)
  const sources = plan.sources ?? []
  if (plan.walls.length && !sources.length && !plan.underlay)
    lines.push('OBS: planen har ingen källritning – måtten är uppskattade, inte avritade. Be användaren ladda upp ritningen (plan_upload_link) och läs plan_guide.')
  else if (sources.length && !sources.some((x) => x.calibration))
    lines.push('OBS: ingen källa är kalibrerad mot angivna mått – kalibrera med plan_scan_calibrate innan du ritar av den.')
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

  if (name === 'plan_guide') return { content: [text(GUIDE)] }

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
    return { content: [text(`Skapad: ${res.plan.id}, revision ${res.revision.n}\n${links(res.plan.id, res.revision.n)}`), await preview(res.plan, 'efter', false)] }
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
