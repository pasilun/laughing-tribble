import { add, along, leftNormal, scale, wallDir } from './geometry'
import type { Finding } from './checks'
import { spaceGrid, type Space } from './rooms'
import { structureFindings } from './structure'
import type { Opening, Plan, Room, View, Wall } from './types'

// Reads a plan the way an architect walks it: who enters where, which room
// each door joins, whether every room can be reached and makes sense for its
// use. These are facts and flags for a reviewer to judge, not verdicts: a
// finding can be an oddity of the real building, so check the sources before
// "fixing" it. The rules are written out in docs/plan-review.md.

export type RoomKind = 'common' | 'entry' | 'wet' | 'kitchen' | 'closet' | 'habitable' | 'other'

// Swedish room names as they appear on drawings, old and new.
export function roomKind(r: Pick<Room, 'name' | 'apartment'>): RoomKind {
  const n = r.name.trim().toLowerCase()
  if (/trapp|loftgång|korridor|soprum|cykelrum/.test(n) && !r.apartment) return 'common'
  if (/wc|toa|bad|dusch|tvätt/.test(n)) return 'wet'
  if (/kök|kokvrå|^kv\.?$|kokskåp|pentry/.test(n)) return 'kitchen'
  if (/^(tamb\.?|tmb\.?|hall|entré|farstu|vindfång)/.test(n)) return 'entry'
  if (/^(g\.?|gard\.?|garderob|klk|klädkammare|förråd|skafferi|städ)$/.test(n)) return 'closet'
  if (/rum|sov|vardag|matvrå|matpl|arbet|bibliotek|salong|kammare/.test(n)) return 'habitable'
  return 'other'
}

// A passage: a door, or an opening without a door (a gap, an arch).
export type Link = { opening: Opening; wall: Wall; a: number; b: number } // space index per side, -1 = solid/outside the grid
export type Flat = { apartment: string; rooms: string[]; entrances: string[]; area: number }
export type Review = { findings: Finding[]; flats: Flat[]; links: Link[]; spaces: Space[] }

const STEP = 60 // mm past the wall face where a side is sampled
const MIN_PASSAGE = 500 // narrower than this is no door: a scan gap or a niche
const MIN_CLOSET = 400 // old wardrobe doors can be this narrow
const MIN_DOOR = 600
const MIN_ENTRANCE = 700 // an 8M door of the 1930s; new flats need more
const TOLERANCE = 20 // drawing and tracing accuracy

