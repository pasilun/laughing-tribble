import type { Op } from '../../domain/ops'
import { Registry, type Entry } from '../names'

export type OperationEntry = Entry & { example: Op }

// `Record<Op['op'], …>` makes the compiler fail when an operation is added to ops.ts and not listed here.
const DEFS: Record<Op['op'], { summary: string; example: Op }> = {
  add: {
    summary: 'Add a wall, mass, zone, opening, fixture, room, dimension, note or source',
    example: { op: 'add', kind: 'note', item: { id: 'n-test', at: { x: 1000, y: 1000 }, text: 'Test' } },
  },
  update: {
    summary: 'Change fields of one element by id',
    example: { op: 'update', kind: 'opening', id: 'ny-oppning', patch: { width: 1000 } },
  },
  delete: {
    summary: 'Remove one element (a wall takes its openings with it)',
    example: { op: 'delete', kind: 'fixture', id: 'kok-b' },
  },
  moveVertex: {
    summary: 'Move every wall end at a point; joined walls follow',
    example: { op: 'moveVertex', from: { x: 6000, y: 0 }, to: { x: 6000, y: 100 } },
  },
  moveWall: {
    summary: 'Move a wall by dx, dy; walls joined at its ends stretch',
    example: { op: 'moveWall', id: 'a-hall', dx: 0, dy: 100 },
  },
  setWallLength: {
    summary: "Change a wall's length, keeping one end fixed",
    example: { op: 'setWallLength', id: 'a-hall', length: 3400, fixed: 'a' },
  },
  scale: {
    summary: 'Scale the whole drawing about a point, separately along x and y',
    example: { op: 'scale', origin: { x: 0, y: 0 }, fx: 1.01, fy: 1.01 },
  },
  setName: {
    summary: 'Rename the document',
    example: { op: 'setName', name: 'Nytt namn' },
  },
  setSheet: {
    summary: 'Change paper, orientation, scale or north angle',
    example: { op: 'setSheet', patch: { scale: 100 } },
  },
  setTitleBlock: {
    summary: 'Change title block fields',
    example: { op: 'setTitleBlock', patch: { author: 'Test' } },
  },
  setUnderlay: {
    summary: 'Set or clear the underlay image (used by the editor; sources replace it for Claude)',
    example: { op: 'setUnderlay', underlay: null },
  },
}

export const OPERATIONS = new Registry<OperationEntry>('operations', 'operation',
  Object.entries(DEFS).map(([name, d]) => ({ name, ...d })))
