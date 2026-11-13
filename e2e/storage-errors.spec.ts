import { test, expect } from '@playwright/test'
import { describeError, isNetworkError } from '@/lib/plan/storage/storage'

test('"fetch failed" is reported with its cause and counts as a network error', () => {
  const e = new TypeError('fetch failed', { cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }) })
  expect(describeError(e)).toBe('fetch failed (ECONNRESET: read ECONNRESET)')
  expect(isNetworkError(e)).toBe(true)
  expect(describeError(new Error('källbilden saknas'))).toBe('källbilden saknas')
  expect(isNetworkError(new Error('källbilden saknas'))).toBe(false)
})

test('a fetch error wrapped by a library is still a network error', () => {
  const inner = new TypeError('fetch failed', { cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }) })
  expect(isNetworkError(new Error('SERVER_ERROR: request failed', { cause: inner }))).toBe(true)
  expect(isNetworkError(new Error('SQLITE_CONSTRAINT', { cause: new Error('UNIQUE constraint failed') }))).toBe(false)
})

test('reads are repeated when the connection breaks; writes and other errors are not', async () => {
  const { Retrying } = await import('@/lib/plan/storage/storage')
  let reads = 0
  let writes = 0
  const broken = () => new TypeError('fetch failed', { cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }) })
  const flaky = {
    async read() { reads++; if (reads < 3) throw broken(); return Buffer.from('ok') },
    async write() { writes++; throw broken() },
    async remove() {},
    async keys() { return [] },
  }
  const b = new Retrying(flaky)
  expect((await b.read('k'))!.toString()).toBe('ok')
  expect(reads).toBe(3)
  await expect(b.write('k', 'x', 'text/plain')).rejects.toThrow('fetch failed')
  expect(writes).toBe(1)
  const bad = new Retrying({ ...flaky, async read() { reads++; throw new Error('källbilden saknas') } })
  reads = 0
  await expect(bad.read('k')).rejects.toThrow('saknas')
  expect(reads).toBe(1)
})
