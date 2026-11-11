import { answer, finding } from '../answer'
import { edit } from './edit'
import { get } from './get'
import { guide } from './guide'
import { list } from './list'
import { toToolResult, type ToolResult } from '../result'
import type { ToolName } from '../types'

export type Args = Record<string, unknown>
export type Handler = (args: Args) => Promise<ToolResult>

// Until a tool has its handler it answers like this. Later cards replace the entries one by one.
const notReady = (name: ToolName): Handler => async () =>
  toToolResult(
    answer({ ok: false, findings: [finding({ code: 'not-implemented', level: 'error', message: `Verktyget ${name} är inte klart än.` })] }),
    { summary: `Verktyget ${name} är inte klart än.` },
  )

export const HANDLERS: Record<ToolName, Handler> = {
  guide, list, get, check: notReady('check'), view: notReady('view'),
  scan: notReady('scan'), edit, source: notReady('source'), manage: notReady('manage'), export: notReady('export'),
}
