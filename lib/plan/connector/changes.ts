import { brief } from '../mcp/format'
import type { Plan } from '../domain/types'
import type { Changed } from './types'

// What differs between two revisions, by id, in the same lists as `changedSince` in lib/plan/mcp/format.ts
// (vägg → kind 'wall', öppning → 'opening', inredning → 'fixture', rum → 'room', mått → 'dimension').
// what: `tillagd: ${brief(x)}`, `ändrad: ${brief(x)}` or `borttagen`. When the sheet or title block differs add
// { kind: 'sheet', id: 'sheet', what: 'ändrad' }. At most 40 entries; if there are more, the 41st is
// { kind: 'more', id: '', what: `… och ${n} till` } with n the number left out.
export function changedList(old: Plan, now: Plan): Changed[] {
  const out: Changed[] = []
  const lists: Array<[string, Array<{ id: string }>, Array<{ id: string }>]> = [
    ['wall', old.walls, now.walls],
    ['opening', old.openings, now.openings],
    ['fixture', old.fixtures, now.fixtures],
    ['room', old.rooms, now.rooms],
    ['dimension', old.dimensions, now.dimensions],
  ]
  for (const [kind, a, b] of lists) {
    const was = new Map(a.map((x) => [x.id, JSON.stringify(x)]))
    for (const x of b) {
      const w = was.get(x.id)
      if (w === undefined) out.push({ kind, id: x.id, what: `tillagd: ${brief(x)}` })
      else if (w !== JSON.stringify(x)) out.push({ kind, id: x.id, what: `ändrad: ${brief(x)}` })
    }
    for (const x of a) if (!b.some((y) => y.id === x.id)) out.push({ kind, id: x.id, what: 'borttagen' })
  }
  if (JSON.stringify(old.sheet) !== JSON.stringify(now.sheet)) out.push({ kind: 'sheet', id: 'sheet', what: 'ändrad' })
  if (out.length <= 40) return out
  return [...out.slice(0, 40), { kind: 'more', id: '', what: `… och ${out.length - 40} till` }]
}
