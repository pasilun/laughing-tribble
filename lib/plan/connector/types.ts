export const CONTRACT = 1 as const
export const TOOL_NAMES = ['guide', 'list', 'get', 'check', 'view', 'scan', 'edit', 'source', 'manage', 'export'] as const
export type ToolName = (typeof TOOL_NAMES)[number]
export type Level = 'error' | 'warning' | 'info'

// Contract §5. `id` is stable for the same cause; `code` is stable for ever.
export type Finding = {
  id: string
  code: string
  level: Level
  message: string
  refs?: string[]
  fix?: Array<Record<string, unknown>>   // operations for `edit` that mend it
  data?: Record<string, unknown>
}
// Contract §6: a call ready to make.
export type Next = { tool: ToolName; arguments: Record<string, unknown>; why: string }
export type Changed = { kind: string; id: string; what: string }
// Contract §4. Keys that do not apply are left out.
export type Answer = {
  ok: boolean
  contract: typeof CONTRACT
  engine: string
  id?: string
  revision?: number
  changed?: Changed[]
  findings?: Finding[]
  next?: Next[]
  data?: Record<string, unknown>
}
