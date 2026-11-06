import { handleSiteTool, SITE_TOOLS } from '../../site/mcp'
import { handleScanTool, SCAN_TOOLS } from '../scan/tools'
import { BASIC_INSTRUCTIONS, INSTRUCTIONS } from './guide'
import { adapt, type Args, type Tool, type ToolResult } from './tool'
import { EDIT_TOOLS } from './tools-edit'
import { READ_TOOLS } from './tools-read'
import { SHARE_TOOLS } from './tools-share'
import { TRACE_TOOLS } from './tools-trace'

// Claude's tools for plans and sites. Claude never regenerates a plan: it reads it, then sends small operations
// against a known revision, and gets a rendered preview back to check its own work. The tools are in groups
// (tools-read, -edit, -trace, -share; the scan tools in scan/tools.ts, the site tools in site/mcp.ts); this file
// lists them and runs one by name.

export type { ToolResult } from './tool'

const REGISTRY: Tool[] = [...READ_TOOLS, ...TRACE_TOOLS, ...EDIT_TOOLS, ...SHARE_TOOLS, ...adapt(SCAN_TOOLS, handleScanTool), ...adapt(SITE_TOOLS, handleSiteTool)]

// What Claude sees of a tool: not the function that runs it.
const described = (t: Tool) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })
export const PLAN_TOOLS = REGISTRY.map(described)

export async function handlePlanTool(name: string, args: Args): Promise<ToolResult | null> {
  return (await REGISTRY.find((t) => t.name === name)?.run(args)) ?? null
}

// What a connector lists. The default is every tool. ?tools=basic: the short surface for smaller
// models and for people who only want the drawing made; the scan tools stay behind plan_trace,
// plan_audit and plan_fix.
const BASIC = ['plan_next', 'plan_create', 'plan_list', 'plan_upload_link', 'plan_trace', 'plan_audit', 'plan_fix', 'plan_view', 'plan_get', 'plan_finish', 'plan_guide']

export function toolsFor(profile?: string | null) {
  if (profile !== 'basic') return PLAN_TOOLS
  // The short set speaks of one sheet: no före/efter argument.
  return PLAN_TOOLS.filter((t) => BASIC.includes(t.name)).map((t) => {
    const props = (t.inputSchema as { properties?: Record<string, unknown> }).properties
    if (!props || !('view' in props)) return t
    const { view: _view, ...rest } = props
    void _view
    return { ...t, inputSchema: { ...t.inputSchema, properties: rest } }
  })
}

export const instructionsFor = (profile?: string | null) => (profile === 'basic' ? BASIC_INSTRUCTIONS : INSTRUCTIONS)