export function reviewPlan(plan: Plan, view: View = 'fore'): Review {
  const findings: Finding[] = []
  const grid = spaceGrid(plan, view)
  if (!grid) return { findings, flats: [], links: [], spaces: [] }
  const { spaces, at } = grid
  const rooms = new Map(plan.rooms.map((r) => [r.id, r]))
  const walls = new Map(plan.walls.map((w) => [w.id, w]))
  const shown = (o: Opening) => (view === 'fore' ? o.phase !== 'new' : o.phase !== 'demolish')
  const flatTag = (k: number) => {
    const f = [...new Set(spaces[k].rooms.map((id) => rooms.get(id)!.apartment).filter(Boolean))]
    return f.length ? ` (lgh ${f.join('/')})` : ''
  }
  const name = (k: number) => (k < 0 ? 'vägg' : spaces[k].rooms.length ? spaces[k].rooms.map((id) => rooms.get(id)!.name).join('/') + flatTag(k) : (spaces[k].open ? (stairOutside ? 'trapphuset (utanför ritningen)' : 'utsidan') : 'namnlöst utrymme'))
  const kinds = (k: number) => new Set(k < 0 ? [] : spaces[k].rooms.map((id) => roomKind(rooms.get(id)!)))
  const flatOf = (k: number) => new Set(k < 0 ? [] : spaces[k].rooms.map((id) => rooms.get(id)!.apartment).filter((a): a is string => !!a))
  // A plan of a few flats often stops at the stair hall: then the outside of the drawing is the common side.
  const stairOutside = !plan.rooms.some((r) => roomKind(r) === 'common')
  const isCommon = (k: number) => k >= 0 && (spaces[k].rooms.length > 0 ? [...kinds(k)].every((x) => x === 'common') : stairOutside && spaces[k].open)
  const m2 = (a: number) => `${(a / 1e6).toFixed(1).replace('.', ',')} m²`

  // Which space lies on each side of every opening.
  const side = (w: Wall, o: Opening, sign: number) => {
    const n = leftNormal(wallDir(w))
    const mid = along(w, o.offset + o.width / 2)
    for (const d of [w.thickness / 2 + STEP, w.thickness / 2 + 3 * STEP]) {
      const k = at(add(mid, scale(n, sign * d)))
      if (k >= 0) return k
    }
    return -1
  }
  const links: Link[] = []
  const windows = new Set<number>()
  for (const o of plan.openings.filter(shown)) {
    const w = walls.get(o.wallId)
    if (!w) continue
    const a = side(w, o, 1)
    const b = side(w, o, -1)
    if (o.kind === 'window' || w.exterior) {
      for (const k of [a, b]) if (k >= 0 && !spaces[k].open) windows.add(k)
      continue
    }
    links.push({ opening: o, wall: w, a, b })
  }

  const degree = new Map<number, Link[]>()
  for (const l of links) for (const k of new Set([l.a, l.b])) if (k >= 0) degree.set(k, [...(degree.get(k) ?? []), l])

  // ── each passage on its own ──
  for (const l of links) {
    const { opening: o } = l
    const what = o.kind === 'door' ? 'Dörren' : 'Öppningen'
    if (l.a < 0 || l.b < 0) {
      findings.push({ level: 'error', code: 'leads-nowhere', ref: o.id, message: `${what} ${o.id} i ${l.wall.id} leder in i en vägg eller massa (${name(l.a)} | ${name(l.b)})` })
      continue
    }
    if (l.a === l.b && !o.through) {
      findings.push({ level: 'warning', code: 'same-space', ref: o.id, message: `${what} ${o.id} har samma utrymme (${name(l.a)}) på båda sidor – väggen är en fristående bit eller öppningen sitter fel` })
      continue
    }
    for (const k of [l.a, l.b]) {
      if (spaces[k].open && !stairOutside) findings.push({ level: 'error', code: 'leads-outside', ref: o.id, message: `${what} ${o.id} i innervägg ${l.wall.id} leder ut ur byggnaden` })
      else if (!spaces[k].rooms.length && !spaces[k].open) findings.push({ level: 'warning', code: 'unnamed-space', ref: o.id, message: `${what} ${o.id} leder till ett utrymme utan rumsnamn (${m2(spaces[k].area)}) från ${name(l.a === k ? l.b : l.a)}` })
    }
    if (o.width < ([l.a, l.b].some((k) => kinds(k).has('closet')) ? MIN_CLOSET : MIN_PASSAGE)) findings.push({ level: 'warning', code: 'too-narrow', ref: o.id, message: `${what} ${o.id} är ${o.width} mm – för smal för att gå igenom; en lucka i skanningen eller en nisch?` })
    // Doors that slam into small or wet rooms.
    if (o.kind === 'door' && o.width >= MIN_PASSAGE) {
      const into = (o.swing ?? 'left') === 'left' ? l.a : l.b
      const from = into === l.a ? l.b : l.a
      const k = kinds(into)
      if (k.has('wet') && !kinds(from).has('wet')) findings.push({ level: 'warning', code: 'wc-door-inward', ref: o.id, message: `Dörren ${o.id} till ${name(into)} slår inåt – våtrumsdörrar slår utåt så att de inte tar golvyta eller kan blockeras` })
      else if (k.has('closet') || spaces[into].area < 2.2 * o.width * o.width)
        findings.push({ level: 'warning', code: 'door-into-small', ref: o.id, message: `Dörren ${o.id} slår in i ${name(into)} (${m2(spaces[into].area)}) – för litet för dörrbladet; slå åt ${name(from)} i stället` })
    }
  }

  // ── each space ──
  spaces.forEach((sp, k) => {
    if (sp.open) return
    const links = degree.get(k) ?? []
    const ks = kinds(k)
    if (!sp.rooms.length) {
      // A sealed pocket is often a shaft or a chimney; worth a look when it is room-sized.
      if (!links.length && sp.area >= 0.5e6 && !plan.fixtures.some((f) => f.kind === 'shaft' && at(f) === k))
        findings.push({ level: 'info', code: 'sealed', message: `Instängt utrymme utan dörr och namn vid (${Math.round(sp.at.x)}, ${Math.round(sp.at.y)}), ${m2(sp.area)} – schakt, rökkanal eller ett rum som saknar dörr?` })
      return
    }
    if (sp.rooms.length && !links.length)
      findings.push({ level: 'error', code: 'no-door', ref: sp.rooms[0], message: `${name(k)} har ingen dörr eller öppning` })
    if (ks.has('wet')) {
      const doors = links.filter((l) => l.a !== l.b)
      if (doors.length > 1) findings.push({ level: 'warning', code: 'wet-doors', ref: sp.rooms[0], message: `${name(k)} har ${doors.length} dörrar (${doors.map((l) => l.opening.id).join(', ')}) – ett våtrum har normalt en` })
      for (const l of doors) {
        const other = l.a === k ? l.b : l.a
        if (other < 0) continue
        if (kinds(other).has('kitchen')) findings.push({ level: 'error', code: 'wc-to-kitchen', ref: l.opening.id, message: `${name(k)} öppnar direkt mot ${name(other)} (${l.opening.id}) – WC får inte nås direkt från kök` })
        else if (!kinds(other).has('entry') && !kinds(other).has('wet') && !isCommon(other))
          findings.push({ level: 'info', code: 'wc-from-room', ref: l.opening.id, message: `${name(k)} nås från ${name(other)} (${l.opening.id}), inte från tambur/hall` })
      }
    }
    if (ks.has('closet') && !ks.has('habitable') && links.length > 1)
      findings.push({ level: 'warning', code: 'closet-doors', ref: sp.rooms[0], message: `${name(k)} har ${links.length} öppningar – en garderob har en dörr` })
    if ((ks.has('habitable') || ks.has('kitchen')) && !windows.has(k) && !ks.has('wet'))
      findings.push({ level: ks.has('habitable') ? 'warning' : 'info', code: 'no-window', ref: sp.rooms[0], message: `${name(k)} har inget fönster${ks.has('habitable') ? ' – ett bostadsrum behöver dagsljus' : ''}` })
  })

  // ── each flat: one way in, every room reachable, no doors to the neighbours ──
  const apartments = [...new Set(plan.rooms.map((r) => r.apartment).filter((a): a is string => !!a))].sort()
  const flats: Flat[] = []
  for (const l of links) {
    if (l.a < 0 || l.b < 0) continue
    const fa = flatOf(l.a)
    const fb = flatOf(l.b)
    if (fa.size && fb.size && ![...fa].some((x) => fb.has(x)))
      findings.push({ level: 'error', code: 'between-flats', ref: l.opening.id, message: `Öppning ${l.opening.id} går mellan lgh ${[...fa].join('/')} (${name(l.a)}) och lgh ${[...fb].join('/')} (${name(l.b)})` })
  }
  for (const apt of apartments) {
    const own = [...spaces.keys()].filter((k) => flatOf(k).has(apt))
    const ownSet = new Set(own)
    const entrances = links.filter((l) => (ownSet.has(l.a) && isCommon(l.b)) || (ownSet.has(l.b) && isCommon(l.a)))
    const roomIds = own.flatMap((k) => spaces[k].rooms.filter((id) => rooms.get(id)!.apartment === apt))
    flats.push({ apartment: apt, rooms: roomIds, entrances: entrances.map((l) => l.opening.id), area: own.reduce((s, k) => s + spaces[k].area, 0) })
    if (!entrances.length) findings.push({ level: 'error', code: 'no-entrance', message: `Lgh ${apt} har ingen entré från trapphus/allmänt utrymme` })
    if (entrances.length > 1) findings.push({ level: 'warning', code: 'entrances', message: `Lgh ${apt} har ${entrances.length} entréer (${entrances.map((l) => l.opening.id).join(', ')}) – normalt en` })
    for (const l of entrances) {
      const inner = ownSet.has(l.a) ? l.a : l.b
      if (!kinds(inner).has('entry')) findings.push({ level: 'warning', code: 'entrance-room', ref: l.opening.id, message: `Entrén ${l.opening.id} till lgh ${apt} leder direkt in i ${name(inner)} – normalt in i tambur/hall` })
      if (l.opening.width < MIN_ENTRANCE - TOLERANCE) findings.push({ level: 'warning', code: 'entrance-width', ref: l.opening.id, message: `Entrédörren ${l.opening.id} till lgh ${apt} är ${l.opening.width} mm – minst ${MIN_ENTRANCE} mm` })
    }
    // Walk the flat from its entrances; a room reached only through a wet room is noted.
    const reach = new Set<number>()
    const viaDry = new Set<number>()
    const start = entrances.map((l) => (ownSet.has(l.a) ? l.a : l.b))
    const walk = (seed: number[], set: Set<number>, skipWet: boolean) => {
      const stack = [...seed]
      for (const k of seed) set.add(k)
      while (stack.length) {
        const k = stack.pop()!
        if (skipWet && kinds(k).has('wet') && !seed.includes(k)) continue
        for (const l of degree.get(k) ?? []) {
          const o = l.a === k ? l.b : l.a
          if (o >= 0 && ownSet.has(o) && !set.has(o)) { set.add(o); stack.push(o) }
        }
      }
    }
    walk(start, reach, false)
    walk(start, viaDry, true)
    if (start.length)
      for (const k of own) {
        if (!reach.has(k)) findings.push({ level: 'error', code: 'unreachable', ref: spaces[k].rooms[0], message: `${name(k)} i lgh ${apt} går inte att nå från entrén` })
        else if (!viaDry.has(k) && !kinds(k).has('wet')) findings.push({ level: 'warning', code: 'through-wet', ref: spaces[k].rooms[0], message: `${name(k)} i lgh ${apt} nås bara genom ett våtrum` })
      }
    for (const l of links) {
      const sides = [l.a, l.b]
      if (sides.every((k) => ownSet.has(k)) && l.opening.width >= MIN_PASSAGE && l.opening.width < MIN_DOOR && !sides.some((k) => kinds(k).has('closet')))
        findings.push({ level: 'info', code: 'door-width', ref: l.opening.id, message: `Dörren ${l.opening.id} (${name(l.a)}–${name(l.b)}) är ${l.opening.width} mm – smalare än ${MIN_DOOR} mm` })
    }
  }
  // Labelled rooms that no flat or common space claims, in a plan that has flats.
  if (apartments.length)
    for (const r of plan.rooms) if (!r.apartment && roomKind(r) !== 'common') findings.push({ level: 'info', code: 'no-apartment', ref: r.id, message: `${r.name} (${r.id}) hör inte till någon lägenhet` })

  findings.push(...structureFindings(plan, view, grid, (id) => roomKind(rooms.get(id)!), flatOf, name))
  return { findings: dedupe(findings), flats, links, spaces }
}

function dedupe(fs: Finding[]): Finding[] {
  const seen = new Set<string>()
  return fs.filter((f) => !seen.has(f.code + f.message) && seen.add(f.code + f.message))
}

export function describeReview(r: Review, rooms: Room[]): string {
  const byId = new Map(rooms.map((x) => [x.id, x]))
  const flats = r.flats.map((f) => `- lgh ${f.apartment}: ${f.rooms.map((id) => byId.get(id)?.name ?? id).join(', ')}; entré ${f.entrances.join(', ') || '–'}`).join('\n')
  const order = { error: 0, warning: 1, info: 2 }
  const fs = [...r.findings].sort((a, b) => order[a.level] - order[b.level]).map((f) => `- [${f.level}] ${f.message}`).join('\n')
  return `${flats ? `Lägenheter:\n${flats}\n\n` : ''}Granskning (åtkomst, dörrar, rum):\n${fs || '- inga anmärkningar'}`
}
