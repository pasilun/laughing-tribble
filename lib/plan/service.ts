import { applyOps, validatePlan, type Op } from './ops'
import { demoPlan } from './demo'
import { getHead, getRevision, nextLetter, saveRevision, type StoredRevision } from './store'
import type { Plan, Revision } from './types'

export function emptyPlan(id: string, name: string): Plan {
  return {
    id,
    name,
    sheet: {
      paper: 'A3',
      orientation: 'landscape',
      scale: 50,
      northAngle: 0,
      titleBlock: { project: name, property: '', address: '', apartments: '', floor: '', drawingNumber: 'A-01', author: '', date: new Date().toISOString().slice(0, 10), revision: '' },
    },
    walls: [],
    openings: [],
    fixtures: [],
    rooms: [],
    dimensions: [],
    notes: [],
  }
}

export function slugId(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
  return `${base || 'plan'}-${Math.random().toString(36).slice(2, 6)}`
}

export async function createPlan(input: { name: string; template?: 'empty' | 'demo'; plan?: Plan; author: Revision['author'] }) {
  const id = slugId(input.name)
  const plan: Plan = input.plan
    ? { ...input.plan, id, name: input.name }
    : input.template === 'demo'
      ? { ...demoPlan(id), name: input.name }
      : emptyPlan(id, input.name)
  const errors = validatePlan(plan)
  if (errors.length) return { errors }
  const revision = await saveRevision(plan, { author: input.author, message: 'Skapad' }, 0)
  return { plan, revision }
}

export async function editPlan(id: string, ops: Op[], base: number, author: Revision['author'], message: string) {
  const head = await getRevision(id)
  if (!head) return { status: 404 as const, errors: ['planen finns inte'] }
  if (head.meta.n !== base) return { status: 409 as const, errors: [`planen har ändrats – senaste revision är ${head.meta.n}`], head: head.meta.n }
  const { plan, errors } = applyOps(head.plan, ops)
  if (errors.length) return { status: 422 as const, errors }
  const revision = await saveRevision(plan, { author, message }, base)
  return { status: 200 as const, plan, revision }
}

// Marks the current state as issued: next revision letter in the title block.
export async function issuePlan(id: string, author: Revision['author']) {
  const head = await getHead(id)
  const cur = await getRevision(id)
  if (!head || !cur) return null
  const letter = nextLetter(head.issued)
  const plan: Plan = { ...cur.plan, sheet: { ...cur.plan.sheet, titleBlock: { ...cur.plan.sheet.titleBlock, revision: letter } } }
  const revision = await saveRevision(plan, { author, message: `Utfärdad rev ${letter}`, issued: letter }, cur.meta.n)
  return { plan, revision }
}

export async function loadPlan(id: string, rev?: number): Promise<StoredRevision | null> {
  return getRevision(id, rev)
}
