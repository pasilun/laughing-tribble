import { randomBytes } from 'crypto'
import { applyOps, validatePlan, type Op } from './domain/ops'
import { demoPlan } from './domain/demo'
import { getAsset, getHead, getRevision, nextLetter, putAsset, saveRevision, setTags, type StoredRevision } from './storage/store'
import type { Plan, Revision } from './domain/types'

function emptyPlan(id: string, name: string): Plan {
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

function slugId(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30)
  // Long random suffix: ids end up in links and must not be guessable.
  return `${base || 'plan'}-${randomBytes(8).toString('hex')}`
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

// Saves a whole plan (what the editor sends) as a new revision, if it is a valid plan for this id.
export async function replacePlan(id: string, plan: Plan, base: number, author: Revision['author'], message: string) {
  if (plan.id !== id) return { status: 400 as const, errors: ['plan.id stämmer inte'] }
  const errors = validatePlan(plan)
  if (errors.length) return { status: 422 as const, errors }
  return { status: 200 as const, revision: await saveRevision(plan, { author, message }, base) }
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

// Sets a plan's tags (replaces them). Not a revision of the drawing.
export async function tagPlan(id: string, tags: unknown): Promise<{ status: 400 | 404; errors: string[] } | { status: 200; tags: string[] }> {
  if (!Array.isArray(tags)) return { status: 400, errors: ['tags (lista) krävs'] }
  const clean = await setTags(id, tags)
  return clean ? { status: 200, tags: clean } : { status: 404, errors: ['planen finns inte'] }
}

// A new plan from a full plan (traced elsewhere, or read out with include_json). Sources and the underlay point at
// another plan's files, so they do not come along; with copySourcesFrom the source drawings are copied from that plan.
// `stage` says what refused it: the input itself, or the plan it makes.
export async function importPlan(input: Partial<Plan> | undefined, name: string, copySourcesFrom?: string): Promise<{ errors: string[]; stage: 'input' | 'create' } | { plan: Plan; revision: Revision; copied: number | null }> {
  if (!input || !Array.isArray(input.walls) || !input.sheet) return { errors: ['plan med walls och sheet krävs'], stage: 'input' }
  const plan = { openings: [], fixtures: [], rooms: [], dimensions: [], notes: [], ...input } as Plan
  delete plan.underlay
  const wanted = copySourcesFrom ? (plan.sources ?? []) : []
  delete plan.sources
  const res = await createPlan({ name: name || input.name || 'Planritning', plan, author: 'claude' })
  if ('errors' in res) return { errors: res.errors ?? [], stage: 'create' }
  if (!wanted.length || !copySourcesFrom) return { plan: res.plan, revision: res.revision, copied: null }
  // Copy each drawing's image into the new plan and point at it.
  const copied = []
  for (const src of wanted) {
    const file = decodeURIComponent(src.src.split('/').pop() ?? '')
    const data = await getAsset(copySourcesFrom, file)
    if (!data) continue
    copied.push({ ...src, src: await putAsset(res.plan.id, file, data, 'image/png') })
  }
  const ops: Op[] = copied.map((item) => ({ op: 'add', kind: 'source', item }))
  const ed = await editPlan(res.plan.id, ops, res.revision.n, 'claude', `Källritningar kopierade från ${copySourcesFrom}`)
  return ed.status === 200 ? { plan: ed.plan, revision: ed.revision, copied: copied.length } : { plan: res.plan, revision: res.revision, copied: null }
}
