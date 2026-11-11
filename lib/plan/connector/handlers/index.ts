import { check } from './check'
import { edit } from './edit'
import { get } from './get'
import { exportDoc } from './export'
import { guide } from './guide'
import { list } from './list'
import { manage } from './manage'
import { scan } from './scan'
import { source } from './source'
import { view } from './view'
import type { ToolResult } from '../result'
import type { ToolName } from '../types'

export type Args = Record<string, unknown>
export type Handler = (args: Args) => Promise<ToolResult>

export const HANDLERS: Record<ToolName, Handler> = {
  guide, list, get, check, view,
  scan, edit, source, manage, export: exportDoc,
}
