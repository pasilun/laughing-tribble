import { answer } from '../answer'
import { badArgument } from '../findings'
import { FAMILIES, TOPICS } from '../registries'
import { OPERATIONS } from '../registries/operations'
import { toToolResult, type ToolResult } from '../result'
import type { Finding } from '../types'
import { OPS_DOC } from '../../mcp/ops-docs'
import type { Args } from './index'

const WORK = `Planstudio: working order
1. Draw what the drawing shows. Do not suggest or make changes, demolition or a new layout unless the user asks.
2. A drawing or photo cannot be passed to a tool from the chat: use source (action "upload_link") and ask the user to open the link.
3. Calibrate a source against the dimensions printed on it before tracing from it.
4. Trace with scan (proposals) and edit (changes). Pass base_revision from get; a stale one is refused.
5. After every step call check and follow its next: it says what is wrong and which call to make.
6. Look at view often. Never take a measurement from a picture: measurements come from the user, from printed dimensions or from a calibrated scan.
7. Finish with check, fill in the title block with edit, then export.
Call guide again with a topic (ops, vocabulary, findings) when a call answers unknown-name.`

const FINDINGS = `A finding: { id, code, level, message, refs?, fix?, data? }. The id is stable while the cause remains; the code is stable for ever.
Standard codes: unknown-name (a name that does not exist: data.valid lists the right ones, data.nearest the closest), stale-revision (the document changed since base_revision: data.current), not-found (no such document), bad-argument (an argument has the wrong type), invalid-operation (an operation was refused: data.reason), not-implemented.
Other codes come from the checks. fix, when present, is a list of operations for edit that mend the finding.`

const ok = (summary: string, data?: Record<string, unknown>): ToolResult =>
  toToolResult(answer({ ok: true, ...(data ? { data } : {}) }), { summary })

const fail = (f: Finding): ToolResult =>
  toToolResult(answer({ ok: false, findings: [f] }), { summary: f.message })

function overview(): ToolResult {
  const topics = TOPICS.entries.map((entry) => ({ name: entry.name, summary: entry.summary }))
  return ok(`${WORK}\n\nÄmnen: ${TOPICS.names().join(', ')}`, { topics })
}

export async function guide(args: Args): Promise<ToolResult> {
  const topic = args.topic
  if (topic === undefined || topic === '') return overview()
  if (typeof topic !== 'string') return fail(badArgument('topic', 'ska vara en sträng'))

  const resolved = TOPICS.resolve(topic)
  if ('finding' in resolved) return fail(resolved.finding)

  switch (resolved.entry.name) {
    case 'ops':
      return ok(`Operationer: ${OPERATIONS.names().join(', ')}\n\n${OPS_DOC}`)
    case 'vocabulary': {
      const lines = Object.entries(FAMILIES).map(([key, reg]) => `${key}: ${reg.names().join(', ') || '–'}`)
      const families = Object.fromEntries(Object.entries(FAMILIES).map(([key, reg]) => [key, reg.names()]))
      return ok(lines.join('\n'), { families })
    }
    case 'findings':
      return ok(FINDINGS)
    default:
      return ok(WORK)
  }
}
