import { finding } from './answer'
import type { Finding } from './types'

export type Entry = { name: string; aliases?: string[]; summary: string }

// The engine's vocabulary of one family (operations, views, actions ...). Names and aliases must be unique.
export class Registry<E extends Entry> {
  private readonly index = new Map<string, E>()

  // family: English key used in `data.kind` ('operations'); noun: Swedish word for messages ('operation').
  constructor(readonly family: string, readonly noun: string, readonly entries: E[]) {
    for (const entry of entries) {
      for (const n of [entry.name, ...(entry.aliases ?? [])]) {
        if (this.index.has(n)) throw new Error(`dubbelt namn ${n} i ${family}`)
        this.index.set(n, entry)
      }
    }
  }

  // Canonical names, in declaration order.
  names(): string[] {
    return this.entries.map((entry) => entry.name)
  }

  // By canonical name or alias, exact match.
  get(name: string): E | undefined {
    return this.index.get(name)
  }

  resolve(name: string): { entry: E } | { finding: Finding } {
    const entry = this.get(name)
    if (entry) return { entry }
    return { finding: unknownName(this, name) }
  }
}

// The valid name closest to `name`, or undefined. Rules, in order:
// 1. a candidate that starts with `name` (when `name` has at least 2 characters), if exactly one does;
// 2. the candidate with the smallest Levenshtein distance, if that distance is <= max(2, floor(name.length / 3));
//    on a tie the earlier candidate wins.
export function nearest(name: string, candidates: string[]): string | undefined {
  if (name.length >= 2) {
    const prefixed = candidates.filter((c) => c.startsWith(name))
    if (prefixed.length === 1) return prefixed[0]
  }
  let best: string | undefined
  let bestDistance = Infinity
  for (const c of candidates) {
    const d = levenshtein(name, c)
    if (d < bestDistance) {
      best = c
      bestDistance = d
    }
  }
  if (best !== undefined && bestDistance <= Math.max(2, Math.floor(name.length / 3))) return best
  return undefined
}

// code 'unknown-name', level 'error', id `unknown-name:${family}:${name}`
export function unknownName(reg: Registry<Entry>, name: string): Finding {
  const names = reg.names()
  const near = nearest(name, names)
  const message = `Okänd ${reg.noun} "${name}".${near ? ` Menade du "${near}"?` : ''} Giltiga: ${names.join(', ')}.`
  const data: Record<string, unknown> = { kind: reg.family, name, valid: names }
  if (near !== undefined) data.nearest = near
  return finding({
    id: `unknown-name:${reg.family}:${name}`,
    code: 'unknown-name',
    level: 'error',
    message,
    data,
  })
}

// Two-row dynamic programme over code units.
function levenshtein(a: string, b: string): number {
  let prev: number[] = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur: number[] = [i]
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
    }
    prev = cur
  }
  return prev[b.length]
}
