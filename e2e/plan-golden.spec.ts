import { test, expect } from '@playwright/test'
import { generate, judge, reference } from './golden'

// The golden case: a plan generated from one known drawing by the scan
// tools over MCP, judged against the plan the drawing was drawn from. The
// score is attached to the report; the limits are today's baseline, to be
// tightened as generation improves.

test('golden: a plan generated from the known drawing scores within limits', async ({ request }) => {
  test.setTimeout(120_000)
  const call = async (name: string, args: Record<string, unknown>) => {
    const res = await request.post('/api/mcp', { data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } } })
    expect(res.status()).toBe(200)
    const body = await res.json()
    const content = body.result.content as Array<{ type: string; text?: string }>
    return { text: content.filter((c) => c.type === 'text').map((c) => c.text).join('\n'), isError: body.result.isError }
  }
  const getPlan = async (id: string) => {
    const body = await (await request.get(`/api/plans/${id}`)).json()
    return { plan: body.plan, revision: body.revision.n }
  }
  const { id, log } = await generate(call, getPlan)
  const score = judge((await getPlan(id)).plan, reference())
  await test.info().attach('score', { body: score.report, contentType: 'text/plain' })
  await test.info().attach('steps', { body: log.join('\n\n'), contentType: 'text/plain' })
  const why = `\n${score.report}`

  expect(score.walls.matched, why).toBe(score.walls.total)
  expect(score.walls.extra, why).toBe(0)
  expect(score.walls.maxPosMm, why).toBeLessThanOrEqual(15)
  expect(score.walls.maxThicknessMm, why).toBeLessThanOrEqual(20)

  expect(score.openings.matched, why).toBe(score.openings.total)
  expect(score.openings.extra, why).toBe(0)
  expect(score.openings.wrongKind, why).toEqual([])
  expect(score.openings.wrongSwing, why).toEqual([])
  expect(score.openings.maxCentreMm, why).toBeLessThanOrEqual(40)
  expect(score.openings.maxWidthMm, why).toBeLessThanOrEqual(100)
})
