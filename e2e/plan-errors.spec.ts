import { test, expect } from '@playwright/test'
import { ConflictError, PublicError } from '@/lib/plan/storage'
import { fail } from '../app/api/plans/http'

// Errors meant for people are shown; every other error is logged and answered with a plain message,
// since it may name files, hosts or tables.

test('only deliberate messages reach the caller', async () => {
  const real = console.error
  const logged: unknown[][] = []
  console.error = (...a: unknown[]) => void logged.push(a)
  try {
    const internal = fail(new Error('ENOENT: no such file /var/task/.data/u/anna/plans/x; libsql://plan-studio-x.turso.io'))
    expect(internal.status).toBe(500)
    const body = JSON.stringify(await internal.json())
    expect(body).not.toContain('ENOENT')
    expect(body).not.toContain('turso')
    expect(logged).toHaveLength(1)
    expect(String(logged[0][1])).toContain('ENOENT')
    expect(fail(new Error('Blob: private access on a public store')).status).toBe(500)
  } finally {
    console.error = real
  }
  const nope = fail(new PublicError('planen finns inte', 404))
  expect(nope.status).toBe(404)
  expect((await nope.json()).errors).toEqual(['planen finns inte'])
  expect(fail(new PublicError('ogiltigt filnamn')).status).toBe(400)
  expect(fail(new ConflictError(3)).status).toBe(409)
})

test('an invalid id over HTTP is a 400 with the message', async ({ request }) => {
  const res = await request.get('/api/plans/Ogiltigt%20Id')
  expect(res.status()).toBe(400)
  expect((await res.json()).errors[0]).toContain('ogiltigt plan-id')
})
