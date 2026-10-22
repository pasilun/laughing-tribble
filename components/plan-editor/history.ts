import type { Plan } from '@/lib/plan/types'

// Undo/redo for the editor. Consecutive edits with the same key (e.g. typing
// in one numeric field) collapse into one undo step.

export type History = { past: Plan[]; present: Plan; future: Plan[]; lastKey?: string }

export function initHistory(plan: Plan): History {
  return { past: [], present: plan, future: [] }
}

export function push(h: History, next: Plan, key?: string): History {
  if (next === h.present) return h
  if (key && key === h.lastKey) return { ...h, present: next, future: [] }
  return { past: [...h.past.slice(-199), h.present], present: next, future: [], lastKey: key }
}

export function undo(h: History): History {
  if (h.past.length === 0) return h
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future], lastKey: undefined }
}

export function redo(h: History): History {
  if (h.future.length === 0) return h
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1), lastKey: undefined }
}
