import { loadPlan } from '../service'
import { reportError } from '../../monitor'
import { describeError } from '../storage/storage'
import { err, type Result } from './kit'
import { FIND_TOOLS } from './tools-find'
import { SOURCE_TOOLS } from './tools-source'
import { faceWallsUnsupported, hasFaceWalls } from '../domain/faces'

// Claude's scan tools: everything needed to turn a scanned or exported drawing into plan walls without a human
// at the editor – look, measure, calibrate, detect, snap – each returning an image to check the result.
// The tools are in tools-source.ts (placing a drawing) and tools-find.ts (finding things in it); this file lists
// them and runs one on a plan that exists.

const TOOLS = [...SOURCE_TOOLS, ...FIND_TOOLS]

export const SCAN_TOOLS = TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))

// The readers that measure ink across a wall or write wall geometry or openings back still assume a wall centred on
// its stored line. Until they read a wall's body, they refuse a plan with walls stored on a face rather than write
// something half a thickness off.
export const FACE_UNSAFE = new Set(['plan_scan_missing_walls', 'plan_scan_snap_walls', 'plan_scan_openings', 'plan_openings_report', 'plan_scan_elevation', 'plan_scan_doors'])

export async function handleScanTool(name: string, args: Record<string, unknown>): Promise<Result | null> {
  const tool = TOOLS.find((t) => t.name === name)
  if (!tool) return null
  const planId = String(args.plan_id ?? '')
  const rev = await loadPlan(planId)
  if (!rev) return err(`Planen ${planId} finns inte`)
  if (FACE_UNSAFE.has(name) && hasFaceWalls(rev.plan)) return err(faceWallsUnsupported(name))
  try {
    return await tool.run({ planId, plan: rev.plan, args })
  } catch (e) {
    console.error(`${name} misslyckades: ${describeError(e)}`)
    const trace = await reportError(e, { tool: name, plan: planId })
    return err(`${describeError(e)}${trace ? ` [spår ${trace}]` : ''}`)
  }
}
