import { TOOL_NAMES, type ToolName } from './types'

export type ToolSpec = {
  name: ToolName
  description: string
  inputSchema: Record<string, unknown>
  annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean }
}

const str = (description?: string) => ({ type: 'string', ...(description ? { description } : {}) })
const int = (description?: string) => ({ type: 'integer', ...(description ? { description } : {}) })
const bool = (description?: string) => ({ type: 'boolean', ...(description ? { description } : {}) })
const strs = (description?: string) => ({ type: 'array', items: { type: 'string' }, ...(description ? { description } : {}) })
const obj = (description?: string) => ({ type: 'object', ...(description ? { description } : {}) })
const schema = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties,
  ...(required.length ? { required } : {}),
})
const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true }

export const READ_SPECS: ToolSpec[] = [
  {
    name: 'guide',
    description: 'Planstudio: how to work and what the vocabulary is. Call it first in a session, and again when a call answers unknown-name. With no topic it returns the working order and the list of topics; topic "ops" lists the operations of edit.',
    inputSchema: schema({ topic: str('A topic name. Leave out for the working order and the list of topics.') }),
    annotations: READ,
  },
  {
    name: 'list',
    description: 'Planstudio: lists the person\'s documents (floor plans and site plans) with their latest revision and tags. With id and what "revisions" it lists the revisions of one document. Example: {"what":"revisions","id":"my-plan"}.',
    inputSchema: schema({
      what: str('What to list. See guide topic "vocabulary".'),
      id: str('A document, for lists that belong to one.'),
      query: str('Only names and tags that contain this text.'),
      limit: int('At most this many items. Default 50.'),
      cursor: str('From the previous answer, to get the next page.'),
    }),
    annotations: READ,
  },
  {
    name: 'get',
    description: 'Planstudio: reads a document: a compact listing of its parts with ids and measurements, and the current revision (needed for edit). parts limits what is returned; since returns only what changed after a revision. Example: {"id":"my-plan","parts":["walls"]}.',
    inputSchema: schema({
      id: str('The document.'),
      parts: strs('Only these parts. See guide topic "vocabulary".'),
      since: int('Only what changed after this revision.'),
      format: str('How to return the document. See guide topic "vocabulary".'),
    }, ['id']),
    annotations: READ,
  },
  {
    name: 'check',
    description: 'Planstudio: everything that is wrong or unfinished in a document, and the next call to make. Run it after each step and follow next. scope limits which families of checks run; against compares with something else. Example: {"id":"my-plan"}.',
    inputSchema: schema({
      id: str('The document.'),
      scope: strs('Only these families of checks. See guide topic "vocabulary".'),
      against: obj('What to compare with, for example a printed size. See guide.'),
    }, ['id']),
    annotations: READ,
  },
  {
    name: 'view',
    description: 'Planstudio: one picture: the sheet, a zoomed region, or a source drawing with the plan over it, sized to max_tokens. A picture shows what is there; never read a measurement from it. Example: {"id":"my-plan","region":{"id":"v12"}}.',
    inputSchema: schema({
      id: str('The document.'),
      view: str('Which picture. See guide topic "vocabulary".'),
      region: {
        type: 'object',
        description: 'Zoom: give id (an element) or rect_mm ([x, y, w, h] in plan mm).',
        properties: {
          id: str(),
          rect_mm: { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4 },
        },
      },
      max_tokens: int('Size budget of the picture. Default 1600.'),
      options: obj('Options of the view. See guide.'),
    }, ['id']),
    annotations: READ,
  },
  {
    name: 'scan',
    description: 'Planstudio: reads a source drawing without changing the document: finds walls, openings and doors, measures a profile. It returns proposals as operations for edit. action names the reading; see guide topic "vocabulary".',
    inputSchema: schema({
      id: str('The document.'),
      action: str('Which reading.'),
      args: obj('Arguments of the action. See guide.'),
      max_tokens: int('Size budget of any picture. Default 1600.'),
    }, ['id', 'action']),
    annotations: READ,
  },
]

const EDIT = { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
const MANAGE = { readOnlyHint: false, destructiveHint: true, idempotentHint: false }
const EXPORT = { readOnlyHint: false, destructiveHint: false, idempotentHint: true }

export const WRITE_SPECS: ToolSpec[] = [
  {
    name: 'edit',
    description: 'Planstudio: changes a document with small operations, saved as a new revision all-or-nothing. Pass base_revision from get; a stale one is refused. Use dry_run to see the effect first. The operations are listed by guide topic "ops". Example: {"id":"my-plan","base_revision":3,"ops":[{"op":"update","kind":"opening","id":"d1","patch":{"width":900}}]}.',
    inputSchema: schema({
      id: str('The document.'),
      base_revision: int('The revision you last read with get.'),
      ops: {
        type: 'array',
        description: 'The operations, applied in order, all or none.',
        items: {
          type: 'object',
          properties: { op: str('The operation name.') },
          required: ['op'],
        },
      },
      dry_run: bool('Work everything out, save nothing.'),
      message: str('The revision note, in Swedish.'),
      image: bool('Also return a picture of the sheet. Default false.'),
    }, ['id', 'base_revision', 'ops']),
    annotations: EDIT,
  },
  {
    name: 'source',
    description: 'Planstudio: gets a source drawing into a document and places it: an upload link, add, calibrate, straighten. action names the step; see guide topic "vocabulary". A chat attachment cannot reach a tool: ask the user to open the upload link.',
    inputSchema: schema({
      id: str('The document.'),
      base_revision: int('The revision you last read, for actions that change the document.'),
      action: str('Which step.'),
      args: obj('Arguments of the action. See guide.'),
      dry_run: bool('Work everything out, save nothing.'),
    }, ['id', 'action']),
    annotations: EDIT,
  },
  {
    name: 'manage',
    description: 'Planstudio: creates, copies, renames, tags, shares, trashes and restores documents. action names what to do; see guide topic "vocabulary". Deleting moves a document to the trash. Example: {"action":"create","args":{"name":"Kallare Lundagatan"}}.',
    inputSchema: schema({
      action: str('What to do.'),
      id: str('The document, for actions that need one.'),
      args: obj('Arguments of the action. See guide.'),
    }, ['action']),
    annotations: MANAGE,
  },
  {
    name: 'export',
    description: 'Planstudio: writes the sheets as PDF, PNG, SVG or DXF, or returns a link to open the document. format names the output; see guide topic "vocabulary". Example: {"id":"my-plan","format":"pdf"}.',
    inputSchema: schema({
      id: str('The document.'),
      format: str('Which output.'),
      options: obj('Options of the format. See guide.'),
    }, ['id', 'format']),
    annotations: EXPORT,
  },
]

// The ten tools in the order of the contract: guide, list, get, check, view, scan, edit, source, manage, export.
export function connectorTools(): ToolSpec[] {
  const all = [...READ_SPECS, ...WRITE_SPECS]
  return TOOL_NAMES.map((name) => {
    const matches = all.filter((spec) => spec.name === name)
    if (matches.length !== 1) {
      throw new Error(`Tool ${name} must be defined exactly once, found ${matches.length}`)
    }
    return matches[0]
  })
}
