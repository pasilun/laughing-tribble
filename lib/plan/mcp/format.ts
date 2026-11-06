import { describeDoor } from '../scan/doors'
import { wallLength } from '../domain/geometry'
import { hasChanges } from '../domain/sheet'
import type { Plan, Pt, View } from '../domain/types'
import { sheetPng } from '../export'
import { getAsset } from '../storage/store'

// How a plan is told to Claude: the link list, the compact listing, what changed between two revisions, the picture.

export function host(): string {
  return process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:3000'
}

// A plan with nothing demolished or new is one sheet (befintlig); före/efter only when it has changes.
export function links(plan: Plan, rev: number): string {
  const h = host()
  const id = plan.id
  if (!hasChanges(plan))
    return [`Editor: ${h}/plans/${id}`, `PDF (planritning – befintlig): ${h}/api/plans/${id}/sheet?view=efter&format=pdf&rev=${rev}`, `DXF: ${h}/api/plans/${id}/sheet?view=efter&format=dxf&rev=${rev}`].join('\n')
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
  if (plan.zones?.length) {
    lines.push(`Ytor (${plan.zones.length}):`)
    for (const z of plan.zones) lines.push(`- ${z.id}: ${z.points.map((p) => `(${p.x},${p.y})`).join(' ')}${z.label ? ` "${z.label}"` : ''}${z.views ? ` [${z.views.join(', ')}]` : ''}`)
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

export async function preview(plan: Plan, view: View, withUnderlay: boolean): Promise<{ type: 'image'; data: string; mimeType: string }> {
  let p = plan
  if (withUnderlay && plan.underlay) {
    const name = decodeURIComponent(plan.underlay.src.split('/').pop() ?? '')
    const data = await getAsset(plan.id, name)
    if (data) p = { ...plan, underlay: { ...plan.underlay, src: `data:image/png;base64,${data.toString('base64')}` } }
  }
  const png = sheetPng(p, view, 1600, withUnderlay)
  return { type: 'image', data: png.toString('base64'), mimeType: 'image/png' }
}
