import type { ToolName } from './types'

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
      what: str('What to list. Default "plans". See guide topic "vocabulary".'),
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
      format: str('"text" (default) or "json" for the whole plan as data.'),
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
      view: str('Which picture. Default "sheet". See guide topic "vocabulary".'),
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
