import { test, expect } from '@playwright/test'
import { applyOps } from '@/lib/plan/domain/ops'
import { demoPlan } from '@/lib/plan/domain/demo'
import { checkPlan } from '@/lib/plan/domain/checks'
import type { Plan } from '@/lib/plan/domain/types'
import { fromCheck, freshFindings, notFound, badArgument, staleRevision, invalidOperation } from '@/lib/plan/connector/findings'
import { changedList } from '@/lib/plan/connector/changes'

// Pure adapter tests — no browser needed.

test.describe('findings from the checks', () => {
  test('a check finding without a ref is its code, with no refs', () => {
    const f = fromCheck({ level: 'error', code: 'title-block', message: 'm' })
    expect(f.id).toBe('title-block')
    expect(f.refs).toBeUndefined()
  })

  test('a check finding with a ref names it in id and refs', () => {
    const f = fromCheck({ level: 'error', code: 'title-block', message: 'm', ref: 'v1' })
    expect(f.id).toBe('title-block:v1')
    expect(f.refs).toEqual(['v1'])
  })

  test('an edit that empties the address gives one fresh finding and nothing gone; swapped, it is gone', () => {
    const a = demoPlan()
    const b: Plan = { ...a, sheet: { ...a.sheet, titleBlock: { ...a.sheet.titleBlock, address: '' } } }
    const forward = freshFindings(checkPlan(a), checkPlan(b))
    expect(forward.fresh.length).toBe(1)
    expect(forward.fresh[0].code).toBe('title-block')
    expect(forward.gone).toBe(0)
    const back = freshFindings(checkPlan(b), checkPlan(a))
    expect(back.fresh).toEqual([])
    expect(back.gone).toBe(1)
  })
})

test.describe('changes between revisions', () => {
  test('an updated opening is listed as changed', () => {
    const plan = demoPlan()
    const next = applyOps(plan, [{ op: 'update', kind: 'opening', id: 'ny-oppning', patch: { width: 1000 } }]).plan
    expect(changedList(plan, next)).toEqual([{ kind: 'opening', id: 'ny-oppning', what: expect.stringContaining('ändrad') }])
  })

  test('a note is not listed', () => {
    const plan = demoPlan()
    const next = applyOps(plan, [{ op: 'add', kind: 'note', item: { id: 'u9', at: { x: 2000, y: 1000 }, text: 'Obs' } }]).plan
    expect(changedList(plan, next)).toEqual([])
  })

  test('a deleted wall is listed as removed', () => {
    const plan = demoPlan()
    const next = applyOps(plan, [{ op: 'delete', kind: 'wall', id: 'a-hall' }]).plan
    expect(changedList(plan, next)).toContainEqual({ kind: 'wall', id: 'a-hall', what: 'borttagen' })
  })
})

test.describe('standard findings', () => {
  test('stale revision carries the revisions as data', () => {
    expect(staleRevision(1, 3).data).toEqual({ base: 1, current: 3 })
  })

  test('an invalid operation names its operation number as ref, when it has one', () => {
    expect(invalidOperation('operation 2 (add): m').refs).toEqual(['op2'])
    expect(invalidOperation('x').refs).toBeUndefined()
  })

  test('not-found and bad-argument refer to what was wrong', () => {
    expect(notFound('x1').refs).toEqual(['x1'])
    expect(badArgument('width', 'måste vara tal').refs).toEqual(['width'])
  })
})
