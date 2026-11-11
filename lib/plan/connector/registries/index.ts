import { SECTIONS, type Section } from '../../mcp/format'
import { Registry, type Entry } from '../names'
import { OPERATIONS } from './operations'

// One summary per part of a plan. Typed by Section, so a part added to SECTIONS fails to compile until it is described here.
const PART_SUMMARIES: Record<Section, string> = {
  sheet: 'Paper, scale, orientation, north angle and title block',
  walls: 'Walls with ids, ends, thickness and flags',
  openings: 'Doors and windows in walls, with width, height and position',
  fixtures: 'Fixtures such as sinks, stoves and toilets, with ids and positions',
  rooms: 'Rooms with names, areas and boundaries',
  sources: 'Source drawings placed under the plan',
}

export const PARTS = new Registry<Entry>('parts', 'del',
  SECTIONS.map((name) => ({ name, summary: PART_SUMMARIES[name] })))
export const LIST_KINDS = new Registry<Entry>('list', 'lista', [
  { name: 'plans', summary: 'The documents the person can open, with revision and tags (default)' },
  { name: 'revisions', summary: 'The revisions of one document (needs id)' },
])
export const TOPICS = new Registry<Entry>('topics', 'ämne', [
  { name: 'work', summary: 'The working order' },
  { name: 'ops', summary: 'The operations of edit, with fields and examples' },
  { name: 'vocabulary', summary: 'Every name the connector knows, by family' },
  { name: 'findings', summary: 'The shape of a finding and the standard codes' },
])
export const VIEWS = new Registry<Entry>('views', 'vy', [])
export const CHECKS = new Registry<Entry>('checks', 'kontroll', [])
export const FORMATS = new Registry<Entry>('formats', 'format', [
  { name: 'text', summary: 'The listing as text' },
  { name: 'json', summary: 'The whole plan as data' },
])
export const SCAN_ACTIONS = new Registry<Entry>('scan', 'skanningsåtgärd', [])
export const SOURCE_ACTIONS = new Registry<Entry>('source', 'källåtgärd', [])
export const MANAGE_ACTIONS = new Registry<Entry>('manage', 'hanteringsåtgärd', [])

// Every family, by its English key. The guide's `vocabulary` topic is written from this.
export const FAMILIES: Record<string, Registry<Entry>> = {
  operations: OPERATIONS as Registry<Entry>, parts: PARTS, list: LIST_KINDS, views: VIEWS, checks: CHECKS,
  formats: FORMATS, scan: SCAN_ACTIONS, source: SOURCE_ACTIONS, manage: MANAGE_ACTIONS, topics: TOPICS,
}
