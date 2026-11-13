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

const TRACE = `Tracing a scanned drawing: Claude decides what is there, the drawing decides where.
Never type a position read off a picture into a saved element: point roughly, and let the engine fit it to the ink
(scan, action "snap_walls"), or use a printed dimension.

1. Calibrate and draft: source (action "trace") with the outer size printed on the drawing.
2. Outline first: exterior walls, the stair, the walls to the neighbours. Look at view (view "overlay", a region of a
   few metres) and compare every wall with the drawing.
3. Then room by room, in small regions (about 4 x 4 m). In each: is every drawn wall in the plan, at the drawn thickness,
   ending where the drawing ends it? Is every wall in the plan really drawn (not a fixture, text or a symbol)?
   Remove what is not a wall, add what is missing by rough ends and snap it, fix ends and thickness.
   scan (action "candidates", args.region [x, y, w, h]) shows the walls the drawing has in a region that the plan
   lacks, numbered; say which numbers are walls and pass their op from data.candidates to edit. A wall it does not
   offer: give rough ends to scan (action "snap_walls", args.walls) and save the result.
4. Doorways: read them from the drawing's markings (below), wall by wall. Where a room has no marked doorway, look
   again before you guess, and ask the person rather than invent one.
5. Verify each room: view the overlay again, and check (scope "audit") for what still differs from the drawing.
6. Ask the person one short list of what the drawing cannot answer. Then rooms, title block and export.
If a plan has several drawings, mark the one it is drawn against with edit
({"op":"update","kind":"source","id":"…","patch":{"primary":true}}): views and scans use it when none is named.`

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
  { name: 'sites', summary: 'Site plans: a property seen from above',
    text: (families) => ({ summary: `En tomt har id som börjar med "site:" (till exempel site:lovinge-3-2). get, view, edit, list (what "sites") och manage (share, delete, restore, create_site) tar det. check, scan, source och export gäller bara planritningar.\nKoordinater är lokala meter: x öster, y norr om fastighetens sydvästra hörn.\n\nOperationer för edit på en tomt: ${families.site_operations.names().join(', ')}\n${families.site_operations.entries.map((e) => `- ${e.summary}`).join('\n')}\nExempel: { "op": "add", "item": { "type": "area", "name": "Växthus", "kind": "byggnad", "status": "idé", "rect": { "x": 30, "y": 112, "w": 6, "d": 4 } } }\nView-alternativ: options.underlay är "flyg", "karta" eller utelämnat.`, data: { operations: families.site_operations.names() } }) },
  { name: 'trace', summary: 'How to trace a scanned drawing into a plan, and how archive drawings show things',
    text: (families) => ({
      summary: `${TRACE}\n\nHow archive drawings show things:\n${families.conventions.entries.map((e) => `- ${e.name}: ${e.summary}`).join('\n')}`,
      data: { conventions: families.conventions.entries.map((e) => ({ name: e.name, summary: e.summary })) },
    }) },
  { name: 'findings', summary: 'The shape of a finding and the standard codes', text: () => ({ summary: FINDINGS }) },
])
export const WORK_TEXT = WORK
