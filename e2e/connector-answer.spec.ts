import { test, expect } from '@playwright/test'
import { answer, engineVersion, finding } from '@/lib/plan/connector/answer'

test.describe('connector answers', () => {
  test('answer keeps set keys in order and fills contract and engine', () => {
    const a = answer({ ok: true, id: 'p1', revision: 3 })
    expect(a).toEqual({ ok: true, contract: 1, engine: expect.any(String), id: 'p1', revision: 3 })
    expect(Object.keys(a)).toEqual(['ok', 'contract', 'engine', 'id', 'revision'])
  })

  test('answer leaves out empty lists and an empty data object', () => {
    const a = answer({ ok: true, findings: [], changed: [], next: [], data: {} })
    expect(Object.keys(a)).toEqual(['ok', 'contract', 'engine'])
  })

  test('answer keeps the documented key order when all keys are given', () => {
    const a = answer({
      data: { x: 1 },
      next: [{ tool: 'check', arguments: { id: 'p1' }, why: 'w' }],
      findings: [finding({ code: 'X1', level: 'info', message: 'm' })],
      changed: [{ kind: 'wall', id: 'v1', what: 'moved' }],
      revision: 0,
      id: 'p1',
      ok: false,
    })
    expect(Object.keys(a)).toEqual(['ok', 'contract', 'engine', 'id', 'revision', 'changed', 'findings', 'next', 'data'])
    expect(a.revision).toBe(0)
  })

  test('engineVersion is dev without VERCEL_GIT_COMMIT_SHA and the short sha with it', () => {
    const saved = process.env.VERCEL_GIT_COMMIT_SHA
    try {
      delete process.env.VERCEL_GIT_COMMIT_SHA
      expect(engineVersion()).toBe('dev')
      process.env.VERCEL_GIT_COMMIT_SHA = 'abcdef123456'
      expect(engineVersion()).toBe('abcdef1')
    } finally {
      if (saved === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA
      else process.env.VERCEL_GIT_COMMIT_SHA = saved
    }
  })

  test('finding builds its id from the code and refs, or keeps an explicit id', () => {
    expect(finding({ code: 'X1', level: 'error', message: 'm' }).id).toBe('X1')
    expect(finding({ code: 'X1', level: 'error', message: 'm', refs: ['a', 'b'] }).id).toBe('X1:a+b')
    expect(finding({ code: 'X1', level: 'error', message: 'm', id: 'custom' }).id).toBe('custom')
  })
})
