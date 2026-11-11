import { SECTIONS, type Section } from '../../mcp/format'
import { Registry, type Entry } from '../names'
import { OPERATIONS } from './operations'
import { permit, review, audit, compare, finish } from '../checks'
import { TOPICS } from './topics'

export { TOPICS } from './topics'

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
export const VIEWS = new Registry<Entry>('views', 'vy', [
  { name: 'sheet', summary: 'The drawing sheet (default); options.sheet is "efter" or "fore"' },
  { name: 'overlay', summary: 'The plan drawn over the source drawing; region zooms; options.source picks the source' },
  { name: 'source', summary: 'The source drawing alone, with a grid in mm; region zooms' },
])
export const CHECKS = new Registry<Entry>('checks', 'kontroll', [permit, review, audit, compare, finish])
export const FORMATS = new Registry<Entry>('formats', 'format', [
  { name: 'text', summary: 'The listing as text' },
  { name: 'json', summary: 'The whole plan as data' },
])
export const EXPORTS = new Registry<Entry>('exports', 'utdata', [
  { name: 'link', summary: 'Links to the editor, the PDF and the DXF (default)' },
  { name: 'pdf', summary: 'The sheets as a PDF; options.sheet is "both", "efter" or "fore"' },
  { name: 'png', summary: 'The sheet as a PNG' },
  { name: 'svg', summary: 'The sheet as an SVG' },
  { name: 'dxf', summary: 'The drawing as DXF' },
])
export const SHEETS = new Registry<Entry>('sheets', 'blad', [
  { name: 'efter', summary: 'The sheet with changes (default)' },
  { name: 'fore', summary: 'The sheet as it is today' },
  { name: 'both', summary: 'Före and efter together (export only)' },
])
// An action that is carried out by one of the scan tools of lib/plan/scan. `tool` is that tool's name; `proposes` marks a tool that saves
// when it is run, which scan runs in capture mode so that its result is a proposal for edit.
export type ActionEntry = Entry & { tool: string; proposes?: boolean }
export const SCAN_ACTIONS = new Registry<ActionEntry>('scan', 'skanningsåtgärd', [
  { name: 'profile', tool: 'plan_scan_profile', summary: 'Ink profile along a line in the source: where the walls cross it' },
  { name: 'diff', tool: 'plan_scan_diff', summary: 'What differs between two sources' },
  { name: 'detect_walls', tool: 'plan_scan_detect_walls', summary: 'Wall candidates found in the source' },
  { name: 'missing_walls', tool: 'plan_scan_missing_walls', summary: 'Drawn walls that the plan does not have' },
  { name: 'snap_walls', tool: 'plan_scan_snap_walls', proposes: true, summary: 'Proposal: walls moved onto the drawn walls' },
  { name: 'openings', tool: 'plan_scan_openings', proposes: true, summary: 'Proposal: doors and windows read from the plan view' },
  { name: 'elevation', tool: 'plan_scan_elevation', proposes: true, summary: 'Proposal: windows read from a facade drawing' },
  { name: 'doors', tool: 'plan_scan_doors', proposes: true, summary: 'Proposal: which way the doors open' },
])
export const SOURCE_ACTIONS = new Registry<ActionEntry>('source', 'källåtgärd', [
  { name: 'upload_link', tool: '', summary: 'A link where the person adds a drawing' },
  { name: 'add', tool: 'plan_source_add', summary: 'Add a drawing from data. args: { id, filename, data_base64, ... }' },
  { name: 'calibrate', tool: 'plan_scan_calibrate', summary: 'Fit the scale to known distances' },
  { name: 'calibrate_dimensions', tool: 'plan_scan_dimension', summary: 'Calibrate and straighten from printed dimension lines' },
  { name: 'register', tool: 'plan_scan_register', summary: 'Align a source to another source' },
  { name: 'trace', tool: '', summary: 'A first draft from a source: calibrates, finds walls, openings and windows. args: { source_id?, printed_outer_mm?, dimensions? }' },
])
export const MANAGE_ACTIONS = new Registry<Entry & { needsId: boolean }>('manage', 'hanteringsåtgärd', [
  { name: 'create', needsId: false, summary: 'A new document. args: { name, template?: "empty" | "demo" }' },
  { name: 'import', needsId: false, summary: 'A new document from a whole plan as data. args: { name, plan, copy_sources_from? }' },
  { name: 'rename', needsId: true, summary: 'Rename a document (a new revision). args: { name }' },
  { name: 'tags', needsId: true, summary: 'Set the tags of a document (replaces them). args: { tags: string[] }' },
  { name: 'share', needsId: true, summary: 'Share with a person, take one out, or show who has it. args: { with? } or { remove? } or none' },
  { name: 'delete', needsId: true, summary: 'Move a document to the trash (for a member: leave it)' },
  { name: 'restore', needsId: true, summary: 'Take a document back from the trash' },
  { name: 'trash', needsId: false, summary: 'List what the person has deleted' },
])
export const TEMPLATES = new Registry<Entry>('templates', 'mall', [
  { name: 'empty', summary: 'A new, empty plan (default)' },
  { name: 'demo', summary: 'A plan with a demo drawing' },
])

// Every family, by its English key. The guide's `vocabulary` topic is written from this.
export const FAMILIES: Record<string, Registry<Entry>> = {
  operations: OPERATIONS as Registry<Entry>, parts: PARTS, list: LIST_KINDS, views: VIEWS, checks: CHECKS,
  formats: FORMATS, exports: EXPORTS, sheets: SHEETS, scan: SCAN_ACTIONS, source: SOURCE_ACTIONS, manage: MANAGE_ACTIONS as Registry<Entry>, topics: TOPICS as Registry<Entry>,
}
