import type { Plan, Source, Underlay } from '@/lib/plan/domain/types'

// The drawings a plan is traced from. `plan.underlay` is the one shown under the plan in the editor; `plan.sources` are
// all the drawings the plan has (the ones added here, and the ones Claude or the upload page added). Showing one under
// the plan copies it into the underlay, and placing or calibrating the underlay is copied back to its source, so the
// two never disagree about where a drawing is.

export const asUnderlay = (s: Source, opacity = 0.5): Underlay => ({ src: s.src, widthPx: s.widthPx, heightPx: s.heightPx, mmPerPx: s.mmPerPx, x: s.x, y: s.y, rotation: s.rotation, opacity })

export const isShown = (plan: Plan, s: Source) => !!plan.underlay && plan.underlay.src === s.src

// A drawing that is the underlay but not (yet) one of the sources, as a source: it must not be lost when another is shown.
export function underlayAsSource(plan: Plan): Source | null {
  const u = plan.underlay
  if (!u || (plan.sources ?? []).some((s) => s.src === u.src)) return null
  const ids = new Set((plan.sources ?? []).map((s) => s.id))
  let n = 1
  while (ids.has(`ritning-${n}`)) n++
  return { id: `ritning-${n}`, name: `Ritning ${n}`, role: 'other', src: u.src, widthPx: u.widthPx, heightPx: u.heightPx, mmPerPx: u.mmPerPx, x: u.x, y: u.y, rotation: u.rotation }
}

// The plan with the source of the underlay moved and scaled like the underlay.
export function syncSource(plan: Plan): Plan {
  const u = plan.underlay
  if (!u || !plan.sources?.length) return plan
  let changed = false
  const sources = plan.sources.map((s) => {
    if (s.src !== u.src || (s.x === u.x && s.y === u.y && s.mmPerPx === u.mmPerPx && s.rotation === u.rotation)) return s
    changed = true
    return { ...s, x: u.x, y: u.y, mmPerPx: u.mmPerPx, rotation: u.rotation }
  })
  return changed ? { ...plan, sources } : plan
}

export function newSourceId(plan: Plan, label: string): string {
  const base =
    label
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24) || 'ritning'
  const ids = new Set((plan.sources ?? []).map((s) => s.id))
  let id = base
  for (let n = 2; ids.has(id); n++) id = `${base}-${n}`
  return id
}
