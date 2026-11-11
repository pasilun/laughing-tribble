import { finding } from './answer'
import type { Finding as CheckFinding } from '../domain/checks'
import type { Finding } from './types'

// A finding of `checkPlan` as a contract finding: id = `${code}:${ref}` when it has a ref, otherwise `${code}:${h}` where h
// is a hash of the message, so two causes with one code get two ids; refs = [ref] when it has one.
export function fromCheck(f: CheckFinding): Finding {
  return finding({
    id: f.ref ? `${f.code}:${f.ref}` : `${f.code}:${messageHash(f.message)}`,
    code: f.code,
    level: f.level,
    message: f.message,
    ...(f.ref ? { refs: [f.ref] } : {}),
  })
}

// FNV-1a 32-bit over the UTF-8 bytes of `text`, masked to 24 bits and written as 6 lowercase hex digits.
function messageHash(text: string): string {
  let hash = 0x811c9dc5
  for (const byte of new TextEncoder().encode(text)) {
    hash = Math.imul(hash ^ byte, 0x01000193) >>> 0
  }
  return (hash & 0xffffff).toString(16).padStart(6, '0')
}

// What an edit changed in the findings. The key of a finding is `${level}|${message}`; `fresh` are the findings of
// `after` whose key is not in `before` (as contract findings), `gone` counts the findings of `before` whose key is not in `after`.
export function freshFindings(before: CheckFinding[], after: CheckFinding[]): { fresh: Finding[]; gone: number } {
  const key = (f: CheckFinding) => `${f.level}|${f.message}`
  const was = new Set(before.map(key))
  const now = new Set(after.map(key))
  const fresh = after.filter((f) => !was.has(key(f))).map((f) => fromCheck(f))
  const gone = before.filter((f) => !now.has(key(f))).length
  return { fresh, gone }
}

// The standard findings. All level 'error'.
export const notFound = (id: string): Finding =>
  finding({ code: 'not-found', level: 'error', message: `Dokumentet ${id} finns inte`, refs: [id] })

export const badArgument = (name: string, why: string): Finding =>
  finding({ code: 'bad-argument', level: 'error', message: `Argumentet ${name}: ${why}`, refs: [name] })

export const staleRevision = (base: number, current: number): Finding =>
  finding({
    code: 'stale-revision',
    level: 'error',
    message: `Dokumentet har ändrats: senaste revision är ${current}, du utgick från ${base}. Läs det med get och gör om ändringen.`,
    data: { base, current },
  })

// When the message starts with `operation N` (a number), refs = [`op${N}`], otherwise no refs.
export const invalidOperation = (message: string): Finding => {
  const m = /^operation (\d+)/.exec(message)
  return finding({
    code: 'invalid-operation',
    level: 'error',
    message,
    data: { reason: message },
    ...(m ? { refs: [`op${m[1]}`] } : {}),
  })
}
