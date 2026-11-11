import { CONTRACT, type Answer, type Finding } from './types'

// A short id of the running version, for bug reports: the commit on Vercel, 'dev' elsewhere.
export function engineVersion(): string {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA
  return sha ? sha.slice(0, 7) : 'dev'
}

// A finding. Without an id, the id is the code, plus the refs joined with '+' when there are any.
export function finding(f: Omit<Finding, 'id'> & { id?: string }): Finding {
  const id = f.id ?? (f.refs && f.refs.length ? `${f.code}:${f.refs.join('+')}` : f.code)
  return { ...f, id }
}

// An answer. `contract` and `engine` are filled in. The keys come out in this order:
// ok, contract, engine, id, revision, changed, findings, next, data. A key with no value is left out, and so is an
// empty list or an empty `data` object.
export function answer(parts: Omit<Answer, 'contract' | 'engine'>): Answer {
  const out: Record<string, unknown> = { ok: parts.ok, contract: CONTRACT, engine: engineVersion() }
  if (parts.id !== undefined) out.id = parts.id
  if (parts.revision !== undefined) out.revision = parts.revision
  if (parts.changed !== undefined && parts.changed.length > 0) out.changed = parts.changed
  if (parts.findings !== undefined && parts.findings.length > 0) out.findings = parts.findings
  if (parts.next !== undefined && parts.next.length > 0) out.next = parts.next
  if (parts.data !== undefined && Object.keys(parts.data).length > 0) out.data = parts.data
  return out as Answer
}
