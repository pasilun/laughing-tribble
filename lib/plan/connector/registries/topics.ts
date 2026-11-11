import { Registry, type Entry } from '../names'
import { OPERATIONS } from './operations'
import { OPS_DOC } from '../../mcp/ops-docs'
import { SCAN_TOOLS } from '../../scan/tools'

// What a topic gives: the text for Claude, and data for programs.
export type TopicText = { summary: string; data?: Record<string, unknown> }
// `families` is passed in by the caller (FAMILIES from ./index), which avoids an import cycle.
export type TopicEntry = Entry & { text: (families: Record<string, Registry<Entry>>) => TopicText }

const WORK = `Planstudio: working order
1. Draw what the drawing shows. Do not suggest or make changes, demolition or a new layout unless the user asks.
2. A drawing or photo cannot be passed to a tool from the chat: use source (action "upload_link") and ask the user to open the link.
3. Calibrate a source against the dimensions printed on it before tracing from it: source (action "trace") does both and gives a first draft.
4. Read details with scan (proposals, nothing is saved) and change the plan with edit. Pass base_revision from get; a stale one is refused.
5. After every step call check and follow its next: it says what is wrong and which call to make.
6. Look at view often. Never take a measurement from a picture: measurements come from the user, from printed dimensions or from a calibrated scan.
7. Finish with check, fill in the title block with edit, then export.
Call guide again with a topic (ops, vocabulary, findings) when a call answers unknown-name.`

const FINDINGS = `A finding: { id, code, level, message, refs?, fix?, data? }. The id is stable while the cause remains; the code is stable for ever.
Standard codes: unknown-name (a name that does not exist: data.valid lists the right ones, data.nearest the closest), stale-revision (the document changed since base_revision: data.current), not-found (no such document), bad-argument (an argument has the wrong type), invalid-operation (an operation was refused: data.reason), not-implemented.
Other codes come from the checks. fix, when present, is a list of operations for edit that mend the finding.`

// The arguments of a scan tool as the connector takes them: the document and the saving are not the caller's.
const HIDDEN = new Set(['plan_id', 'base_revision', 'apply', 'message'])
function argsDoc(tool: string): string {
  const t = SCAN_TOOLS.find((x) => x.name === tool)
  if (!t) return ''
  const props = (t.inputSchema.properties ?? {}) as Record<string, { type?: string; description?: string }>
  const required = new Set((t.inputSchema.required ?? []) as string[])
  const lines = Object.entries(props).filter(([k]) => !HIDDEN.has(k)).map(([k, v]) => `    ${k}${required.has(k) ? ' (required)' : ''}: ${v.type ?? 'value'}${v.description ? ` – ${v.description}` : ''}`)
  return `${t.description}\n  args:\n${lines.join('\n') || '    (none)'}`
}
const actionsDoc = (reg: Registry<Entry>, extra: Record<string, string>) =>
  (reg.entries as Array<Entry & { tool: string }>).map((e) => `${e.name}: ${e.summary}\n${extra[e.name] ?? (e.tool ? argsDoc(e.tool) : '')}`).join('\n\n')

const TRACE_DOC = '  args:\n    source_id: string – default: the drawing that was uploaded\n    printed_outer_mm: { width, length } – the outside size printed on the drawing, in mm\n    dimensions: [{ a: {x,y}, b: {x,y}, mm }] – printed dimension lines with rough end points in plan mm (view shows a grid)\n  Saves a new revision: walls, openings and windows. Not with dry_run.'
const LINK_DOC = '  No args. The person opens the link and adds the drawing; the revision grows.'

export const TOPICS = new Registry<TopicEntry>('topics', 'ämne', [
  { name: 'work', summary: 'The working order', text: () => ({ summary: WORK }) },
  { name: 'ops', summary: 'The operations of edit, with fields and examples',
    text: () => ({ summary: `Operationer: ${OPERATIONS.names().join(', ')}\n\n${OPS_DOC}` }) },
  { name: 'vocabulary', summary: 'Every name the connector knows, by family',
    text: (families) => ({
      summary: Object.entries(families).map(([k, r]) => `${k}: ${r.names().join(', ') || '–'}`).join('\n'),
      data: { families: Object.fromEntries(Object.entries(families).map(([k, r]) => [k, r.names()])) },
    }) },
  { name: 'scan', summary: 'The scan actions: reading a source drawing without changing the plan',
    text: (families) => ({ summary: `Anropa scan med id, action och args. Inget sparas: en läsning som skulle ändra planen kommer som ett förslag (data.proposals) och ett färdigt anrop till edit i next.\n\n${actionsDoc(families.scan, {})}`, data: { actions: families.scan.names() } }) },
  { name: 'source', summary: 'The source actions: getting a drawing in and placing it',
    text: (families) => ({ summary: `Anropa source med id, base_revision, action och args. Sparar en ny revision; med dry_run sparas inget (inte för add och trace).\n\n${actionsDoc(families.source, { upload_link: LINK_DOC, trace: TRACE_DOC })}`, data: { actions: families.source.names() } }) },
  { name: 'findings', summary: 'The shape of a finding and the standard codes', text: () => ({ summary: FINDINGS }) },
])
export const WORK_TEXT = WORK
