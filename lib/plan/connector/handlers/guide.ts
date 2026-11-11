import { answer } from '../answer'
import { badArgument } from '../findings'
import { FAMILIES, TOPICS } from '../registries'
import { WORK_TEXT } from '../registries/topics'
import { toToolResult, type ToolResult } from '../result'
import type { Finding } from '../types'
import type { Args } from './index'

const ok = (summary: string, data?: Record<string, unknown>): ToolResult =>
  toToolResult(answer({ ok: true, ...(data ? { data } : {}) }), { summary })

const fail = (f: Finding): ToolResult =>
  toToolResult(answer({ ok: false, findings: [f] }), { summary: f.message })

function overview(): ToolResult {
  const topics = TOPICS.entries.map((entry) => ({ name: entry.name, summary: entry.summary }))
  return ok(`${WORK_TEXT}\n\nÄmnen: ${TOPICS.names().join(', ')}`, { topics })
}

export async function guide(args: Args): Promise<ToolResult> {
  const topic = args.topic
  if (topic === undefined || topic === '') return overview()
  if (typeof topic !== 'string') return fail(badArgument('topic', 'ska vara en sträng'))

  const resolved = TOPICS.resolve(topic)
  if ('finding' in resolved) return fail(resolved.finding)

  const text = resolved.entry.text(FAMILIES)
  return ok(text.summary, text.data)
}
