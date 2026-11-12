import { check } from './check'
import { edit } from './edit'
import { get } from './get'
import { exportDoc } from './export'
import { guide } from './guide'
import { list } from './list'
import { manage } from './manage'
import { scan } from './scan'
import { isSite, wrongKind } from './site'
import { source } from './source'
import { view } from './view'
import type { ToolResult } from '../result'
import type { ToolName } from '../types'

export type Args = Record<string, unknown>
export type Handler = (args: Args) => Promise<ToolResult>

// A tool that only works on floor plans answers wrong-kind to the id of a site plan.
const plansOnly = (h: Handler): Handler => async (args) => (isSite(args.id) ? wrongKind(args.id) : h(args))

export const HANDLERS: Record<ToolName, Handler> = {
  guide, list, get, check: plansOnly(check), view,
  scan: plansOnly(scan), edit, source: plansOnly(source), manage, export: plansOnly(exportDoc),
}
