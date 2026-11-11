import { hasChanges } from '../../domain/sheet'
import { host } from '../../mcp/format'
import { PLANS } from '../../storage/docs'
import { loadPlan } from '../../service'
import { answer, finding } from '../answer'
import { badArgument, notFound } from '../findings'
import { EXPORTS, SHEETS } from '../registries'
import { toToolResult, type ToolResult } from '../result'
import type { Finding } from '../types'
import type { Args } from './index'

const fail = (findings: Finding[]) => toToolResult(answer({ ok: false, findings }), { summary: findings[0].message })

export async function exportDoc(args: Args): Promise<ToolResult> {
  const id = args.id
  if (id === undefined || id === '') return fail([badArgument('id', 'krävs')])
  if (typeof id !== 'string') return fail([badArgument('id', 'ska vara en sträng')])
  if (!PLANS.id.test(id)) return fail([badArgument('id', 'ogiltigt id')])
  if (typeof args.format !== 'string' || !args.format) return fail([badArgument('format', 'krävs')])
  if (args.options !== undefined && (typeof args.options !== 'object' || args.options === null || Array.isArray(args.options))) return fail([badArgument('options', 'ska vara ett objekt')])
  const f = EXPORTS.resolve(args.format)
  if ('finding' in f) return fail([f.finding])
  const options = (args.options ?? {}) as Record<string, unknown>
  const rev = await loadPlan(id)
  if (!rev) return fail([notFound(id)])
  let sheet: string | undefined
  if (options.sheet !== undefined) {
    const s = typeof options.sheet === 'string' ? SHEETS.resolve(options.sheet) : null
    if (!s) return fail([badArgument('options.sheet', 'ska vara en sträng')])
    if ('finding' in s) return fail([s.finding])
    sheet = s.entry.name
  }
  const h = host()
  const n = rev.meta.n
  const url = (format: string, view: string) => `${h}/api/plans/${id}/sheet?view=${view}&format=${format}&rev=${n}`
  const changes = hasChanges(rev.plan)
  const links: Record<string, string> = { editor: `${h}/plans/${id}` }
  const name = f.entry.name
  if (!['link', 'pdf', 'png', 'svg', 'dxf'].includes(name)) return fail([finding({ code: 'not-implemented', level: 'error', message: `Utdata ${name} är inte klar än.` })])
  if (name === 'link') {
    links.pdf = url('pdf', sheet ?? (changes ? 'both' : 'efter'))
    links.dxf = url('dxf', sheet === 'both' ? 'efter' : (sheet ?? 'efter'))
  } else if (name === 'pdf') links.pdf = url('pdf', sheet ?? (changes ? 'both' : 'efter'))
  else links[name] = url(name, sheet === 'both' ? 'efter' : (sheet ?? 'efter'))
  const lines = Object.entries(links).map(([k, v]) => `${k === 'editor' ? 'Editor' : k.toUpperCase()}: ${v}`)
  return toToolResult(answer({ ok: true, id, revision: n, data: { links } }), { summary: `Revision ${n}. Länkarna kräver inloggning.\n${lines.join('\n')}` })
}
