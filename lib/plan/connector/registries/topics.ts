import { Registry, type Entry } from '../names'
import { OPERATIONS } from './operations'
import { OPS_DOC } from '../../mcp/ops-docs'

// What a topic gives: the text for Claude, and data for programs.
export type TopicText = { summary: string; data?: Record<string, unknown> }
// `families` is passed in by the caller (FAMILIES from ./index), which avoids an import cycle.
export type TopicEntry = Entry & { text: (families: Record<string, Registry<Entry>>) => TopicText }

const WORK = `Planstudio: working order
1. Draw what the drawing shows. Do not suggest or make changes, demolition or a new layout unless the user asks.
2. A drawing or photo cannot be passed to a tool from the chat: use source (action "upload_link") and ask the user to open the link.
3. Calibrate a source against the dimensions printed on it before tracing from it.
4. Trace with scan (proposals) and edit (changes). Pass base_revision from get; a stale one is refused.
5. After every step call check and follow its next: it says what is wrong and which call to make.
6. Look at view often. Never take a measurement from a picture: measurements come from the user, from printed dimensions or from a calibrated scan.
7. Finish with check, fill in the title block with edit, then export.
Call guide again with a topic (ops, vocabulary, findings) when a call answers unknown-name.`

const FINDINGS = `A finding: { id, code, level, message, refs?, fix?, data? }. The id is stable while the cause remains; the code is stable for ever.
Standard codes: unknown-name (a name that does not exist: data.valid lists the right ones, data.nearest the closest), stale-revision (the document changed since base_revision: data.current), not-found (no such document), bad-argument (an argument has the wrong type), invalid-operation (an operation was refused: data.reason), not-implemented.
Other codes come from the checks. fix, when present, is a list of operations for edit that mend the finding.`

export const TOPICS = new Registry<TopicEntry>('topics', 'ämne', [
  { name: 'work', summary: 'The working order', text: () => ({ summary: WORK }) },
  { name: 'ops', summary: 'The operations of edit, with fields and examples',
    text: () => ({ summary: `Operationer: ${OPERATIONS.names().join(', ')}\n\n${OPS_DOC}` }) },
  { name: 'vocabulary', summary: 'Every name the connector knows, by family',
    text: (families) => ({
      summary: Object.entries(families).map(([k, r]) => `${k}: ${r.names().join(', ') || '–'}`).join('\n'),
      data: { families: Object.fromEntries(Object.entries(families).map(([k, r]) => [k, r.names()])) },
    }) },
  { name: 'findings', summary: 'The shape of a finding and the standard codes', text: () => ({ summary: FINDINGS }) },
])
export const WORK_TEXT = WORK
