import { clashes } from './clear'
import { validatePlan } from './ops'
import { layoutSheet } from './sheet'
import type { Plan } from './types'

// Checks a plan against what an anmälan for interior work needs to show.
// These are flags for the user to act on — never a legal judgment.

export type Finding = {
  level: 'error' | 'warning' | 'info'
  code: string
  message: string
  ref?: string
}

const TITLE_FIELDS: Array<[keyof Plan['sheet']['titleBlock'], string]> = [
  ['property', 'fastighetsbeteckning'],
  ['address', 'adress'],
  ['apartments', 'lägenhetsnummer'],
  ['floor', 'våningsplan'],
  ['drawingNumber', 'ritningsnummer'],
  ['date', 'datum'],
  ['author', 'ritad av'],
]

export function checkPlan(plan: Plan): Finding[] {
  const out: Finding[] = []
  for (const e of validatePlan(plan)) out.push({ level: 'error', code: 'invalid', message: e })

  const tb = plan.sheet.titleBlock
  for (const [key, label] of TITLE_FIELDS) {
    if (!String(tb[key] ?? '').trim()) out.push({ level: 'error', code: 'title-block', message: `Ritningshuvudet saknar ${label}` })
  }
  if (/brf|bostadsrättsförening/i.test(tb.property))
    out.push({ level: 'warning', code: 'property-name', message: `"${tb.property}" ser ut som föreningens namn – fastighetsbeteckningen (t.ex. "Stockholm Gnejsen 6") ska stå i ritningshuvudet` })

  const L = layoutSheet(plan)
  if (!L.fits)
    out.push({ level: 'error', code: 'fit', message: `Planen får inte plats på ${plan.sheet.paper} i skala 1:${plan.sheet.scale} – byt till större papper eller 1:100` })

  if (plan.walls.length === 0) out.push({ level: 'error', code: 'empty', message: 'Planen har inga väggar' })

  const changes =
    plan.walls.some((w) => w.phase !== 'existing') ||
    plan.openings.some((o) => o.phase !== 'existing') ||
    plan.fixtures.some((f) => f.phase !== 'existing')
  if (!changes) out.push({ level: 'warning', code: 'no-change', message: 'Inga ändringar är markerade (rivs/ny) – före och efter blir likadana' })

  const walls = new Map(plan.walls.map((w) => [w.id, w]))
  // An opening that runs into another wall: a window through a corner, a door against a stair wall.
  const KIND = { window: 'Fönster', door: 'Dörr', opening: 'Öppning' } as const
  for (const o of plan.openings) {
    const w = walls.get(o.wallId)
    if (!w) continue
    const hit = clashes(plan, w, o.offset, o.width)
    if (hit.length)
      out.push({ level: 'error', code: 'opening-in-wall', ref: o.id, message: `${KIND[o.kind]} ${o.id} går in i ${hit.join(', ')} – flytta eller beskär öppningen` })
  }
  for (const w of plan.walls) {
    if (w.phase === 'demolish' && w.loadBearing)
      out.push({ level: 'warning', code: 'load-bearing', ref: w.id, message: `Bärande vägg ${w.id} rivs – kräver konstruktionshandling och beräkning` })
    if (w.phase === 'demolish' && (w.fireRating || w.apartmentBoundary))
      out.push({ level: 'warning', code: 'fire', ref: w.id, message: `Vägg ${w.id} är brandcellsgräns och rivs – brandskyddsbeskrivning krävs` })
  }
  for (const m of plan.masses ?? []) {
    if (m.phase === 'demolish' && m.loadBearing)
      out.push({ level: 'warning', code: 'load-bearing', ref: m.id, message: `Bärande murmassa ${m.id} rivs – kräver konstruktionshandling och beräkning` })
  }
  for (const o of plan.openings) {
    const w = walls.get(o.wallId)
    if (!w || o.phase !== 'new') continue
    if (w.loadBearing)
      out.push({ level: 'warning', code: 'load-bearing', ref: o.id, message: `Ny öppning ${o.id} i bärande vägg – kräver konstruktörsutlåtande, ev. avväxling` })
    if (w.fireRating || w.apartmentBoundary) {
      out.push({ level: 'warning', code: 'fire', ref: o.id, message: `Ny öppning ${o.id} i lägenhetsskiljande vägg/brandcellsgräns – brandskyddsbeskrivning krävs` })
      if (w.fireRatingAfter === undefined && w.fireRating)
        out.push({ level: 'warning', code: 'fire-after', ref: w.id, message: `Vägg ${w.id} har en ny öppning men är fortfarande ritad som brandcellsgräns (${w.fireRating}) i efter-planen – ange brandcellsgränsen efter ändringen` })
    }
    if (!o.height) out.push({ level: 'info', code: 'opening-height', ref: o.id, message: `Ny öppning ${o.id} saknar höjd – ange den om konstruktören behöver den` })
  }
  const removedKitchen = plan.fixtures.some((f) => (f.kind === 'kitchen' || f.kind === 'sink' || f.kind === 'stove') && f.phase === 'demolish')
  if (removedKitchen && !plan.fixtures.some((f) => f.kind === 'plug' && f.phase === 'new'))
    out.push({ level: 'warning', code: 'plug', message: 'Kök/disk rivs men inga proppade anslutningar (P) är markerade' })
  if (plan.fixtures.some((f) => f.kind === 'exhaust' && f.phase !== 'existing'))
    out.push({ level: 'info', code: 'ventilation', message: 'Ventilationen ändras – flöden ska injusteras mot senaste OVK och ny OVK utföras' })
  if (plan.rooms.length === 0) out.push({ level: 'warning', code: 'rooms', message: 'Inga rumsnamn – ange rummens funktion' })
  return out
}
