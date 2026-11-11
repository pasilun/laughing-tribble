import { TOOL_NAMES } from './types'
import type { ToolResult } from './result'
import { HANDLERS, type Args } from './handlers'
import { connectorTools } from './tools'

export const connectorList = () => connectorTools()

export const CONNECTOR_INSTRUCTIONS = [
  'Planstudio drafts floor plans for building permits. Call guide first: it gives the working order and the vocabulary.',
  'After every step call check and follow its next: it says what is wrong and which call to make.',
  'Never take a measurement from a picture: measurements come from the user, from printed dimensions or from a calibrated scan.',
].join('\n')

// Runs one of the ten tools. Returns null when the name is not one of them.
export async function callConnectorTool(name: string, args: Args): Promise<ToolResult | null> {
  if (!(TOOL_NAMES as readonly string[]).includes(name)) return null
  return HANDLERS[name as (typeof TOOL_NAMES)[number]](args)
}
